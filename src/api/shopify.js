/**
 * shopify.js
 * All Shopify API calls routed through the birch-api-proxy Lambda.
 * Proxy URL: https://ez5e63jmydqmttr3qorvopyyt40baytn.lambda-url.us-east-1.on.aws
 */

import { PROXY, PROXY_HEADERS } from './proxy';

async function shopifyFetch(endpoint, params = {}) {
  const url = new URL(`${PROXY}/shopify${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: PROXY_HEADERS });
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
  return res.json();
}

export function getDateRange(days = 7) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function getPrevDateRange(days = 7) {
  const end = new Date();
  end.setDate(end.getDate() - days);
  const start = new Date();
  start.setDate(start.getDate() - days * 2);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function fetchOrders(startDate, endDate, limit = 250) {
  const data = await shopifyFetch('/orders', {
    status: 'any',
    created_at_min: startDate,
    created_at_max: endDate,
    limit,
    fields: 'id,created_at,total_price,line_items,financial_status,fulfillment_status,cancel_reason,customer,fulfillments',
  });
  return data.orders || [];
}

export function calcOrderMetrics(orders) {
  const completed = orders.filter(o => o.financial_status !== 'refunded' && !o.cancel_reason);
  const cancelled = orders.filter(o => o.cancel_reason);
  const gmv = completed.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
  const orderCount = completed.length;
  const aov = orderCount > 0 ? gmv / orderCount : 0;
  const totalItems = completed.reduce((sum, o) => sum + (o.line_items?.length || 0), 0);
  const itemsPerOrder = orderCount > 0 ? totalItems / orderCount : 0;
  const cancellationRate = orders.length > 0 ? (cancelled.length / orders.length) * 100 : 0;
  return {
    gmv: Math.round(gmv * 100) / 100,
    orderCount,
    aov: Math.round(aov * 100) / 100,
    itemsPerOrder: Math.round(itemsPerOrder * 10) / 10,
    cancellationRate: Math.round(cancellationRate * 10) / 10,
  };
}

export function calcDailyGMV(orders, days = 14) {
  const map = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    map[d.toISOString().slice(0, 10)] = 0;
  }
  orders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .forEach(o => {
      const key = o.created_at.slice(0, 10);
      if (map[key] !== undefined) map[key] += parseFloat(o.total_price || 0);
    });
  return Object.entries(map).map(([date, gmv]) => ({ date: date.slice(5), gmv: Math.round(gmv) }));
}

// Maps Shopify product_type values to the 9 website-facing categories on birchstore.com.
// Falls back to title keyword matching for products with blank product_type.
const CATEGORY_MAP = {
  'Baby Bibs':'Feeding','Bibs':'Feeding','Feeding Utensils & Tableware':'Feeding','Placemat':'Feeding',
  'Blanket':'Clothes','Bloomers':'Clothes','Dress':'Clothes','Footie':'Clothes',
  'Footie & Rattle Set':'Clothes','One-piece':'Clothes','Overalls':'Clothes','Pajamas':'Clothes',
  'Pants':'Clothes','Romper':'Clothes','Short Sleeve Shirt':'Clothes','Sleep Gown':'Clothes',
  'Swaddles':'Clothes','Tops':'Clothes','Bundle':'Clothes',
  'Activity Toy':'Toys','Baby Toys':'Toys','Book':'Toys','Crinkle Blankie':'Toys',
  'Doll':'Toys','Doll Accessory':'Toys','Dolls':'Toys','Lovey':'Toys',
  'Plush':'Toys','Rattle':'Toys','Stroller Toy':'Toys',
  'Teethers':'Pacifiers & Teethers','Pacifier Buddy':'Pacifiers & Teethers',
  'Disposable Baby Diapers':'Diapering','Baby Wipes':'Diapering',
  'Baby Carrier':'Transport',
  'Baby Haircare':'Bath & Body','Baby Lotion':'Bath & Body',
  'Bath & Body Set':'Bath & Body','Sunscreen':'Bath & Body',
  'Bassinet Canopy Holder':'Nursery','Bassinet Conversion Kit':'Nursery',
  'Bassinet Mattress':'Nursery','Bassinet Mattress Cover':'Nursery',
  'Bassinet Mattress Protector':'Nursery','Bassinet Organizer':'Nursery',
  'Bedside Bassinet':'Nursery',
  'Belly Oil/Butter':'Maternity',
};

function getCategory(productType, title = '') {
  if (productType && CATEGORY_MAP[productType]) return CATEGORY_MAP[productType];
  const t = (title || '').toLowerCase();
  if (/dress|footie|romper|pajama|pj\b|shirt|pants|short\b|overall|blanket|hat\b|coverall|layette|gown|headband|jacket|bodysuit|onesie|swaddle|sleep.?sack|legging|tee\b|jumpsuit/.test(t)) return 'Clothes';
  if (/stroller toy|activity toy|crinkle|lovey|plush|doll\b|rattle|\bball\b|\bgym\b|\bbox\b|flash card|alphabet card/.test(t)) return 'Toys';
  if (/\btoy\b|book\b|\bcard\b/.test(t)) return 'Toys';
  if (/bib|placemat|tableware|utensil|\bcup\b|snack|lunch/.test(t)) return 'Feeding';
  if (/pacifier|teether/.test(t)) return 'Pacifiers & Teethers';
  if (/bassinet|crib\b|nursery/.test(t)) return 'Nursery';
  if (/\bcarrier\b/.test(t)) return 'Transport';
  if (/balm|perineal|nipple|nursing|lactation|postpartum|belly/.test(t)) return 'Bath & Body';
  if (/maternity/.test(t)) return 'Maternity';
  return 'Other';
}

export function calcGMVByBrand(orders) {
  const map = {};
  orders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .forEach(o => {
      const vendorsInOrder = new Set();
      (o.line_items || []).forEach(item => {
        const vendor = item.vendor || 'Unknown';
        if (!map[vendor]) map[vendor] = { gmv: 0, orderCount: 0 };
        map[vendor].gmv += parseFloat(item.price || 0) * (item.quantity || 1);
        vendorsInOrder.add(vendor);
      });
      vendorsInOrder.forEach(v => map[v].orderCount++);
    });
  return Object.entries(map)
    .map(([brand, d]) => ({ brand, gmv: Math.round(d.gmv), orderCount: d.orderCount }))
    .sort((a, b) => b.gmv - a.gmv);
}

export function calcGMVByCategory(orders) {
  const map = {};
  orders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .forEach(o => {
      (o.line_items || []).forEach(item => {
        const cat = getCategory(item.product_type, item.title);
        if (!map[cat]) map[cat] = 0;
        map[cat] += parseFloat(item.price || 0) * (item.quantity || 1);
      });
    });
  return Object.entries(map)
    .map(([category, gmv]) => ({ category, gmv: Math.round(gmv) }))
    .sort((a, b) => b.gmv - a.gmv);
}

export function calcCatalogByCategory(products) {
  const cats = {};
  for (const p of products) {
    const cat = getCategory(p.product_type, p.title);
    if (!cats[cat]) cats[cat] = { brands: new Set(), skus: 0 };
    if (p.vendor) cats[cat].brands.add(p.vendor);
    cats[cat].skus += (p.variants?.length || 1);
  }
  return Object.entries(cats)
    .map(([category, d]) => ({ category, brands: d.brands.size, skus: d.skus }))
    .sort((a, b) => b.skus - a.skus);
}

export function calcBrandConcentration(brandData) {
  if (!brandData.length) return 0;
  const total = brandData.reduce((s, b) => s + b.gmv, 0);
  const top5 = brandData.slice(0, 5).reduce((s, b) => s + b.gmv, 0);
  return total > 0 ? Math.round((top5 / total) * 1000) / 10 : 0;
}

export async function fetchRefunds(startDate, endDate) {
  const orders = await fetchOrders(startDate, endDate);
  const refunded = orders.filter(o =>
    o.financial_status === 'refunded' || o.financial_status === 'partially_refunded'
  );
  const rate = orders.length > 0 ? (refunded.length / orders.length) * 100 : 0;
  return { refundCount: refunded.length, returnRate: Math.round(rate * 10) / 10 };
}

export async function fetchCustomers(startDate, endDate, limit = 250) {
  const data = await shopifyFetch('/customers', {
    created_at_min: startDate,
    created_at_max: endDate,
    limit,
    fields: 'id,created_at,orders_count,total_spent',
  });
  return data.customers || [];
}

export function calcCustomerMetrics(newCustomers, orders) {
  const newIds = new Set(newCustomers.map(c => c.id));
  const newOrders = orders.filter(o => newIds.has(o.customer?.id));
  const total = orders.length;
  const newPct = total > 0 ? Math.round((newOrders.length / total) * 100) : 0;
  return { newCustomerCount: newCustomers.length, newOrdersPct: newPct, returningOrdersPct: 100 - newPct };
}

export async function fetchProducts(limit = 250) {
  const data = await shopifyFetch('/products', {
    limit,
    fields: 'id,title,vendor,product_type,variants,published_at',
    published_status: 'published',
  });
  return data.products || [];
}

export function calcCatalogMetrics(products) {
  const brands = new Set(products.map(p => p.vendor).filter(Boolean));
  const skus = products.reduce((sum, p) => sum + (p.variants?.length || 0), 0);
  return { totalBrands: brands.size, totalSKUs: skus };
}

export async function fetchFulfillmentMetrics(startDate, endDate) {
  const data = await shopifyFetch('/orders', {
    status: 'any',
    fulfillment_status: 'fulfilled',
    created_at_min: startDate,
    created_at_max: endDate,
    limit: 250,
    fields: 'id,created_at,fulfillments',
  });
  const orders = data.orders || [];
  const times = orders
    .filter(o => o.fulfillments?.length > 0)
    .map(o => (new Date(o.fulfillments[0].created_at) - new Date(o.created_at)) / (1000 * 60 * 60 * 24))
    .filter(t => t >= 0 && t < 30);
  const avg = times.length > 0 ? Math.round((times.reduce((s, t) => s + t, 0) / times.length) * 10) / 10 : null;
  return { avgFulfillmentDays: avg };
}

export function calcNewBrands(currentProducts, prevProducts) {
  const prevBrands = new Set(prevProducts.map(p => p.vendor));
  return [...new Set(currentProducts.map(p => p.vendor))].filter(b => !prevBrands.has(b)).length;
}

export function calcWoWChange(current, previous) {
  if (!previous || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Fetch line items from unfulfilled/partial orders that have been waiting >24h.
 * One row per unfulfilled line item.
 * Returns: [{ orderId, orderName, title, brand, isFBB, dwellHours }]
 */
export async function fetchDwellingItems() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [unfulfilled, partial] = await Promise.all([
    shopifyFetch('/orders', {
      status: 'open',
      fulfillment_status: 'unfulfilled',
      created_at_min: thirtyDaysAgo.toISOString(),
      created_at_max: cutoff.toISOString(),
      limit: 250,
      fields: 'id,name,created_at,line_items',
    }),
    shopifyFetch('/orders', {
      status: 'open',
      fulfillment_status: 'partial',
      created_at_min: thirtyDaysAgo.toISOString(),
      created_at_max: cutoff.toISOString(),
      limit: 250,
      fields: 'id,name,created_at,line_items',
    }),
  ]);

  const orders = [...(unfulfilled.orders || []), ...(partial.orders || [])];
  const now = Date.now();
  const items = [];

  for (const order of orders) {
    const ageMs = now - new Date(order.created_at).getTime();
    const dwellHours = Math.floor(ageMs / (60 * 60 * 1000));
    for (const item of (order.line_items || [])) {
      // fulfillable_quantity drops to 0 when a fulfillment is requested (even before shipping)
      // so check fulfillment_status instead — only skip fully fulfilled items
      if (item.fulfillment_status === 'fulfilled') continue;
      const isFBB = item.fulfillment_service === 'manual';
      items.push({
        orderId: order.id,
        orderName: order.name || `#${order.id}`,
        title: item.title,
        brand: isFBB ? 'FBB' : (item.vendor || 'Unknown'),
        isFBB,
        dwellHours,
      });
    }
  }

  return items.sort((a, b) => b.dwellHours - a.dwellHours);
}

/**
 * Fetch open orders 5+ days old where items haven't been delivered.
 * Iterates order.line_items (source of truth); checks fulfillments only to
 * determine carrier and whether a given item is already delivered.
 * Orders with zero fulfillments are included — no tracking = worst case.
 * Returns: [{ orderId, orderName, title, brand, isFBB, carrier, destination, daysOld }]
 */
export async function fetchLateDeliveries() {
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const data = await shopifyFetch('/orders', {
    status: 'open',
    created_at_min: thirtyDaysAgo.toISOString(),
    created_at_max: fiveDaysAgo.toISOString(),
    limit: 250,
    fields: 'id,name,created_at,line_items,fulfillments,shipping_address',
  });

  const orders = data.orders || [];
  const now = Date.now();
  const items = [];

  for (const order of orders) {
    const daysOld = Math.floor((now - new Date(order.created_at).getTime()) / (24 * 60 * 60 * 1000));
    const dest = [order.shipping_address?.city, order.shipping_address?.province_code]
      .filter(Boolean).join(', ') || '—';

    const fulfillments = order.fulfillments || [];

    // Build a set of line_item ids that are covered by a delivered fulfillment
    const deliveredLineItemIds = new Set();
    for (const f of fulfillments) {
      if (f.shipment_status === 'delivered' && f.status !== 'cancelled') {
        for (const fi of (f.line_items || [])) {
          deliveredLineItemIds.add(fi.id);
        }
      }
    }

    // Find the active (non-cancelled, non-delivered) fulfillment for carrier info
    const activeFulfillment = fulfillments.find(
      f => f.status !== 'cancelled' && f.shipment_status !== 'delivered'
    );
    const carrier = activeFulfillment?.tracking_company || (fulfillments.length === 0 ? 'No tracking' : '—');

    // Iterate order line items — these are the authoritative list
    for (const item of (order.line_items || [])) {
      // Skip if already fully fulfilled and delivered
      if (item.fulfillment_status === 'fulfilled' && deliveredLineItemIds.has(item.id)) continue;
      // Skip if the item itself is marked fulfilled but we have no fulfillment record — shouldn't happen but guard it
      if (item.fulfillment_status === 'fulfilled' && fulfillments.length === 0) continue;

      const isFBB = item.fulfillment_service === 'manual';
      items.push({
        orderId: order.id,
        orderName: order.name || `#${order.id}`,
        title: item.title,
        brand: isFBB ? 'FBB' : (item.vendor || 'Unknown'),
        isFBB,
        carrier,
        destination: dest,
        daysOld,
      });
    }
  }

  return items.sort((a, b) => b.daysOld - a.daysOld);
}

/**
 * Compute per-brand GMV/sales and fulfillment metrics for a rolling window.
 * Returns two arrays: curr (current window) and prev (prior window of same length),
 * with change % attached to each curr row.
 */
async function fetchBrandHealth(days) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const prevStart   = new Date(now.getTime() - 2 * days * 24 * 60 * 60 * 1000);

  const [currData, prevData] = await Promise.all([
    shopifyFetch('/orders', {
      status: 'any',
      created_at_min: windowStart.toISOString(),
      created_at_max: now.toISOString(),
      limit: 250,
      fields: 'id,created_at,total_price,line_items,financial_status,cancel_reason,fulfillments',
    }),
    shopifyFetch('/orders', {
      status: 'any',
      created_at_min: prevStart.toISOString(),
      created_at_max: windowStart.toISOString(),
      limit: 250,
      fields: 'id,created_at,total_price,line_items,financial_status,cancel_reason,fulfillments',
    }),
  ]);

  function calcMetrics(orders) {
    const brands = {};
    function g(vendor) {
      if (!brands[vendor]) brands[vendor] = { gmv:0, orderCount:0, refundCount:0, cancelCount:0, fulfillTimes:[], deliveryTimes:[], onTimeCount:0, totalFulfillments:0 };
      return brands[vendor];
    }

    for (const order of orders) {
      const isRefunded = order.financial_status === 'refunded' || order.financial_status === 'partially_refunded';
      const isCancelled = !!order.cancel_reason;
      const lineItems = order.line_items || [];

      const vendorGMV = {};
      const vendorSet = new Set();
      for (const item of lineItems) {
        const vendor = item.vendor || 'Unknown';
        vendorSet.add(vendor);
        vendorGMV[vendor] = (vendorGMV[vendor] || 0) + parseFloat(item.price || 0) * (item.quantity || 1);
      }

      for (const vendor of vendorSet) {
        const b = g(vendor);
        b.orderCount++;
        b.gmv += vendorGMV[vendor] || 0;
        if (isRefunded) b.refundCount++;
        if (isCancelled) b.cancelCount++;
      }

      for (const f of (order.fulfillments || [])) {
        if (f.status === 'cancelled') continue;
        const fulfillHours = (new Date(f.created_at) - new Date(order.created_at)) / (1000 * 60 * 60);
        const deliveryDays = f.shipment_status === 'delivered' && f.updated_at
          ? (new Date(f.updated_at) - new Date(order.created_at)) / (1000 * 60 * 60 * 24)
          : null;

        for (const vendor of vendorSet) {
          const b = g(vendor);
          b.totalFulfillments++;
          if (fulfillHours >= 0) {
            b.fulfillTimes.push(fulfillHours);
            if (fulfillHours < 24) b.onTimeCount++;
          }
          if (deliveryDays != null && deliveryDays >= 0 && deliveryDays < 90) {
            b.deliveryTimes.push(deliveryDays);
          }
        }
      }
    }

    return Object.fromEntries(
      Object.entries(brands).map(([brand, b]) => {
        const avgFulfillHours = b.fulfillTimes.length > 0 ? b.fulfillTimes.reduce((s,t)=>s+t,0)/b.fulfillTimes.length : null;
        const avgDeliveryDays = b.deliveryTimes.length > 0 ? b.deliveryTimes.reduce((s,t)=>s+t,0)/b.deliveryTimes.length : null;
        return [brand, {
          brand,
          gmv:          Math.round(b.gmv * 100) / 100,
          orderCount:   b.orderCount,
          aov:          b.orderCount > 0 ? Math.round((b.gmv / b.orderCount) * 100) / 100 : 0,
          returnPct:    b.orderCount > 0 ? Math.round((b.refundCount / b.orderCount) * 1000) / 10 : 0,
          cancelPct:    b.orderCount > 0 ? Math.round((b.cancelCount / b.orderCount) * 1000) / 10 : 0,
          avgFulfillHours: avgFulfillHours != null ? Math.round(avgFulfillHours * 10) / 10 : null,
          avgDeliveryDays: avgDeliveryDays != null ? Math.round(avgDeliveryDays * 10) / 10 : null,
          onTimePct:    b.totalFulfillments > 0 ? Math.round((b.onTimeCount / b.totalFulfillments) * 100) : null,
        }];
      })
    );
  }

  const curr = calcMetrics(currData.orders || []);
  const prev = calcMetrics(prevData.orders || []);

  const pct = (a, b) => b && b !== 0 ? Math.round(((a - b) / b) * 1000) / 10 : null;

  return Object.values(curr)
    .map(c => {
      const p = prev[c.brand] || {};
      return {
        ...c,
        gmvChange:        pct(c.gmv, p.gmv),
        aovChange:        pct(c.aov, p.aov),
        orderCountChange: pct(c.orderCount, p.orderCount),
        returnPctChange:  p.returnPct != null ? Math.round((c.returnPct - p.returnPct) * 10) / 10 : null,
        cancelPctChange:  p.cancelPct != null ? Math.round((c.cancelPct - p.cancelPct) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.gmv - a.gmv);
}

export async function fetchBrandHealthWeekly()  { return fetchBrandHealth(7); }
export async function fetchBrandHealthMonthly() { return fetchBrandHealth(30); }
