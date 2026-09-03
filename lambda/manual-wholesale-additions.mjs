/**
 * LAMBDA ADDITIONS — paste these into lambda/index.mjs
 *
 * SETUP REQUIRED before deploying:
 *   1. npm install @anthropic-ai/sdk (in the lambda/ directory)
 *   2. Add Lambda env vars:
 *        ANTHROPIC_API_KEY = sk-ant-...
 *        MANUAL_WHOLESALE_BUCKET = <same bucket used for cost-snapshots>
 *        MANUAL_WHOLESALE_KEY = manual-wholesale/costs.json   (can leave default)
 *   3. Ensure Lambda execution role has s3:GetObject + s3:PutObject on the bucket
 *   4. Redeploy: zip -j function.zip index.mjs node_modules && aws lambda update-function-code ...
 *
 * ROUTES added:
 *   GET  /manual-wholesale/costs         → returns stored cost map
 *   PUT  /manual-wholesale/costs         → merges new rows into stored map
 *   POST /manual-wholesale/parse         → parses supplier doc via Claude, returns extracted rows
 */

// ── add these imports at the top of index.mjs ─────────────────────────────────
//
//   import Anthropic from '@anthropic-ai/sdk';
//   import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
//
// ── add these near the top of index.mjs (after imports) ──────────────────────
//
//   const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
//   const MW_BUCKET = process.env.MANUAL_WHOLESALE_BUCKET;
//   const MW_KEY    = process.env.MANUAL_WHOLESALE_KEY || 'manual-wholesale/costs.json';

// ── paste this function block into index.mjs ──────────────────────────────────

async function getS3JSON(bucket, key) {
  try {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const res = await s3.send(cmd);
    const body = await res.Body.transformToString();
    return JSON.parse(body);
  } catch (e) {
    if (e.name === 'NoSuchKey') return {};
    throw e;
  }
}

async function putS3JSON(bucket, key, data) {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  });
  await s3.send(cmd);
}

async function handleManualWholesaleCostsGet() {
  const data = await getS3JSON(MW_BUCKET, MW_KEY);
  return { statusCode: 200, body: JSON.stringify(data) };
}

async function handleManualWholesaleCostsPut(body) {
  const { rows } = JSON.parse(body);
  if (!Array.isArray(rows)) return { statusCode: 400, body: JSON.stringify({ error: 'rows must be an array' }) };

  const existing = await getS3JSON(MW_BUCKET, MW_KEY);

  for (const row of rows) {
    if (!row.orderId || row.cost == null) continue;
    existing[String(row.orderId)] = {
      cost:    parseFloat(row.cost),
      vendor:  row.vendor,
      source:  row.source,
      date:    row.date,
      savedAt: new Date().toISOString(),
    };
  }

  await putS3JSON(MW_BUCKET, MW_KEY, existing);
  return { statusCode: 200, body: JSON.stringify({ saved: rows.length, total: Object.keys(existing).length }) };
}

async function handleManualWholesaleParse(body) {
  const { vendor, fileBase64, mediaType, fileText } = JSON.parse(body);

  let userContent;

  if (fileText) {
    // CSV/text — BabyBay
    userContent = [
      {
        type: 'text',
        text: `This is a BabyBay weekly settlement invoice in CSV/text format:\n\n${fileText}\n\nExtract all order rows. Return JSON: { "rows": [ { "orderId": "1132", "cost": 54.19, "orderDate": "2026-08-07" }, ... ] }\norderId is the numeric Order ID column. cost is the Net Payout column (number, no $ sign). orderDate is YYYY-MM-DD.`,
      },
    ];
  } else if (vendor === 'babybay') {
    userContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: mediaType, data: fileBase64 },
      },
      {
        type: 'text',
        text: 'This is a BabyBay weekly settlement invoice. Extract all order rows. Return JSON only (no explanation): { "rows": [ { "orderId": "1132", "cost": 54.19, "orderDate": "2026-08-07" }, ... ] }. orderId is the Order ID column. cost is the Net Payout column (number, no $ sign). orderDate is YYYY-MM-DD.',
      },
    ];
  } else if (vendor === 'naturepedic') {
    userContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: mediaType, data: fileBase64 },
      },
      {
        type: 'text',
        text: 'This is a Naturepedic order confirmation. Extract: (1) PO # — this is the Shopify order number, (2) the Total amount — what Birch owes Naturepedic (includes items, shipping, tax). Return JSON only: { "orderId": "1347", "total": 262.51 }. orderId is the PO # field. total is the Total dollar amount (number, no $ sign).',
      },
    ];
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown vendor: ${vendor}` }) };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = msg.content[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { statusCode: 422, body: JSON.stringify({ error: 'Claude could not extract structured data', raw: text }) };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { statusCode: 422, body: JSON.stringify({ error: 'Invalid JSON from Claude', raw: text }) };
  }

  return { statusCode: 200, body: JSON.stringify(parsed) };
}

// ── add these cases to your main route-dispatch switch/if block ───────────────
//
//   } else if (path === '/manual-wholesale/costs' && method === 'GET') {
//     result = await handleManualWholesaleCostsGet();
//   } else if (path === '/manual-wholesale/costs' && method === 'PUT') {
//     result = await handleManualWholesaleCostsPut(event.body);
//   } else if (path === '/manual-wholesale/parse' && method === 'POST') {
//     result = await handleManualWholesaleParse(event.body);
//   }
