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

/** Normalizes both names (lowercase, strip non-alphanumerics) and compares. */
export function matchCampaignToAdPlatform(utmCampaign, adPlatformCampaignName) {
  if (!utmCampaign || !adPlatformCampaignName) return false;
  return normalize(utmCampaign) === normalize(adPlatformCampaignName);
}

/**
 * Groups journey orders by their UTM campaign value and counts new customers.
 * Returns: [{ utmCampaign, newCustomers, totalOrders }]
 */
export function aggregateNewCustomersByCampaign(journeyOrders) {
  const map = {};
  (journeyOrders || []).forEach(o => {
    const key = o.utmCampaign || '(none)';
    if (!map[key]) map[key] = { utmCampaign: key, newCustomers: 0, totalOrders: 0 };
    map[key].totalOrders += 1;
    if (o.isNewCustomer) map[key].newCustomers += 1;
  });
  return Object.values(map);
}

/**
 * Joins ad-platform campaigns (with spend) to Shopify attribution data.
 * Any UTM campaign value with attributed orders that doesn't match an ad
 * platform campaign name is pushed into `unmatched` rather than dropped.
 * Returns: { campaigns: [{...adCampaign, newCustomerCount, cac}], unmatched: [utmCampaign] }
 */
export function attributeCampaignsToAdPlatform(adCampaigns, journeyOrders) {
  const grouped = aggregateNewCustomersByCampaign(journeyOrders);
  const usedUtm = new Set();

  const campaigns = (adCampaigns || []).map(c => {
    const match = grouped.find(g => matchCampaignToAdPlatform(g.utmCampaign, c.campaignName));
    if (match) usedUtm.add(match.utmCampaign);
    const newCustomerCount = match ? match.newCustomers : 0;
    const cac = newCustomerCount > 0 && c.spend != null ? Math.round((c.spend / newCustomerCount) * 100) / 100 : null;
    return { ...c, newCustomerCount, cac };
  });

  const unmatched = grouped
    .filter(g => g.utmCampaign !== '(none)' && !usedUtm.has(g.utmCampaign))
    .map(g => g.utmCampaign);

  return { campaigns, unmatched };
}
