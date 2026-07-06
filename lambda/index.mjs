import https from 'https';
import crypto from 'crypto';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const dynamo = new DynamoDBClient({ region: 'us-east-1' });
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
  const result = await httpsGet(BIRCH_AI_HOST, `/internal/analytics/chats?days=${days}&limit=${limit}`, {
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

  const result = await httpsPost(store, '/admin/oauth/access_token', { 'Content-Type': 'application/json' },
    JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' })
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

  if (rawPath.startsWith('/shopify/')) {
    return handleShopify(rawPath.replace('/shopify', ''), queryString);
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

  return err(404, `Route not found: ${rawPath}`);
};
