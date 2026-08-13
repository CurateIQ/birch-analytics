# birch-api-proxy (AWS Lambda)

Source of truth for the `birch-api-proxy` Lambda (us-east-1, nodejs24.x,
handler `index.handler`), which fronts every external API the dashboard uses:

- `/shopify/*` — Shopify Admin REST (client_credentials token, cached)
- `/shopify/orders-journey` — Shopify Admin GraphQL `customerJourneySummary` /
  UTM attribution data, matched before the generic `/shopify/*` REST handler
- `/klaviyo/*` — Klaviyo v3
- `/ga4/runReport` — GA4 Data API (service-account JWT)
- `/meta/insights` — Meta Marketing API Insights (campaign-level spend/CPC/CPM),
  fails open with `{ error: true, campaigns: [] }` on any upstream error
- `/ai` — Claude (dashboard AI assistant; logs questions to DynamoDB `birch-ai-queries`)
- `/ai/queries` — customer chat analytics, proxied from the birch-ai edge
  worker (`/internal/analytics/chats`, Bearer `ANALYTICS_SECRET`)
- `/ai/session/{id}` — one chat transcript, same upstream

All routes except `/` and `/health` require an `x-api-key` header matching the
`DASHBOARD_API_KEY` env var (fail-open while the env var is unset). The
function URL's CORS `AllowHeaders` must include `x-api-key`.

Env vars: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET,
KLAVIYO_PRIVATE_KEY, GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY,
ANTHROPIC_API_KEY, ALLOWED_ORIGIN, ANALYTICS_SECRET, DASHBOARD_API_KEY,
BIRCH_AI_WORKER_HOST (optional, defaults to birch-ai-edge.api.birchstore.com),
META_ACCESS_TOKEN, META_AD_ACCOUNT_ID (e.g. `act_1558274548998255`).
Pending: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID.

Deploy (no SAM/CFN — direct code update, same flow as birch-registry-scraper):

```sh
cd lambda
zip -j function.zip index.mjs
aws lambda update-function-code --function-name birch-api-proxy \
  --region us-east-1 --zip-file fileb://function.zip
```

The AWS SDK v3 (`@aws-sdk/client-dynamodb`) comes from the Lambda runtime —
do not bundle node_modules.
