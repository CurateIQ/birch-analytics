# Birch Analytics Dashboard

Internal metrics dashboard for Birch — live data from Shopify + Klaviyo + GA4.

## Stack
- React 18
- Recharts (charts)
- Claude API (AI Q&A)
- AWS Amplify (hosting)

---

## Setup for Deep — AWS Amplify Environment Variables

In the Amplify Console → App → Environment variables, add the following:

| Variable | Value | Where to find it |
|---|---|---|
| `REACT_APP_SHOPIFY_STORE` | `birchstoreco.myshopify.com` | Fixed |
| `REACT_APP_SHOPIFY_ACCESS_TOKEN` | `shpat_...` | Shopify Admin → Settings → Apps → Develop apps → metrics dashboard → API credentials |
| `REACT_APP_KLAVIYO_PRIVATE_KEY` | `pk_...` | Klaviyo → Account → Settings → API Keys |
| `REACT_APP_GA4_PROPERTY_ID` | `properties/...` | GA4 Admin → Property settings (add when ready) |

> ⚠️ Never commit these values to the GitHub repo. Always set them in Amplify environment variables only.

---

## Password protection (AWS Amplify)

1. Amplify Console → App settings → Access control
2. Enable "Apply global password"
3. Set username and password
4. Save — takes effect on next deploy

---

## Local development

```bash
# Clone the repo
git clone https://github.com/CurateIQ/birch-analytics
cd birch-analytics

# Install dependencies
npm install

# Create local env file (never commit this)
cp .env.example .env
# Fill in your values in .env

# Start dev server
npm start
```

---

## Deploy

Any push to `main` branch auto-deploys via AWS Amplify.

```bash
git add .
git commit -m "your message"
git push origin main
```

---

## Architecture notes

- All API calls go directly from the browser to Shopify/Klaviyo APIs
- For production hardening, route through an AWS Lambda proxy to keep tokens server-side
- GA4 section will auto-populate once `REACT_APP_GA4_PROPERTY_ID` is set
- Dashboard auto-refreshes every 5 minutes

---

## Pending
- [ ] GA4 connection (conversion rate, sessions, traffic sources)
- [ ] Backend proxy for API token security (post-launch)
- [ ] Password protection setup in Amplify
