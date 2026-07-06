/**
 * proxy.js
 * Shared base URL + auth header for the birch-api-proxy Lambda.
 * The key is a static dashboard credential baked in at build time
 * (REACT_APP_PROXY_KEY — set in Amplify env vars / .env.local).
 * The Lambda rejects requests without a matching x-api-key header.
 */

export const PROXY = 'https://ez5e63jmydqmttr3qorvopyyt40baytn.lambda-url.us-east-1.on.aws';

export const PROXY_HEADERS = { 'x-api-key': process.env.REACT_APP_PROXY_KEY || '' };
