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
// Both source AND medium must indicate paid traffic for that platform.
// OR-logic (source alone) incorrectly scoops up organic/referral traffic.
//
// Real values observed from /shopify/orders-journey (verified 2026-09-10):
//   Meta:   source=facebook medium=paid      (campaign = numeric ID)
//           source=ig       medium=social    (campaign usually empty)
//   Google: source=google   medium=product_sync  ← Shopping feed auto-tag, NOT Google Ads
//           Google Ads paid campaigns would use medium=cpc when running
//   Other:  || (direct), Klaviyo|email, affiliate|uppromote — all excluded

const META_PAID_MEDIUMS = new Set(['paid', 'paid_social', 'social']);

function isFromPlatform(order, platform) {
  const src = (order.utmSource || '').toLowerCase();
  const med = (order.utmMedium || '').toLowerCase();
  // Meta: facebook or ig source, with a paid/social medium (not organic/referral)
  if (platform === 'meta')   return (src === 'facebook' || src === 'ig' || src === 'instagram') && META_PAID_MEDIUMS.has(med);
  // Google: cpc medium indicates actual Google Ads (product_sync = Shopping feed, not attributable to campaigns)
  if (platform === 'google') return src === 'google' && med === 'cpc';
  return false;
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

  // Debug: log what UTM campaign values we're trying to match so ID mismatches are visible.
  // To diagnose: open browser console, upload CSVs, check these lines.
  // If "CSV campaign IDs available" is empty → CSV was exported without Campaign ID column (re-export needed).
  // If IDs appear in both lists but still unmatched → type/whitespace mismatch in the values.
  const availableIds   = (adCampaigns || []).map(c => c.campaignId).filter(Boolean);
  const availableNames = (adCampaigns || []).map(c => c.campaignName);
  const utmValues      = grouped.map(g => g.utmCampaign);
  console.debug(`[attribution:${platform}] ${grouped.length} platform-attributed orders passed source filter`);
  console.debug(`[attribution:${platform}] UTM campaign values from Shopify:`, utmValues);
  console.debug(`[attribution:${platform}] CSV campaign IDs available (${availableIds.length}):`, availableIds);
  console.debug(`[attribution:${platform}] CSV campaign names available:`, availableNames);

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

  if (unmatched.length > 0) {
    console.debug(`[attribution:${platform}] Unmatched UTM campaigns (passed source filter but no campaign match):`, unmatched);
  }

  return { campaigns, unmatched };
}
