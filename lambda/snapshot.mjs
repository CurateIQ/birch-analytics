/**
 * snapshot.mjs — Daily Collective cost snapshot Lambda.
 * Triggered by EventBridge cron (2am ET). Queries Shopify Admin GraphQL for all
 * products from the 6 Collective vendors, writes a dated JSON file to S3.
 *
 * Required env vars: SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN (or SHOPIFY_CLIENT_ID +
 * SHOPIFY_CLIENT_SECRET), COST_SNAPSHOTS_BUCKET.
 */

import https from 'https';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-1' });

const COLLECTIVE_VENDORS = [
  "Apple Park & Organic Farm Buddies",
  "DYPER",
  "L'ovedbaby",
  "Makemake Organics",
  "Parasol Co",
  "ezpz",
];

const COST_QUERY = `
  query($query: String!, $cursor: String) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        vendor
        variants(first: 100) {
          nodes {
            id
            sku
            title
            price
            inventoryItem {
              unitCost { amount }
            }
          }
        }
      }
    }
  }
`;

// ── helpers (mirrors index.mjs) ───────────────────────────────────────────────

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

let cachedToken = null;
let tokenExpiry = 0;

async function getShopifyToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const staticToken = process.env.SHOPIFY_ACCESS_TOKEN;
  if (staticToken && tokenExpiry === 0) {
    cachedToken = staticToken;
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return cachedToken;
  }

  const { SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: clientSecret, SHOPIFY_STORE: store } = process.env;
  if (!clientId || !clientSecret || !store) throw new Error('Missing Shopify credentials');

  const result = await httpsPost(store, '/admin/oauth/access_token', { 'Content-Type': 'application/json' },
    JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
  );
  if (!result.body.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(result.body)}`);

  cachedToken = result.body.access_token;
  tokenExpiry = Date.now() + ((result.body.expires_in || 86400) - 300) * 1000;
  return cachedToken;
}

// ── main handler ──────────────────────────────────────────────────────────────

export const handler = async () => {
  const bucket = process.env.COST_SNAPSHOTS_BUCKET;
  if (!bucket) throw new Error('Missing COST_SNAPSHOTS_BUCKET env var');

  const store = process.env.SHOPIFY_STORE;
  if (!store) throw new Error('Missing SHOPIFY_STORE env var');

  const token = await getShopifyToken();
  const date = new Date().toISOString().slice(0, 10);
  const items = [];
  let nullCostCount = 0;

  for (const vendor of COLLECTIVE_VENDORS) {
    let cursor = null;
    let page = 0;
    let vendorCount = 0;

    do {
      if (page > 0) await new Promise(r => setTimeout(r, 300));

      const result = await httpsPost(
        store,
        '/admin/api/2025-01/graphql.json',
        { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
        { query: COST_QUERY, variables: { query: `vendor:"${vendor}"`, cursor } }
      );

      if (result.status !== 200) {
        console.error(`GraphQL error for vendor "${vendor}" (page ${page}): ${result.status}`, JSON.stringify(result.body));
        break;
      }

      const gqlErrors = result.body.errors;
      if (gqlErrors?.length) {
        console.error(`GraphQL errors for vendor "${vendor}":`, JSON.stringify(gqlErrors));
        break;
      }

      const products = result.body.data?.products;
      if (!products) break;

      for (const product of products.nodes) {
        for (const variant of product.variants.nodes) {
          const rawCost = variant.inventoryItem?.unitCost?.amount;
          const cost = rawCost != null ? parseFloat(rawCost) : null;
          const variantId = variant.id?.replace('gid://shopify/ProductVariant/', '') ?? null;

          if (cost === null) nullCostCount++;

          items.push({
            sku: variant.sku || null,
            variantId,
            vendor: product.vendor,
            title: `${product.title} — ${variant.title}`,
            retailPrice: parseFloat(variant.price || 0),
            cost,
            flagged: cost === null,
          });
          vendorCount++;
        }
      }

      cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
      page++;
    } while (cursor && page < 50);

    console.log(`${vendor}: ${vendorCount} variants fetched`);
  }

  const snapshot = {
    date,
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    nullCostCount,
    items,
  };

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${date}.json`,
    Body: JSON.stringify(snapshot),
    ContentType: 'application/json',
  }));

  console.log(`Snapshot complete: ${date}.json — ${items.length} variants, ${nullCostCount} null-cost`);
  return { statusCode: 200, body: JSON.stringify({ date, itemCount: items.length, nullCostCount }) };
};
