import https from 'https';
import crypto from 'crypto';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const dynamo = new DynamoDBClient({ region: 'us-east-1' });
const s3 = new S3Client({ region: 'us-east-1' });
const AI_TABLE = 'birch-ai-queries';

// birch-ai edge worker — source of customer chat analytics (D1-backed).
const BIRCH_AI_HOST = process.env.BIRCH_AI_WORKER_HOST || 'birch-ai-edge.api.birchstore.com';

async function logAIQuery(query, source) {
  try {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const ts = now.toISOString();
    const ttl = Math.floor(now.getTime() / 1000) + 90 * 24 * 60 * 60; // 90 days
    await dynamo.send(new PutItemCommand({
      TableName: AI_TABLE,
      Item: {
        date:   { S: date },
        ts:     { S: ts },
        query:  { S: query.slice(0, 1000) },
        source: { S: source },
        ttl:    { N: String(ttl) },
      },
    }));
  } catch (e) {
    console.error('Failed to log AI query:', e.message);
  }
}

// Customer chat analytics, proxied from the birch-ai edge worker (reads its
// D1 chat_sessions store; edge-cached 5 min worker-side). Replaces the old
// DynamoDB read, which only ever held the dashboard's own AI-assistant
// questions — never storefront customer chats.
async function handleChatQueries(queryString) {
  const secret = process.env.ANALYTICS_SECRET;
  if (!secret) return err(500, 'Missing ANALYTICS_SECRET');
  const params = new URLSearchParams(queryString);
  const days = parseInt(params.get('days'), 10) || 7;
  const limit = parseInt(params.get('limit'), 10) || 25;
  const offset = parseInt(params.get('offset'), 10) || 0;
  const result = await httpsGet(BIRCH_AI_HOST, `/internal/analytics/chats?days=${days}&limit=${limit}&offset=${offset}`, {
    'Authorization': `Bearer ${secret}`,
  });
  if (result.status !== 200) return err(result.status, `Chat analytics error: ${JSON.stringify(result.body)}`);
  return ok(result.body);
}

async function handleChatTranscript(sessionId) {
  const secret = process.env.ANALYTICS_SECRET;
  if (!secret) return err(500, 'Missing ANALYTICS_SECRET');
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) return err(400, 'Invalid session id');
  const result = await httpsGet(BIRCH_AI_HOST, `/internal/analytics/chats/${encodeURIComponent(sessionId)}`, {
    'Authorization': `Bearer ${secret}`,
  });
  if (result.status !== 200) return err(result.status, `Chat transcript error: ${JSON.stringify(result.body)}`);
  return ok(result.body);
}

// ── helpers ───────────────────────────────────────────────────────────────────

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

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'GET', headers },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, headers: res.headers, body: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function ok(body) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function err(status, message) {
  console.error(`Error ${status}:`, message);
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}

// ── Shopify token cache ───────────────────────────────────────────────────────

let cachedShopifyToken = null;
let shopifyTokenExpiry = 0;

async function getShopifyToken() {
  if (cachedShopifyToken && Date.now() < shopifyTokenExpiry) return cachedShopifyToken;

  // Use pre-set static token on first load only (cache for 23h, then refresh via client_credentials)
  const staticToken = process.env.SHOPIFY_ACCESS_TOKEN;
  if (staticToken && shopifyTokenExpiry === 0) {
    console.log('Using SHOPIFY_ACCESS_TOKEN env var');
    cachedShopifyToken = staticToken;
    shopifyTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return cachedShopifyToken;
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const store = process.env.SHOPIFY_STORE;

  if (!clientId || !clientSecret || !store) throw new Error('Missing Shopify credentials');

  const body = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
  const result = await httpsPost(store, '/admin/oauth/access_token', { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  );

  console.log('Shopify token refresh status:', result.status, 'body keys:', Object.keys(result.body || {}));
  if (!result.body.access_token) throw new Error(`Shopify token refresh failed: ${JSON.stringify(result.body)}`);
  cachedShopifyToken = result.body.access_token;
  const expiresIn = result.body.expires_in || 86400;
  shopifyTokenExpiry = Date.now() + (expiresIn - 300) * 1000;
  return cachedShopifyToken;
}

// ── GA4 token cache ───────────────────────────────────────────────────────────

let cachedGA4Token = null;
let ga4TokenExpiry = 0;

function makeGA4JWT(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = sign.sign(privateKey, 'base64url');
  return `${header}.${payload}.${sig}`;
}

async function getGA4Token() {
  if (cachedGA4Token && Date.now() < ga4TokenExpiry) return cachedGA4Token;

  const email = process.env.GA4_CLIENT_EMAIL;
  const rawKey = process.env.GA4_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error('Missing GA4_CLIENT_EMAIL or GA4_PRIVATE_KEY');

  const privateKey = rawKey.replace(/\\n/g, '\n');
  const jwt = makeGA4JWT(email, privateKey);

  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!result.body.access_token) throw new Error(`GA4 token exchange failed: ${JSON.stringify(result.body)}`);
  cachedGA4Token = result.body.access_token;
  ga4TokenExpiry = Date.now() + 55 * 60 * 1000; // 55 min (tokens last 60)
  return cachedGA4Token;
}

// ── route handlers ────────────────────────────────────────────────────────────

async function shopifyRequest(token, store, normalizedPath, qs) {
  return httpsGet(store, `/admin/api/2025-01${normalizedPath}${qs}`, {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  });
}

async function handleShopifyGraphQL(reqBody) {
  const store = process.env.SHOPIFY_STORE;
  if (!store) return err(500, 'Missing SHOPIFY_STORE');

  const doRequest = (token) => httpsPost(
    store,
    '/admin/api/2025-01/graphql.json',
    { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    reqBody
  );

  let token = await getShopifyToken();
  let result = await doRequest(token);

  if (result.status === 401) {
    console.log('Shopify GraphQL 401 — forcing token refresh');
    cachedShopifyToken = null;
    shopifyTokenExpiry = 1;
    token = await getShopifyToken();
    result = await doRequest(token);
  }

  if (result.status !== 200) return err(result.status, `Shopify GraphQL error: ${JSON.stringify(result.body)}`);
  return ok(result.body);
}

async function handleShopify(subPath, queryString) {
  const store = process.env.SHOPIFY_STORE;
  const qs = queryString ? `?${queryString}` : '';
  const normalizedPath = subPath.endsWith('.json') ? subPath : `${subPath}.json`;

  let token = await getShopifyToken();
  let result = await shopifyRequest(token, store, normalizedPath, qs);

  // Auto-refresh on 401 (token expired) and retry once
  if (result.status === 401) {
    console.log('Shopify 401 — forcing client_credentials refresh');
    cachedShopifyToken = null;
    shopifyTokenExpiry = 1; // non-zero so getShopifyToken skips SHOPIFY_ACCESS_TOKEN and calls client_credentials
    token = await getShopifyToken();
    result = await shopifyRequest(token, store, normalizedPath, qs);
  }

  if (result.status >= 300 && result.status < 400) {
    console.error(`Shopify redirect ${result.status} to: ${result.headers?.location}`);
    return err(result.status, `Shopify redirected to: ${result.headers?.location}`);
  }
  if (result.status !== 200) return err(result.status, `Shopify API error: ${JSON.stringify(result.body)}`);

  // Extract next_page_info from Shopify Link header so the frontend can paginate.
  const linkHeader = result.headers?.link || '';
  const match = linkHeader.match(/<[^>]*[?&]page_info=([^& >]+)[^>]*>;\s*rel="next"/);
  const nextPageInfo = match ? decodeURIComponent(match[1]) : null;
  const responseBody = nextPageInfo
    ? { ...result.body, next_page_info: nextPageInfo }
    : result.body;
  return ok(responseBody);
}

async function handleVeeqo(subPath, queryString) {
  const key = process.env.VEEQO_API_KEY;
  if (!key) return err(500, 'Missing VEEQO_API_KEY');
  const qs = queryString ? `?${queryString}` : '';
  const result = await httpsGet('api.veeqo.com', `${subPath}${qs}`, {
    'x-api-key': key,
    'Accept': 'application/json',
  });
  if (result.status !== 200) return err(result.status, `Veeqo API error: ${JSON.stringify(result.body)}`);
  return ok(result.body);
}

async function handleKlaviyo(subPath, queryString) {
  const key = process.env.KLAVIYO_PRIVATE_KEY;
  if (!key) return err(500, 'Missing KLAVIYO_PRIVATE_KEY');
  // Strip fields Klaviyo v3 doesn't support in sparse fieldsets
  const cleanedQS = queryString
    ? queryString.replace(/(?:^|&)fields%5Blist%5D=[^&]*/g, (match) => {
        const decoded = decodeURIComponent(match.replace(/^&/, '').replace('fields%5Blist%5D=', ''));
        const valid = ['created', 'id', 'name', 'opt_in_process', 'updated'];
        const filtered = decoded.split(',').filter(f => valid.includes(f)).join(',');
        return filtered ? `&fields%5Blist%5D=${encodeURIComponent(filtered)}` : '';
      }).replace(/^&/, '')
    : '';
  const qs = cleanedQS ? `?${cleanedQS}` : '';
  const result = await httpsGet('a.klaviyo.com', `/api${subPath}${qs}`, {
    'Authorization': `Klaviyo-API-Key ${key}`,
    'revision': '2024-10-15',
    'Accept': 'application/json',
  });
  if (result.status !== 200) return err(result.status, `Klaviyo API error: ${JSON.stringify(result.body)}`);
  return ok(result.body);
}

async function handleGA4RunReport(reqBody) {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) return err(500, 'Missing GA4_PROPERTY_ID');

  const token = await getGA4Token();
  // Strip propertyId from body — it belongs in the URL path, not the request body
  const { propertyId: _ignored, ...cleanBody } = reqBody;
  const body = JSON.stringify(cleanBody);

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'analyticsdata.googleapis.com',
        path: `/v1beta/properties/${propertyId}:runReport`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
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
    req.write(body);
    req.end();
  });

  if (result.status !== 200) return err(result.status, `GA4 API error: ${JSON.stringify(result.body)}`);
  return ok(result.body);
}

// ── Meta Marketing API ────────────────────────────────────────────────────────

async function handleMetaInsights(queryString) {
  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  if (!token || !adAccountId) return ok({ error: true, campaigns: [] });

  try {
    const params = new URLSearchParams(queryString);
    const since = params.get('since');
    const until = params.get('until');
    const daily = params.get('time_increment') === '1';

    const qs = new URLSearchParams({
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
      level: 'campaign',
      time_range: JSON.stringify({ since, until }),
      limit: '500',
    });
    if (daily) qs.set('time_increment', '1');

    const result = await httpsGet('graph.facebook.com', `/v21.0/${adAccountId}/insights?${qs.toString()}`, {
      'Authorization': `Bearer ${token}`,
    });

    if (result.status !== 200 || result.body?.error) {
      console.error('Meta insights error:', JSON.stringify(result.body));
      return ok({ error: true, campaigns: [] });
    }

    const campaigns = (result.body?.data || []).map(row => {
      const spend = parseFloat(row.spend || '0');
      const impressions = parseInt(row.impressions || '0', 10);
      const clicks = parseInt(row.clicks || '0', 10);
      return {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
        date: row.date_start || null,
        spend,
        impressions,
        clicks,
        actions: row.actions || [],
        cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
        cpm: impressions > 0 ? Math.round((spend / (impressions / 1000)) * 100) / 100 : null,
      };
    });

    return ok({ error: false, campaigns });
  } catch (e) {
    console.error('Meta insights exception:', e.message);
    return ok({ error: true, campaigns: [] });
  }
}

// ── Shopify orders journey (attribution) ──────────────────────────────────────

async function shopifyGraphQL(store, token, query, variables) {
  return httpsPost(
    store,
    '/admin/api/2025-01/graphql.json',
    { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    { query, variables }
  );
}

const ORDERS_JOURNEY_QUERY = `
  query OrdersJourney($searchQuery: String!, $cursor: String) {
    orders(first: 100, after: $cursor, query: $searchQuery) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          customer { numberOfOrders }
          customerJourneySummary {
            lastVisit { utmParameters { source medium campaign } }
          }
        }
      }
    }
  }
`;

async function handleShopifyOrdersJourney(queryString) {
  const store = process.env.SHOPIFY_STORE;
  if (!store) return ok([]);

  try {
    const params = new URLSearchParams(queryString);
    const start = params.get('start');
    const end = params.get('end');
    const searchQuery = `created_at:>=${start} AND created_at:<=${end}`;

    const token = await getShopifyToken();
    const orders = [];
    let cursor = null;
    let pages = 0;

    do {
      const result = await shopifyGraphQL(store, token, ORDERS_JOURNEY_QUERY, { searchQuery, cursor });
      if (result.status !== 200 || result.body?.errors) {
        console.error('Shopify orders-journey GraphQL error:', JSON.stringify(result.body?.errors || result.body));
        break;
      }
      const edges = result.body?.data?.orders?.edges || [];
      edges.forEach(({ node }) => {
        const utm = node.customerJourneySummary?.lastVisit?.utmParameters;
        orders.push({
          orderId: node.id,
          isNewCustomer: parseInt(node.customer?.numberOfOrders, 10) === 1,
          utmSource: utm?.source || null,
          utmMedium: utm?.medium || null,
          utmCampaign: utm?.campaign || null,
        });
      });
      const pageInfo = result.body?.data?.orders?.pageInfo;
      cursor = pageInfo?.hasNextPage ? pageInfo.endCursor : null;
      pages++;
    } while (cursor && pages < 20);

    return ok(orders);
  } catch (e) {
    console.error('Shopify orders-journey exception:', e.message);
    return ok([]);
  }
}

async function handleAI(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err(500, 'Missing ANTHROPIC_API_KEY');

  const { messages, system, source } = body;
  if (!messages || !Array.isArray(messages)) return err(400, 'messages array is required');

  // Log the first user message (the actual query)
  const firstUserMsg = messages.find(m => m.role === 'user')?.content;
  if (firstUserMsg) {
    logAIQuery(firstUserMsg, source || 'unknown'); // fire-and-forget
  }

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages, ...(system ? { system } : {}) }
  );

  if (result.status !== 200) return err(result.status, `Anthropic API error: ${JSON.stringify(result.body)}`);
  return ok(result.body);
}

// ── cost snapshot reader ──────────────────────────────────────────────────────

async function handleCostSnapshots(queryString) {
  const bucket = process.env.COST_SNAPSHOTS_BUCKET;
  // If bucket not configured yet, return gracefully so the frontend can fall back.
  if (!bucket) return ok({ snapshot: null, dates: [], estimatedOnly: true });

  const params = new URLSearchParams(queryString);
  const mode = params.get('mode');
  const date = params.get('date');

  try {
    const listResult = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    const dates = (listResult.Contents || [])
      .map(o => o.Key.replace('.json', ''))
      .filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k))
      .sort();

    if (mode === 'list') return ok({ dates });

    if (!dates.length) return ok({ snapshot: null, dates: [], estimatedOnly: true });

    let targetDate;
    if (mode === 'latest') {
      targetDate = dates[dates.length - 1];
    } else if (date) {
      // Most recent snapshot on or before requested date; fall back to earliest.
      const before = dates.filter(d => d <= date);
      targetDate = before.length > 0 ? before[before.length - 1] : dates[0];
    } else {
      return err(400, 'Specify mode=list, mode=latest, or date=YYYY-MM-DD');
    }

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `${targetDate}.json` }));
    const body = await obj.Body.transformToString();
    const snapshot = JSON.parse(body);
    return ok({ snapshot, date: targetDate, firstSnapshotDate: dates[0], estimatedOnly: false });
  } catch (e) {
    console.error('Cost snapshot read error:', e.message);
    // Return gracefully so frontend falls back to live GraphQL.
    return ok({ snapshot: null, dates: [], estimatedOnly: true, _error: e.message });
  }
}

// ── manual wholesale cost storage (S3, same bucket as cost-snapshots) ─────────

const MW_KEY = 'manual-wholesale/costs.json';

async function getMWCosts() {
  const bucket = process.env.COST_SNAPSHOTS_BUCKET;
  if (!bucket) return {};
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: MW_KEY }));
    const body = await res.Body.transformToString();
    return JSON.parse(body);
  } catch (e) {
    if (e.name === 'NoSuchKey') return {};
    throw e;
  }
}

async function putMWCosts(data) {
  const bucket = process.env.COST_SNAPSHOTS_BUCKET;
  if (!bucket) throw new Error('COST_SNAPSHOTS_BUCKET not configured');
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: MW_KEY,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));
}

async function handleManualWholesaleCostsGet() {
  const data = await getMWCosts();
  return ok(data);
}

async function handleManualWholesaleCostsPut(rawBody) {
  const { rows } = JSON.parse(rawBody);
  if (!Array.isArray(rows)) return err(400, 'rows must be an array');
  const existing = await getMWCosts();
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
  await putMWCosts(existing);
  return ok({ saved: rows.length, total: Object.keys(existing).length });
}

async function handleManualWholesaleParse(rawBody) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err(500, 'Missing ANTHROPIC_API_KEY');

  const { vendor, fileBase64, mediaType, fileText } = JSON.parse(rawBody);

  let content;
  let prompt;

  if (vendor === 'babybay') {
    prompt = 'This is a BabyBay weekly settlement invoice. Extract all order rows. Return JSON only (no explanation): { "rows": [ { "orderId": "1132", "cost": 54.19, "orderDate": "2026-08-07" } ] }. orderId = Order ID column (number as string). cost = Net Payout column (number). orderDate = YYYY-MM-DD.';
  } else if (vendor === 'naturepedic') {
    prompt = 'This is a Naturepedic order confirmation. Extract: PO # (= Shopify order number) and Total (what Birch owes, including shipping + tax). Return JSON only: { "orderId": "1347", "cost": 262.51 }. orderId = PO # field. cost = Total amount (number, no $ sign).';
  } else {
    return err(400, `Unknown vendor: ${vendor}`);
  }

  if (fileText) {
    content = [{ type: 'text', text: `${prompt}\n\nDocument content:\n${fileText}` }];
  } else {
    content = [
      { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileBase64 } },
      { type: 'text', text: prompt },
    ];
  }

  const result = await httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    { model: 'claude-haiku-4-5-20251001', max_tokens: 2048, messages: [{ role: 'user', content }] }
  );

  if (result.status !== 200) return err(result.status, `Anthropic API error: ${JSON.stringify(result.body)}`);

  const text = result.body?.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return err(422, JSON.stringify({ error: 'Could not extract JSON from Claude response', raw: text }));

  try {
    return ok(JSON.parse(jsonMatch[0]));
  } catch {
    return err(422, JSON.stringify({ error: 'Invalid JSON from Claude', raw: text }));
  }
}

// ── main handler ──────────────────────────────────────────────────────────────

// Static dashboard API key. Function-URL CORS already restricts browser
// origins; this stops direct curl access. Fail-open when the env var is
// unset so the Lambda can deploy before the key is provisioned.
function checkApiKey(event) {
  const expected = process.env.DASHBOARD_API_KEY;
  if (!expected) return true;
  const provided = event.headers?.['x-api-key'] || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const handler = async (event) => {
  const rawPath = event.rawPath || event.path || '/';
  const queryString = event.rawQueryString || '';

  console.log('Request:', rawPath, queryString ? `?${queryString}` : '');

  if (rawPath === '/' || rawPath === '/health') {
    return ok({ status: 'ok', timestamp: new Date().toISOString() });
  }

  if (!checkApiKey(event)) return err(401, 'Unauthorized');

  if (rawPath === '/ai') {
    let body;
    try { body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body; }
    catch { return err(400, 'Invalid JSON body'); }
    return handleAI(body);
  }

  if (rawPath === '/ai/queries') {
    return handleChatQueries(queryString);
  }

  if (rawPath.startsWith('/ai/session/')) {
    return handleChatTranscript(rawPath.replace('/ai/session/', ''));
  }

  if (rawPath === '/shopify/orders-journey') {
    return handleShopifyOrdersJourney(queryString);
  }

  if (rawPath === '/cost-snapshots') {
    return handleCostSnapshots(queryString);
  }

  if (rawPath === '/shopify/graphql') {
    let body;
    try { body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {}); }
    catch { return err(400, 'Invalid JSON body'); }
    return handleShopifyGraphQL(body);
  }

  if (rawPath.startsWith('/shopify/')) {
    return handleShopify(rawPath.replace('/shopify', ''), queryString);
  }

  if (rawPath.startsWith('/veeqo/')) {
    return handleVeeqo(rawPath.replace('/veeqo', ''), queryString);
  }

  if (rawPath.startsWith('/klaviyo/')) {
    return handleKlaviyo(rawPath.replace('/klaviyo', ''), queryString);
  }

  if (rawPath === '/ga4/runReport') {
    let body;
    try { body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {}); }
    catch { return err(400, 'Invalid JSON body'); }
    return handleGA4RunReport(body);
  }

  if (rawPath === '/meta/insights') {
    return handleMetaInsights(queryString);
  }

  if (rawPath === '/manual-wholesale/costs') {
    if (event.requestContext?.http?.method === 'PUT' || event.httpMethod === 'PUT') {
      return handleManualWholesaleCostsPut(event.body || '{}');
    }
    return handleManualWholesaleCostsGet();
  }

  if (rawPath === '/manual-wholesale/parse') {
    return handleManualWholesaleParse(event.body || '{}');
  }

  return err(404, `Route not found: ${rawPath}`);
};
