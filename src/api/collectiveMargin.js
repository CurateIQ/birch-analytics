/**
 * collectiveMargin.js
 * Contribution margin calculations for Shopify Collective orders.
 *
 * Cost source priority:
 *   1. S3 snapshot via /cost-snapshots (historically accurate)
 *   2. Live Shopify GraphQL pull (cold-start fallback, point-in-time)
 *
 * Established facts:
 *   - Shipping = $0 (Collective zones are flat $0; suppliers don't invoice)
 *   - Processing fee = order_total × 2.25% + $0.30, allocated proportionally
 *     across ALL line items by each item's share of order net revenue
 *   - Collective items detected by vendor name OR fulfillment_service
 */

import { PROXY, PROXY_HEADERS } from './proxy';
import { fetchOrders } from './shopify';
import { mondayOf, listWeeks, weekBounds, formatWeekLabel, formatWeekRange } from '../utils/weeks';

export const COLLECTIVE_VENDORS = new Set([
  // Verified from Shopify Collective Suppliers page (Connected tab)
  "Apple Park & Organic Farm Buddies",
  "DYPER",
  "L'ovedbaby",
  "Makemake Organics",
  "Parasol Co",
  "ezpz",
  "Lovevery", // connected Aug 26 2026; new orders also auto-detect via fulfillment_service
  "Babybay",  // Shipturtle dropship partner (not Collective, but same margin treatment)
]);

// Launch date — first full Monday on/after site launch mid-June 2026.
export const LAUNCH_DATE = '2026-06-12T00:00:00.000Z';

function isCollectiveItem(item) {
  return COLLECTIVE_VENDORS.has(item.vendor) ||
    Boolean(item.fulfillment_service?.includes('shopify-collective'));
  // Note: "shipturtle" was never found in any live order's fulfillment_service — removed
}

function buildSkuLookup(items) {
  const map = new Map();
  for (const item of items) {
    if (item.sku) map.set(item.sku, item.cost);
    if (item.variantId) map.set(`sku-${item.variantId}`, item.cost);
  }
  return map;
}

// ── cost data loading ─────────────────────────────────────────────────────────

async function tryS3Snapshot() {
  try {
    const res = await fetch(`${PROXY}/cost-snapshots?mode=latest`, { headers: PROXY_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.snapshot?.items?.length) return null;
    return data; // { snapshot, date, firstSnapshotDate, estimatedOnly }
  } catch {
    return null;
  }
}

const LIVE_QUERY = `
  query($query: String!, $cursor: String) {
    products(first: 100, query: $query, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title vendor
        variants(first: 100) {
          nodes {
            id sku price
            inventoryItem { unitCost { amount } }
          }
        }
      }
    }
  }
`;

// Module-level cache for live cost data (one GraphQL sweep per session).
let liveCostCache = null;

async function fetchLiveCostItems() {
  if (liveCostCache) return liveCostCache;

  const items = [];
  const vendors = [...COLLECTIVE_VENDORS];

  for (const vendor of vendors) {
    let cursor = null;
    let page = 0;
    do {
      if (page > 0) await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`${PROXY}/shopify/graphql`, {
          method: 'POST',
          headers: { ...PROXY_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: LIVE_QUERY, variables: { query: `vendor:"${vendor}"`, cursor } }),
        });
        if (!res.ok) break;
        const json = await res.json();
        const products = json.data?.products;
        if (!products) break;

        for (const product of products.nodes) {
          for (const variant of product.variants.nodes) {
            const rawCost = variant.inventoryItem?.unitCost?.amount;
            const variantId = variant.id?.replace('gid://shopify/ProductVariant/', '') ?? null;
            items.push({
              sku: variant.sku || null,
              variantId,
              cost: rawCost != null ? parseFloat(rawCost) : null,
            });
          }
        }
        cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
      } catch {
        cursor = null;
      }
      page++;
    } while (cursor && page < 50);
  }

  liveCostCache = items;
  return items;
}

async function loadCostLookup() {
  const s3Data = await tryS3Snapshot();
  if (s3Data) {
    return {
      skuLookup: buildSkuLookup(s3Data.snapshot.items),
      snapshotDate: s3Data.date,
      firstSnapshotDate: s3Data.firstSnapshotDate,
      isLiveFallback: false,
    };
  }
  // Fall back to live GraphQL — slower but works immediately after deploy.
  const items = await fetchLiveCostItems();
  const today = new Date().toISOString().slice(0, 10);
  return {
    skuLookup: buildSkuLookup(items),
    snapshotDate: today,
    firstSnapshotDate: null, // no real S3 snapshots yet
    isLiveFallback: true,
  };
}

// ── margin computation ────────────────────────────────────────────────────────

function computeOrderMargin(order, skuLookup) {
  const allItems = order.line_items || [];
  const collectiveItems = allItems.filter(isCollectiveItem);
  if (!collectiveItems.length) return null;

  const orderTotal = parseFloat(order.total_price || 0);
  const processingFee = orderTotal * 0.0225 + 0.30;

  // Net revenue per line item (after discounts), used for fee allocation.
  const allItemsNet = allItems.map(item => {
    const gross = parseFloat(item.price || 0) * (item.quantity || 1);
    const discount = (item.discount_allocations || [])
      .reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    return Math.max(0, gross - discount);
  });
  const totalNetDenominator = allItemsNet.reduce((s, v) => s + v, 0);

  let revenueGross = 0, revenueNet = 0, cogs = 0, fees = 0, discounts = 0;
  let missingCost = false;

  allItems.forEach((item, idx) => {
    if (!isCollectiveItem(item)) return;

    const qty = item.quantity || 1;
    const itemGross = parseFloat(item.price || 0) * qty;
    const itemDiscount = (item.discount_allocations || [])
      .reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    const itemNet = Math.max(0, itemGross - itemDiscount);
    const itemFee = totalNetDenominator > 0
      ? (allItemsNet[idx] / totalNetDenominator) * processingFee
      : 0;

    const sku = item.sku || `sku-${item.variant_id}`;
    const unitCost = skuLookup.has(sku) ? skuLookup.get(sku) : null;
    const itemCogs = unitCost != null ? unitCost * qty : null;

    revenueGross += itemGross;
    revenueNet += itemNet;
    discounts += itemDiscount;
    fees += itemFee;
    if (itemCogs != null) cogs += itemCogs;
    else missingCost = true;
  });

  return {
    orderId: order.id,
    orderDate: new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    vendor: collectiveItems[0]?.vendor || 'Unknown',
    vendors: [...new Set(collectiveItems.map(i => i.vendor))],
    revenueGross: Math.round(revenueGross * 100) / 100,
    revenueNet: Math.round(revenueNet * 100) / 100,
    cogs: Math.round(cogs * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    discounts: Math.round(discounts * 100) / 100,
    missingCost,
  };
}

function marginCalc(rev, cogs, fees) {
  const dollar = rev - cogs - fees;
  const pct = rev > 0 ? (dollar / rev) * 100 : null;
  return {
    dollar: Math.round(dollar * 100) / 100,
    pct: pct != null ? Math.round(pct * 10) / 10 : null,
  };
}

// ── aggregation helpers ───────────────────────────────────────────────────────

function aggregateOrders(orders) {
  const totals = orders.reduce(
    (acc, o) => ({
      revenueGross: acc.revenueGross + o.revenueGross,
      revenueNet: acc.revenueNet + o.revenueNet,
      cogs: acc.cogs + o.cogs,
      fees: acc.fees + o.fees,
      discounts: acc.discounts + o.discounts,
      count: acc.count + 1,
    }),
    { revenueGross: 0, revenueNet: 0, cogs: 0, fees: 0, discounts: 0, count: 0 }
  );

  const gross = marginCalc(totals.revenueGross, totals.cogs, totals.fees);
  const net = marginCalc(totals.revenueNet, totals.cogs, totals.fees);

  return {
    orderCount: totals.count,
    revenueGross: Math.round(totals.revenueGross * 100) / 100,
    revenueNet: Math.round(totals.revenueNet * 100) / 100,
    marginDollarGross: gross.dollar,
    marginPctGross: gross.pct,
    marginDollarNet: net.dollar,
    marginPctNet: net.pct,
    discounts: Math.round(totals.discounts * 100) / 100,
    discountMarginImpact: gross.pct != null && net.pct != null
      ? Math.round((gross.pct - net.pct) * 10) / 10
      : null,
  };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Fetches all Collective margin data for the dashboard.
 * Returns: { kpi, daily7, weeklyLaunch, byVendor, snapshotDate, firstSnapshotDate, isLiveFallback, coveredRevenuePct }
 */
export async function fetchCollectiveMarginData() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toETDate = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  // Parallelise cost lookup and order fetch.
  const [costData, allOrders] = await Promise.all([
    loadCostLookup(),
    fetchOrders(LAUNCH_DATE, now.toISOString(), 250),
  ]);

  const { skuLookup, snapshotDate, firstSnapshotDate, isLiveFallback } = costData;

  // Only non-cancelled, non-refunded Collective orders.
  const collectiveOrders = allOrders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .filter(o => (o.line_items || []).some(isCollectiveItem))
    .map(o => computeOrderMargin(o, skuLookup))
    .filter(Boolean);

  // Coverage stat.
  const totalRev = collectiveOrders.reduce((s, o) => s + o.revenueGross, 0);
  const coveredRev = collectiveOrders
    .filter(o => !o.missingCost)
    .reduce((s, o) => s + o.revenueGross, 0);
  const coveredRevenuePct = totalRev > 0
    ? Math.round((coveredRev / totalRev) * 1000) / 10
    : 100;

  // KPI — rolling 7 days.
  const recent7 = collectiveOrders.filter(o => o.orderDate >= toETDate(sevenDaysAgo));
  const kpi = aggregateOrders(recent7);

  // Daily — last 7 complete days.
  const daily7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = toETDate(d);
    const dayOrders = collectiveOrders.filter(o => o.orderDate === dateStr);
    const agg = aggregateOrders(dayOrders);
    daily7.push({
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }),
      date: dateStr,
      gross: agg.marginDollarGross,
      net: agg.marginDollarNet,
      grossPct: agg.marginPctGross,
      netPct: agg.marginPctNet,
    });
  }

  // Weekly — since launch.
  const floorMonday = mondayOf(new Date(LAUNCH_DATE));
  const currentMonday = mondayOf(now);
  const weeks = listWeeks(floorMonday, currentMonday);

  const weeklyLaunch = weeks.map(weekStart => {
    const { start, end } = weekBounds(weekStart);
    const weekDateStr = weekStart.toISOString().slice(0, 10);
    const weekOrders = collectiveOrders.filter(
      o => o.orderDate >= start.slice(0, 10) && o.orderDate < end.slice(0, 10)
    );
    const agg = aggregateOrders(weekOrders);
    // A week is "estimated" if no real S3 snapshot existed for that date.
    const isEstimated = isLiveFallback ||
      !firstSnapshotDate ||
      weekDateStr < firstSnapshotDate;

    return {
      weekStart: weekDateStr,
      weekLabel: formatWeekLabel(weekStart),
      weekRange: formatWeekRange(weekStart),
      gross: isEstimated ? null : agg.marginDollarGross,
      net: isEstimated ? null : agg.marginDollarNet,
      grossPct: isEstimated ? null : agg.marginPctGross,
      netPct: isEstimated ? null : agg.marginPctNet,
      grossEst: isEstimated ? agg.marginDollarGross : null,
      netEst: isEstimated ? agg.marginDollarNet : null,
      grossPctEst: isEstimated ? agg.marginPctGross : null,
      netPctEst: isEstimated ? agg.marginPctNet : null,
      estimated: isEstimated,
    };
  });

  // Bridge point: where estimated ends and real begins, include value in BOTH
  // series so the lines connect visually.
  for (let i = 0; i < weeklyLaunch.length - 1; i++) {
    if (weeklyLaunch[i].estimated && !weeklyLaunch[i + 1].estimated) {
      weeklyLaunch[i].gross = weeklyLaunch[i].grossEst;
      weeklyLaunch[i].net = weeklyLaunch[i].netEst;
      weeklyLaunch[i].grossPct = weeklyLaunch[i].grossPctEst;
      weeklyLaunch[i].netPct = weeklyLaunch[i].netPctEst;
    }
  }

  // By vendor (whole period since launch) — dynamic: includes any vendor that
  // actually appears in orders, not just the hardcoded set.
  const allVendorsInOrders = [...new Set(
    collectiveOrders.flatMap(o => o.vendors || [])
  )];
  const vendorsToShow = [...new Set([...COLLECTIVE_VENDORS, ...allVendorsInOrders])];
  const byVendor = vendorsToShow.map(vendor => {
    const vendorOrders = collectiveOrders.filter(o => o.vendors.includes(vendor));
    const agg = aggregateOrders(vendorOrders);
    return { vendor, ...agg };
  }).sort((a, b) => b.revenueGross - a.revenueGross);

  return {
    kpi,
    daily7,
    weeklyLaunch,
    byVendor,
    snapshotDate,
    firstSnapshotDate,
    isLiveFallback,
    coveredRevenuePct,
    shopifyOrderCount: allOrders.length,
  };
}
