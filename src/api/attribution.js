/**
 * attribution.js
 * Shopify order-journey attribution — routed through the birch-api-proxy Lambda.
 * Used to compute true CAC: (ad spend) ÷ (new customers attributed via
 * last-non-direct-click, sourced from Shopify), NOT each platform's own
 * self-reported conversion count.
 */

import { PROXY, PROXY_HEADERS } from './proxy';

function fmtDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Fetch the flat list of orders with new-customer flag + last-non-direct-click UTM.
 * Returns: [{ orderId, isNewCustomer, utmSource, utmMedium, utmCampaign }]
 */
export async function fetchCampaignAttribution(startDate, endDate) {
  const url = new URL(`${PROXY}/shopify/orders-journey`);
  url.searchParams.set('start', fmtDate(startDate));
  url.searchParams.set('end', fmtDate(endDate));
  const res = await fetch(url.toString(), { headers: PROXY_HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify orders-journey error ${res.status}: ${text}`);
  }
  return res.json();
}

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── platform source detection ─────────────────────────────────────────────────

const META_SOURCES   = ['facebook', 'instagram', 'fb', 'ig'];
const GOOGLE_SOURCES = ['google', 'googleads', 'adwords'];

function isFromPlatform(order, platform) {
  const src = (order.utmSource || '').toLowerCase();
  const med = (order.utmMedium || '').toLowerCase();
  if (platform === 'meta')   return META_SOURCES.includes(src) || med === 'paid_social';
  if (platform === 'google') return GOOGLE_SOURCES.includes(src) || med === 'cpc';
  return true;
}

// ── matching ─────────────────────────────────────────────────────────────────

/**
 * Match a UTM campaign value against an ad platform campaign.
 * Tries ID match first (Meta tags URLs with {{campaign.id}}, not {{campaign.name}}),
 * then falls back to normalized name comparison.
 */
export function matchCampaignToAdPlatform(utmCampaign, adCampaign) {
  if (!utmCampaign || !adCampaign) return false;
  // ID match: numeric UTM value vs campaignId field from CSV
  if (adCampaign.campaignId && utmCampaign === adCampaign.campaignId) return true;
  // Name fallback: normalized string comparison
  return normalize(utmCampaign) === normalize(adCampaign.campaignName);
}

/**
 * Groups journey orders by their UTM campaign value and counts new customers.
 * Only includes orders from the specified platform (source/medium filtering).
 * Returns: [{ utmCampaign, newCustomers, totalOrders }]
 */
export function aggregateNewCustomersByCampaign(journeyOrders, platform) {
  const map = {};
  const platformOrders = platform
    ? (journeyOrders || []).filter(o => isFromPlatform(o, platform))
    : (journeyOrders || []);

  platformOrders.forEach(o => {
    const key = o.utmCampaign || '(none)';
    if (!map[key]) map[key] = { utmCampaign: key, newCustomers: 0, totalOrders: 0 };
    map[key].totalOrders += 1;
    if (o.isNewCustomer) map[key].newCustomers += 1;
  });
  return Object.values(map);
}

/**
 * Joins ad-platform campaigns (with spend) to Shopify attribution data.
 * `platform` ('meta' or 'google') filters journey orders to only those sourced
 * from that platform before matching — organic/email/etc. are excluded entirely
 * and will not appear in `unmatched`.
 * Returns: { campaigns: [{...adCampaign, newCustomerCount, cac}], unmatched: [utmCampaign] }
 */
export function attributeCampaignsToAdPlatform(adCampaigns, journeyOrders, platform) {
  const grouped = aggregateNewCustomersByCampaign(journeyOrders, platform);
  const usedUtm = new Set();

  const campaigns = (adCampaigns || []).map(c => {
    const match = grouped.find(g => matchCampaignToAdPlatform(g.utmCampaign, c));
    if (match) usedUtm.add(match.utmCampaign);
    const newCustomerCount = match ? match.newCustomers : 0;
    const cac = newCustomerCount > 0 && c.spend != null ? Math.round((c.spend / newCustomerCount) * 100) / 100 : null;
    return { ...c, newCustomerCount, cac };
  });

  // Only platform-sourced orders that didn't match any campaign are unmatched
  const unmatched = grouped
    .filter(g => g.utmCampaign !== '(none)' && !usedUtm.has(g.utmCampaign))
    .map(g => g.utmCampaign);

  return { campaigns, unmatched };
}
