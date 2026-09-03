/**
 * manualWholesaleMargin.js
 * Contribution margin for Manual Wholesale orders: Babybay (Shipturtle) and Naturepedic (direct).
 *
 * Cost source: manually uploaded invoices/POs, stored via Lambda → S3.
 * Cost keyed by Shopify order name stripped of '#' (e.g. "1347").
 *
 * Fee stack:
 *   - COGS = uploaded cost (Net Payout from Babybay invoice; Total from Naturepedic PO)
 *   - Processing fee = order_total × 2.25% + $0.30
 *   - Shipping: bundled into uploaded cost — not subtracted separately
 *
 * COGS exclusion rule: orders with no uploaded cost are excluded entirely from
 * revenue/margin totals and reported as excludedCount / excludedGMV.
 */

import { PROXY, PROXY_HEADERS } from './proxy';
import { fetchOrders } from './shopify';
import { mondayOf, listWeeks, weekBounds, formatWeekLabel, formatWeekRange } from '../utils/weeks';

export const MANUAL_WHOLESALE_VENDORS = new Set(['Babybay', 'Naturepedic']);
export const LAUNCH_DATE = '2026-06-12T00:00:00.000Z';

// ── cost storage (Lambda → S3) ────────────────────────────────────────────────

/**
 * Fetches the persisted manual wholesale cost map.
 * Returns: { [orderNumber]: { cost, vendor, source, date } }
 */
export async function fetchManualWholesaleCosts() {
  try {
    const res = await fetch(`${PROXY}/manual-wholesale/costs`, { headers: PROXY_HEADERS });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Merges new cost records into the persisted store.
 * rows: [{ orderId, cost, vendor, source, date }]
 * orderId should be the Shopify order name number (e.g. "1347", not "#1347").
 */
export async function saveManualWholesaleCosts(rows) {
  const res = await fetch(`${PROXY}/manual-wholesale/costs/save`, {
    method: 'POST',
    headers: { ...PROXY_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error(`Failed to save costs: ${res.status}`);
  return res.json();
}

/**
 * Parses a supplier document via Lambda → Claude.
 * vendor: 'babybay' | 'naturepedic'
 * fileBase64: base64-encoded PDF (or text for CSV)
 * mediaType: 'application/pdf' | 'text/plain'
 *
 * Returns for babybay: { rows: [{ orderId, cost, orderDate }] }
 * Returns for naturepedic: { orderId, cost }
 */
export async function parseSupplierDocument(vendor, fileBase64, mediaType) {
  const res = await fetch(`${PROXY}/manual-wholesale/parse`, {
    method: 'POST',
    headers: { ...PROXY_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendor, fileBase64, mediaType }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Parse failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── margin computation ────────────────────────────────────────────────────────

function marginCalc(rev, cogs, fees) {
  const dollar = rev - cogs - fees;
  const pct = rev > 0 ? (dollar / rev) * 100 : null;
  return {
    dollar: Math.round(dollar * 100) / 100,
    pct: pct != null ? Math.round(pct * 10) / 10 : null,
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
      count:        acc.count + 1,
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

function computeOrderMargin(order, costsMap) {
  const mwItems = (order.line_items || []).filter(i => MANUAL_WHOLESALE_VENDORS.has(i.vendor));
  if (!mwItems.length) return null;

  const orderKey  = order.name.replace(/^#/, '');
  const costEntry = costsMap[orderKey];

  const orderTotal     = parseFloat(order.total_price || 0);
  const processingFee  = orderTotal * 0.0225 + 0.30;

  let revenueGross = 0, revenueNet = 0, discounts = 0;
  mwItems.forEach(item => {
    const qty       = item.quantity || 1;
    const itemGross = parseFloat(item.price || 0) * qty;
    const itemDisc  = (item.discount_allocations || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0);
    revenueGross += itemGross;
    revenueNet   += Math.max(0, itemGross - itemDisc);
    discounts    += itemDisc;
  });

  const vendor = mwItems[0].vendor;

  return {
    orderId:      order.id,
    orderName:    order.name,
    orderDate:    new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
    vendor,
    revenueGross: Math.round(revenueGross * 100) / 100,
    revenueNet:   Math.round(revenueNet   * 100) / 100,
    discounts:    Math.round(discounts    * 100) / 100,
    cogs:         costEntry ? Math.round(costEntry.cost * 100) / 100 : null,
    fees:         Math.round(processingFee * 100) / 100,
    missingCost:  !costEntry,
  };
}

// ── public API ────────────────────────────────────────────────────────────────

export async function fetchManualWholesaleMarginData() {
  const now          = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toETDate     = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const [costsMap, allOrders] = await Promise.all([
    fetchManualWholesaleCosts(),
    fetchOrders(LAUNCH_DATE, now.toISOString(), 250),
  ]);

  // Only Manual Wholesale orders
  const allComputedOrders = allOrders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .filter(o => (o.line_items || []).some(i => MANUAL_WHOLESALE_VENDORS.has(i.vendor)))
    .map(o => computeOrderMargin(o, costsMap))
    .filter(Boolean);

  // COGS exclusion rule
  const mwOrders      = allComputedOrders.filter(o => o.cogs !== null);
  const noCOGSOrders  = allComputedOrders.filter(o => o.cogs === null);
  const excludedCount = noCOGSOrders.length;
  const excludedGMV   = Math.round(noCOGSOrders.reduce((s, o) => s + o.revenueGross, 0) * 100) / 100;

  // Inject cogs into aggregation-ready shape
  const readyOrders = mwOrders.map(o => ({ ...o, cogs: o.cogs ?? 0 }));

  const recent7 = readyOrders.filter(o => o.orderDate >= toETDate(sevenDaysAgo));
  const kpi = aggregateOrders(recent7);

  const daily7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = toETDate(d);
    const agg = aggregateOrders(readyOrders.filter(o => o.orderDate === dateStr));
    daily7.push({
      label:    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }),
      date:     dateStr,
      gross:    agg.marginDollarGross,
      net:      agg.marginDollarNet,
      grossPct: agg.marginPctGross,
      netPct:   agg.marginPctNet,
    });
  }

  // Weekly since launch
  const floorMonday   = mondayOf(new Date(LAUNCH_DATE));
  const currentMonday = mondayOf(now);
  const weeks         = listWeeks(floorMonday, currentMonday);

  const weeklyLaunch = weeks.map(weekStart => {
    const { start, end } = weekBounds(weekStart);
    const weekDateStr    = weekStart.toISOString().slice(0, 10);
    const weekOrders     = readyOrders.filter(
      o => o.orderDate >= start.slice(0, 10) && o.orderDate < end.slice(0, 10)
    );
    const agg = aggregateOrders(weekOrders);
    return {
      weekStart: weekDateStr,
      weekLabel: formatWeekLabel(weekStart),
      weekRange: formatWeekRange(weekStart),
      gross:    agg.marginDollarGross,
      net:      agg.marginDollarNet,
      grossPct: agg.marginPctGross,
      netPct:   agg.marginPctNet,
    };
  });

  // By vendor
  const byVendor = ['Babybay', 'Naturepedic'].map(vendor => {
    const vendorOrders = readyOrders.filter(o => o.vendor === vendor);
    return { vendor, ...aggregateOrders(vendorOrders) };
  }).filter(r => r.orderCount > 0);

  return {
    kpi,
    daily7,
    weeklyLaunch,
    byVendor,
    excludedCount,
    excludedGMV,
    streamOrderCount: allComputedOrders.length,
    shopifyOrderCount: allOrders.length,
    uploadedCostCount: Object.keys(costsMap).length,
  };
}
