/**
 * campaignData.js
 * Fetch, aggregate, and join campaign data from manual CSV uploads stored in Lambda/S3.
 *
 * Meta: daily rows → rolling 7D / 30D aggregation + Shopify attribution CAC
 * Google: weekly rows → last complete week / last 4 complete weeks
 */

import { PROXY, PROXY_HEADERS } from './proxy';
import { fetchCampaignAttribution, attributeCampaignsToAdPlatform } from './attribution';

function fmtDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export async function fetchStoredCampaignData() {
  try {
    const res = await fetch(`${PROXY}/campaigns/data`, { headers: PROXY_HEADERS });
    if (!res.ok) return { meta: null, google: null };
    return res.json();
  } catch {
    return { meta: null, google: null };
  }
}

export async function uploadCampaignData(platform, rows) {
  const res = await fetch(`${PROXY}/campaigns/upload`, {
    method: 'POST',
    headers: { ...PROXY_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, rows, uploadedAt: new Date().toISOString() }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── aggregation helpers ───────────────────────────────────────────────────────

function aggregateMetaRows(rows, startDate, endDate) {
  const start = fmtDate(startDate);
  const end   = fmtDate(endDate);
  const inRange = rows.filter(r => r.date >= start && r.date < end);

  const map = {};
  inRange.forEach(r => {
    if (!map[r.campaignName]) {
      map[r.campaignName] = { campaignName: r.campaignName, campaignId: r.campaignId || null, spend: 0, impressions: 0, clicks: 0, purchases: 0 };
    }
    const c = map[r.campaignName];
    c.spend       += r.spend;
    c.impressions += r.impressions;
    c.clicks      += r.clicks;
    c.purchases   += r.purchases;
  });

  return Object.values(map).map(c => ({
    ...c,
    cpc: c.clicks > 0 ? Math.round((c.spend / c.clicks) * 100) / 100 : null,
    cpm: c.impressions > 0 ? Math.round((c.spend / (c.impressions / 1000)) * 100) / 100 : null,
  }));
}

function getCompleteGoogleWeeks(rows, n) {
  const today = fmtDate(new Date());
  const allWeekStarts = [...new Set(rows.map(r => r.weekStart))].sort().reverse();
  // A week starting on 'ws' is complete when ws + 7 days <= today
  const complete = allWeekStarts.filter(ws => {
    const weekEndDate = new Date(ws);
    weekEndDate.setDate(weekEndDate.getDate() + 7);
    return fmtDate(weekEndDate) <= today;
  });
  return complete.slice(0, n);
}

function aggregateGoogleRows(rows, weekStarts) {
  const wsSet = new Set(weekStarts);
  const inRange = rows.filter(r => wsSet.has(r.weekStart));

  const map = {};
  inRange.forEach(r => {
    if (!map[r.campaignName]) {
      map[r.campaignName] = { campaignName: r.campaignName, campaignId: r.campaignId || null, spend: 0, impressions: 0, clicks: 0, conversions: 0 };
    }
    const c = map[r.campaignName];
    c.spend       += r.spend;
    c.impressions += r.impressions;
    c.clicks      += r.clicks;
    c.conversions += r.conversions;
  });

  return Object.values(map).map(c => ({
    ...c,
    cpc: c.clicks > 0 ? Math.round((c.spend / c.clicks) * 100) / 100 : null,
    cpm: c.impressions > 0 ? Math.round((c.spend / (c.impressions / 1000)) * 100) / 100 : null,
    // Google's own reported conversions — not last-click Shopify attribution (UTM tagging gap)
    cac: c.conversions > 0 ? Math.round((c.spend / c.conversions) * 100) / 100 : null,
  }));
}

function sumCampaigns(campaigns) {
  const spend        = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const clicks       = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const impressions  = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const newCustomers = campaigns.reduce((s, c) => s + (c.newCustomerCount || 0), 0);
  return {
    spend,
    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
    cpm: impressions > 0 ? Math.round((spend / (impressions / 1000)) * 100) / 100 : null,
    cac: newCustomers > 0 ? Math.round((spend / newCustomers) * 100) / 100 : null,
  };
}

// Google totals: uses platform-reported conversions, not Shopify new-customer count
function sumGoogleCampaigns(campaigns) {
  const spend       = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const clicks      = campaigns.reduce((s, c) => s + (c.clicks || 0), 0);
  const impressions = campaigns.reduce((s, c) => s + (c.impressions || 0), 0);
  const conversions = campaigns.reduce((s, c) => s + (c.conversions || 0), 0);
  return {
    spend,
    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : null,
    cpm: impressions > 0 ? Math.round((spend / (impressions / 1000)) * 100) / 100 : null,
    cac: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : null,
  };
}

function dateRangeOf(rows, dateKey) {
  if (!rows.length) return null;
  const dates = rows.map(r => r[dateKey]).filter(Boolean).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

// ── combined weekly spend ─────────────────────────────────────────────────────

/** Round a YYYY-MM-DD date string down to the Monday of its week */
function toMonday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a combined weekly spend array from raw Meta daily rows and Google weekly rows.
 * Meta rows are bucketed into Mon-start weeks to align with Google's native weekly format.
 * Returns array of { weekStart, metaSpend, googleSpend, totalSpend }, newest first.
 */
export function buildCombinedWeeklySpend(metaRows = [], googleRows = []) {
  const map = {};

  // Bucket Meta daily rows into weeks
  for (const r of metaRows) {
    const ws = toMonday(r.date);
    if (!map[ws]) map[ws] = { weekStart: ws, metaSpend: 0, googleSpend: 0 };
    map[ws].metaSpend += r.spend || 0;
  }

  // Merge Google weekly rows (already Mon-start)
  for (const r of googleRows) {
    const ws = r.weekStart;
    if (!map[ws]) map[ws] = { weekStart: ws, metaSpend: 0, googleSpend: 0 };
    map[ws].googleSpend += r.spend || 0;
  }

  return Object.values(map)
    .map(w => ({
      ...w,
      metaSpend:   Math.round(w.metaSpend   * 100) / 100,
      googleSpend: Math.round(w.googleSpend * 100) / 100,
      totalSpend:  Math.round((w.metaSpend + w.googleSpend) * 100) / 100,
    }))
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
}

// ── public API ────────────────────────────────────────────────────────────────

export async function fetchCampaignPageData() {
  const stored = await fetchStoredCampaignData();
  const metaRowsRaw   = stored?.meta?.rows   || [];
  const googleRowsRaw = stored?.google?.rows || [];

  const metaRows   = metaRowsRaw;
  const googleRows = googleRowsRaw;

  const now           = new Date();
  const sevenDaysAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Meta aggregation ──────────────────────────────────────────────────────
  const metaCampaigns7  = aggregateMetaRows(metaRows, sevenDaysAgo, now);
  const metaCampaigns30 = aggregateMetaRows(metaRows, thirtyDaysAgo, now);

  let joinedMeta7  = { campaigns: metaCampaigns7,  unmatched: [] };
  let joinedMeta30 = { campaigns: metaCampaigns30, unmatched: [] };

  if (metaRows.length > 0) {
    const [j7, j30] = await Promise.allSettled([
      fetchCampaignAttribution(sevenDaysAgo, now),
      fetchCampaignAttribution(thirtyDaysAgo, now),
    ]);
    if (j7.status  === 'fulfilled') joinedMeta7  = attributeCampaignsToAdPlatform(metaCampaigns7,  j7.value,  'meta');
    if (j30.status === 'fulfilled') joinedMeta30 = attributeCampaignsToAdPlatform(metaCampaigns30, j30.value, 'meta');
  }

  const meta7Totals  = sumCampaigns(joinedMeta7.campaigns);
  const meta30Totals = sumCampaigns(joinedMeta30.campaigns);

  // ── Google aggregation ────────────────────────────────────────────────────
  const completeWeeks   = getCompleteGoogleWeeks(googleRows, 4);
  const lastWeek        = completeWeeks.slice(0, 1);
  const last4Weeks      = completeWeeks.slice(0, 4);

  let googleLastWeek   = aggregateGoogleRows(googleRows, lastWeek);
  let googleLast4Weeks = aggregateGoogleRows(googleRows, last4Weeks);

  let joinedGoogleLastWeek   = { campaigns: googleLastWeek,   unmatched: [] };
  let joinedGoogleLast4Weeks = { campaigns: googleLast4Weeks, unmatched: [] };

  if (googleRows.length > 0 && completeWeeks.length > 0) {
    // Determine date bounds for Google attribution windows
    const lastWeekStart  = completeWeeks[0] ? new Date(completeWeeks[0]) : sevenDaysAgo;
    const lastWeekEnd    = new Date(lastWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const last4WeekStart = completeWeeks[last4Weeks.length - 1] ? new Date(completeWeeks[last4Weeks.length - 1]) : thirtyDaysAgo;
    const last4WeekEnd   = new Date(lastWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [jGoogleWeek, jGoogleMonth] = await Promise.allSettled([
      fetchCampaignAttribution(lastWeekStart, lastWeekEnd),
      fetchCampaignAttribution(last4WeekStart, last4WeekEnd),
    ]);
    if (jGoogleWeek.status  === 'fulfilled') joinedGoogleLastWeek   = attributeCampaignsToAdPlatform(googleLastWeek,   jGoogleWeek.value,  'google');
    if (jGoogleMonth.status === 'fulfilled') joinedGoogleLast4Weeks = attributeCampaignsToAdPlatform(googleLast4Weeks, jGoogleMonth.value, 'google');
  }

  const googleLastWeekTotals    = sumGoogleCampaigns(joinedGoogleLastWeek.campaigns);
  const googleLast4WeeksTotals  = sumGoogleCampaigns(joinedGoogleLast4Weeks.campaigns);

  const combinedWeekly = buildCombinedWeeklySpend(metaRowsRaw, googleRowsRaw);

  return {
    combined: {
      weekly: combinedWeekly,
      hasData: combinedWeekly.length > 0,
    },
    meta: {
      hasData:    metaRows.length > 0,
      uploadedAt: stored?.meta?.uploadedAt || null,
      dateRange:  dateRangeOf(metaRows, 'date'),
      cpc7:  meta7Totals.cpc,  cpm7:  meta7Totals.cpm,  cac7:  meta7Totals.cac,
      cpc30: meta30Totals.cpc, cpm30: meta30Totals.cpm, cac30: meta30Totals.cac,
      campaigns7:  joinedMeta7.campaigns,
      campaigns30: joinedMeta30.campaigns,
      unmatched: [...new Set([...joinedMeta7.unmatched, ...joinedMeta30.unmatched])],
    },
    google: {
      hasData:         googleRows.length > 0,
      uploadedAt:      stored?.google?.uploadedAt || null,
      dateRange:       dateRangeOf(googleRows, 'weekStart'),
      lastCompleteWeek: completeWeeks[0] || null,
      cpcLastWeek:     googleLastWeekTotals.cpc,
      cpmLastWeek:     googleLastWeekTotals.cpm,
      cacLastWeek:     googleLastWeekTotals.cac,
      cpcLast4Weeks:   googleLast4WeeksTotals.cpc,
      cpmLast4Weeks:   googleLast4WeeksTotals.cpm,
      cacLast4Weeks:   googleLast4WeeksTotals.cac,
      campaignsLastWeek:   joinedGoogleLastWeek.campaigns,
      campaignsLast4Weeks: joinedGoogleLast4Weeks.campaigns,
      unmatched: [...new Set([...joinedGoogleLastWeek.unmatched, ...joinedGoogleLast4Weeks.unmatched])],
    },
  };
}
