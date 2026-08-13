/**
 * metaAds.js
 * Meta Marketing API (Insights) — routed through the birch-api-proxy Lambda.
 * Pulls campaign-level spend/CPC/CPM for the Meta ad account.
 *
 * Required environment variables (Lambda env vars, never REACT_APP_*):
 *   META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
 *
 * The Lambda proxy fails open on any Meta API error — this module never
 * throws for upstream errors, it returns { error: true, campaigns: [] }.
 */

import { PROXY, PROXY_HEADERS } from './proxy';

/** Format date as YYYY-MM-DD for Meta */
function fmtDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function metaFetch(params) {
  const url = new URL(`${PROXY}/meta/insights`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: PROXY_HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta API error ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Fetch per-campaign spend/CPC/CPM for a date range (single aggregate per campaign).
 * Returns: { error, campaigns: [{campaignId, campaignName, spend, impressions, clicks, cpc, cpm}] }
 */
export async function fetchMetaCampaignPerformance(startDate, endDate) {
  return metaFetch({ since: fmtDate(startDate), until: fmtDate(endDate) });
}

/**
 * Fetch daily per-campaign breakdown for a date range (for the weekly trend chart).
 * Returns: { error, campaigns: [{campaignId, campaignName, date, spend, impressions, clicks, cpc, cpm}] }
 */
export async function fetchMetaWeeklyTrend(startDate, endDate) {
  return metaFetch({ since: fmtDate(startDate), until: fmtDate(endDate), time_increment: '1' });
}
