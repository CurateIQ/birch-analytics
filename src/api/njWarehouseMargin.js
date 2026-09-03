/**
 * njWarehouseMargin.js
 * Contribution margin calculations for NJ Warehouse (FBB) orders.
 *
 * Cost source priority — same pipeline as Collective:
 *   1. S3 snapshot via /cost-snapshots (broadened to full catalog)
 *   2. Live Shopify GraphQL fallback
 *
 * Fee stack per order:
 *   − COGS (unit cost × qty, from snapshot)
 *   − Warehouse handling fee ($2.00 first unit + $0.35 each additional, NJ Warehouse config)
 *   − Shipping (actual carrier cost from Veeqo outbound_label_charges.value)
 *   − Payment processing (order_total × 2.25% + $0.30, allocated by revenue share)
 *   All fees allocated to line items proportional to each item's net revenue share.
 *
 * NJ identification:
 *   Primary: Veeqo allocation.warehouse.name === "NJ Warehouse" (set of order names)
 *   Fallback: fulfillment_service === 'manual' on any line item (if Veeqo unavailable)
 */

import { PROXY, PROXY_HEADERS } from './proxy';
import { fetchOrders, getCategory } from './shopify';
import { mondayOf, listWeeks, weekBounds, formatWeekLabel, formatWeekRange } from '../utils/weeks';
import { computeWarehouseFee } from '../config/warehouseFees';
import { fetchVeeqoData } from './veeqo';

export const LAUNCH_DATE = '2026-06-12T00:00:00.000Z';
const NJ_LOCATION = 'NJ Warehouse';

// Vendors handled by the Manual Wholesale stream — must not bleed into NJ Warehouse
// even in the Veeqo fallback path (which classifies by fulfillment_service === 'manual').
const MANUAL_WHOLESALE_VENDORS = new Set(['Babybay', 'Naturepedic']);

function isNJItem(item) {
  return item.fulfillment_service === 'manual' && !MANUAL_WHOLESALE_VENDORS.has(item.vendor);
}

// ── cost snapshot loading (mirrors collectiveMargin.js) ───────────────────────

function buildSkuLookup(items) {
  const map = new Map();
  for (const item of items) {
    if (item.sku) map.set(item.sku, item.cost);
    if (item.variantId) map.set(`sku-${item.variantId}`, item.cost);
  }
  return map;
}

async function tryS3Snapshot() {
  try {
    const res = await fetch(`${PROXY}/cost-snapshots?mode=latest`, { headers: PROXY_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.snapshot?.items?.length) return null;
    return data;
  } catch {
    return null;
  }
}

const LIVE_QUERY = `
  query($cursor: String) {
    products(first: 100, after: $cursor) {
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

let liveCostCache = null;

async function fetchLiveCostItems() {
  if (liveCostCache) return liveCostCache;
  const items = [];
  let cursor = null;
  let page = 0;
  do {
    if (page > 0) await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(`${PROXY}/shopify/graphql`, {
        method: 'POST',
        headers: { ...PROXY_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: LIVE_QUERY, variables: { cursor } }),
      });
      if (!res.ok) break;
      const json = await res.json();
      const products = json.data?.products;
      if (!products) break;
      for (const product of products.nodes) {
        for (const variant of product.variants.nodes) {
          const rawCost = variant.inventoryItem?.unitCost?.amount;
          const variantId = variant.id?.replace('gid://shopify/ProductVariant/', '') ?? null;
          items.push({ sku: variant.sku || null, variantId, cost: rawCost != null ? parseFloat(rawCost) : null });
        }
      }
      cursor = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
    } catch { cursor = null; }
    page++;
  } while (cursor && page < 200);
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
  const items = await fetchLiveCostItems();
  return {
    skuLookup: buildSkuLookup(items),
    snapshotDate: new Date().toISOString().slice(0, 10),
    firstSnapshotDate: null,
    isLiveFallback: true,
  };
}

// ── margin computation ────────────────────────────────────────────────────────

function computeOrderMargin(order, skuLookup, shippingCost) {
  const allItems = order.line_items || [];
  const njItems = allItems.filter(isNJItem);
  if (!njItems.length) return null;

  const orderTotal = parseFloat(order.total_price || 0);
  const processingFee = orderTotal * 0.0225 + 0.30;

  const totalNJUnits = njItems.reduce((s, item) => s + (item.quantity || 1), 0);
  const handlingFee = computeWarehouseFee(NJ_LOCATION, totalNJUnits);
  const handlingFeeUnknown = handlingFee === null;

  // Net revenue per line item (all items) for fee allocation denominator
  const allItemsNet = allItems.map(item => {
    const gross = parseFloat(item.price || 0) * (item.quantity || 1);
    const discount = (item.discount_allocations || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    return Math.max(0, gross - discount);
  });
  const totalNetDenominator = allItemsNet.reduce((s, v) => s + v, 0);

  let revenueGross = 0, revenueNet = 0, cogs = 0, fees = 0, discounts = 0;
  let missingCost = false;
  const categoryBreakdown = {};

  allItems.forEach((item, idx) => {
    if (!isNJItem(item)) return;

    const qty = item.quantity || 1;
    const itemGross = parseFloat(item.price || 0) * qty;
    const itemDiscount = (item.discount_allocations || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    const itemNet = Math.max(0, itemGross - itemDiscount);
    const revShare = totalNetDenominator > 0 ? allItemsNet[idx] / totalNetDenominator : 0;

    const itemProcessingFee = revShare * processingFee;
    const itemHandlingFee   = handlingFeeUnknown ? 0 : revShare * handlingFee;
    const itemShippingFee   = revShare * (shippingCost || 0);
    const itemTotalFee      = itemProcessingFee + itemHandlingFee + itemShippingFee;

    const sku = item.sku || `sku-${item.variant_id}`;
    const unitCost = skuLookup.has(sku) ? skuLookup.get(sku) : null;
    const itemCogs = unitCost != null ? unitCost * qty : null;

    revenueGross += itemGross;
    revenueNet   += itemNet;
    discounts    += itemDiscount;
    fees         += itemTotalFee;
    if (itemCogs != null) cogs += itemCogs;
    else missingCost = true;

    // Accumulate category data
    const cat = getCategory(item.product_type, item.title);
    if (!categoryBreakdown[cat]) {
      categoryBreakdown[cat] = { revenueGross: 0, revenueNet: 0, cogs: 0, fees: 0, discounts: 0 };
    }
    const c = categoryBreakdown[cat];
    c.revenueGross += itemGross;
    c.revenueNet   += itemNet;
    c.fees         += itemTotalFee;
    c.discounts    += itemDiscount;
    if (itemCogs != null) c.cogs += itemCogs;
  });

  return {
    orderId:          order.id,
    orderName:        order.name,
    orderDate:        new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    vendor:           [...new Set(njItems.map(i => i.vendor).filter(Boolean))].join(', ') || 'NJ Warehouse',
    skus:             njItems.flatMap(i => i.sku ? [i.sku] : (i.title ? [i.title] : [])),
    revenueGross:     Math.round(revenueGross * 100) / 100,
    revenueNet:       Math.round(revenueNet * 100) / 100,
    cogs:             Math.round(cogs * 100) / 100,
    fees:             Math.round(fees * 100) / 100,
    discounts:        Math.round(discounts * 100) / 100,
    shippingCost:     Math.round((shippingCost || 0) * 100) / 100,
    missingCost,
    handlingFeeUnknown,
    categoryBreakdown,
  };
}

function marginCalc(rev, cogs, fees) {
  const dollar = rev - cogs - fees;
  const pct    = rev > 0 ? (dollar / rev) * 100 : null;
  return {
    dollar: Math.round(dollar * 100) / 100,
    pct:    pct != null ? Math.round(pct * 10) / 10 : null,
  };
}

function aggregateOrders(orders) {
  const totals = orders.reduce(
    (acc, o) => ({
      revenueGross: acc.revenueGross + o.revenueGross,
      revenueNet:   acc.revenueNet   + o.revenueNet,
      cogs:         acc.cogs         + o.cogs,
      fees:         acc.fees         + o.fees,
      discounts:    acc.discounts    + o.discounts,
      count:        acc.count        + 1,
    }),
    { revenueGross: 0, revenueNet: 0, cogs: 0, fees: 0, discounts: 0, count: 0 }
  );
  const gross = marginCalc(totals.revenueGross, totals.cogs, totals.fees);
  const net   = marginCalc(totals.revenueNet,   totals.cogs, totals.fees);
  return {
    orderCount:          totals.count,
    revenueGross:        Math.round(totals.revenueGross * 100) / 100,
    revenueNet:          Math.round(totals.revenueNet   * 100) / 100,
    marginDollarGross:   gross.dollar,
    marginPctGross:      gross.pct,
    marginDollarNet:     net.dollar,
    marginPctNet:        net.pct,
    discounts:           Math.round(totals.discounts * 100) / 100,
    discountMarginImpact: gross.pct != null && net.pct != null
      ? Math.round((gross.pct - net.pct) * 10) / 10
      : null,
  };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Fetches all NJ Warehouse margin data for the dashboard.
 * Returns: { kpi, daily7, weeklyLaunch, byCategory, snapshotDate, firstSnapshotDate,
 *            isLiveFallback, isVeeqoFallback, coveredRevenuePct, shippingCoveredPct }
 */
export async function fetchNJWarehouseMarginData() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toETDate = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const [costData, allOrders, veeqoData] = await Promise.all([
    loadCostLookup(),
    fetchOrders(LAUNCH_DATE, now.toISOString(), 250),
    fetchVeeqoData(LAUNCH_DATE),
  ]);

  const { skuLookup, snapshotDate, firstSnapshotDate, isLiveFallback } = costData;
  const { shippingCosts, njOrderNames, partial: veeqoPartial, error: veeqoError } = veeqoData;
  const isVeeqoFallback = njOrderNames.size === 0;

  const allComputedOrders = allOrders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .filter(o => {
      if (!isVeeqoFallback) return njOrderNames.has(o.name);
      // Fallback: fulfillment_service === 'manual', but isNJItem already excludes
      // MANUAL_WHOLESALE_VENDORS so Babybay/Naturepedic don't bleed in here.
      return (o.line_items || []).some(isNJItem);
    })
    .map(o => computeOrderMargin(o, skuLookup, shippingCosts.get(o.name) || 0))
    .filter(Boolean);

  // Universal rule: orders with ANY missing COGS are excluded entirely.
  const njOrders      = allComputedOrders.filter(o => !o.missingCost);
  const noCOGSOrders  = allComputedOrders.filter(o => o.missingCost);
  const excludedCount = noCOGSOrders.length;
  const excludedGMV   = Math.round(noCOGSOrders.reduce((s, o) => s + o.revenueGross, 0) * 100) / 100;
  const streamOrderCount = allComputedOrders.length;

  const totalRev   = allComputedOrders.reduce((s, o) => s + o.revenueGross, 0);
  const coveredRev = njOrders.reduce((s, o) => s + o.revenueGross, 0);
  const coveredRevenuePct = totalRev > 0 ? Math.round((coveredRev / totalRev) * 1000) / 10 : 100;

  const shippedOrders = njOrders.filter(o => o.shippingCost > 0).length;
  const shippingCoveredPct = njOrders.length > 0
    ? Math.round((shippedOrders / njOrders.length) * 1000) / 10
    : 0;

  // KPI — rolling 7 days
  const recent7 = njOrders.filter(o => o.orderDate >= toETDate(sevenDaysAgo));
  const kpi = aggregateOrders(recent7);

  // Daily — last 7 complete days
  const daily7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = toETDate(d);
    const agg = aggregateOrders(njOrders.filter(o => o.orderDate === dateStr));
    daily7.push({
      label:    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }),
      date:     dateStr,
      gross:    agg.marginDollarGross,
      net:      agg.marginDollarNet,
      grossPct: agg.marginPctGross,
      netPct:   agg.marginPctNet,
    });
  }

  // Weekly — since launch
  const floorMonday   = mondayOf(new Date(LAUNCH_DATE));
  const currentMonday = mondayOf(now);
  const weeks = listWeeks(floorMonday, currentMonday);

  const weeklyLaunch = weeks.map(weekStart => {
    const { start, end } = weekBounds(weekStart);
    const weekDateStr  = weekStart.toISOString().slice(0, 10);
    const weekOrders   = njOrders.filter(
      o => o.orderDate >= start.slice(0, 10) && o.orderDate < end.slice(0, 10)
    );
    const agg = aggregateOrders(weekOrders);
    const isEstimated = isLiveFallback || !firstSnapshotDate || weekDateStr < firstSnapshotDate;

    return {
      weekStart:  weekDateStr,
      weekLabel:  formatWeekLabel(weekStart),
      weekRange:  formatWeekRange(weekStart),
      gross:      isEstimated ? null : agg.marginDollarGross,
      net:        isEstimated ? null : agg.marginDollarNet,
      grossPct:   isEstimated ? null : agg.marginPctGross,
      netPct:     isEstimated ? null : agg.marginPctNet,
      grossEst:   isEstimated ? agg.marginDollarGross : null,
      netEst:     isEstimated ? agg.marginDollarNet   : null,
      grossPctEst: isEstimated ? agg.marginPctGross   : null,
      netPctEst:  isEstimated ? agg.marginPctNet      : null,
      estimated:  isEstimated,
    };
  });

  // Bridge point at estimated → real transition
  for (let i = 0; i < weeklyLaunch.length - 1; i++) {
    if (weeklyLaunch[i].estimated && !weeklyLaunch[i + 1].estimated) {
      weeklyLaunch[i].gross    = weeklyLaunch[i].grossEst;
      weeklyLaunch[i].net      = weeklyLaunch[i].netEst;
      weeklyLaunch[i].grossPct = weeklyLaunch[i].grossPctEst;
      weeklyLaunch[i].netPct   = weeklyLaunch[i].netPctEst;
    }
  }

  // By category — aggregate across all orders since launch
  const catMap = {};
  njOrders.forEach(order => {
    Object.entries(order.categoryBreakdown || {}).forEach(([cat, d]) => {
      if (!catMap[cat]) catMap[cat] = { revenueGross: 0, revenueNet: 0, cogs: 0, fees: 0, discounts: 0, orderCount: 0 };
      const c = catMap[cat];
      c.revenueGross += d.revenueGross;
      c.revenueNet   += d.revenueNet;
      c.cogs         += d.cogs;
      c.fees         += d.fees;
      c.discounts    += d.discounts;
      c.orderCount   += 1;
    });
  });

  const byCategory = Object.entries(catMap).map(([category, d]) => {
    const gross = marginCalc(d.revenueGross, d.cogs, d.fees);
    const net   = marginCalc(d.revenueNet,   d.cogs, d.fees);
    return {
      category,
      orderCount:        d.orderCount,
      revenueGross:      Math.round(d.revenueGross * 100) / 100,
      marginDollarGross: gross.dollar,
      marginPctGross:    gross.pct,
      marginDollarNet:   net.dollar,
      marginPctNet:      net.pct,
    };
  }).sort((a, b) => b.revenueGross - a.revenueGross);

  return {
    kpi,
    daily7,
    weeklyLaunch,
    byCategory,
    snapshotDate,
    firstSnapshotDate,
    isLiveFallback,
    isVeeqoFallback,
    isVeeqoPartial: veeqoPartial || false,
    veeqoPartialError: veeqoError || null,
    coveredRevenuePct,
    shippingCoveredPct,
    excludedCount,
    excludedGMV,
    excludedOrders: noCOGSOrders.map(o => ({
      orderName: o.orderName,
      vendor:    o.vendor,
      skus:      o.skus || [],
      gmv:       o.revenueGross,
    })),
    streamOrderCount,
    shopifyOrderCount: allOrders.length,
  };
}
