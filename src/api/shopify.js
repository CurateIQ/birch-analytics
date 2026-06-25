/**
 * shopify.js
 * All Shopify API calls routed through the birch-api-proxy Lambda.
 * Proxy URL: https://ez5e63jmydqmttr3qorvopyyt40baytn.lambda-url.us-east-1.on.aws
 */

const PROXY = 'https://ez5e63jmydqmttr3qorvopyyt40baytn.lambda-url.us-east-1.on.aws';

async function shopifyFetch(endpoint, params = {}) {
  const url = new URL(`${PROXY}/shopify${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
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

export function calcGMVByBrand(orders) {
  const map = {};
  orders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .forEach(o => {
      (o.line_items || []).forEach(item => {
        const vendor = item.vendor || 'Unknown';
        if (!map[vendor]) map[vendor] = 0;
        map[vendor] += parseFloat(item.price || 0) * (item.quantity || 1);
      });
    });
  return Object.entries(map)
    .map(([brand, gmv]) => ({ brand, gmv: Math.round(gmv) }))
    .sort((a, b) => b.gmv - a.gmv);
}

export function calcGMVByCategory(orders) {
  const map = {};
  orders
    .filter(o => !o.cancel_reason && o.financial_status !== 'refunded')
    .forEach(o => {
      (o.line_items || []).forEach(item => {
        const cat = item.product_type || 'Other';
        if (!map[cat]) map[cat] = 0;
        map[cat] += parseFloat(item.price || 0) * (item.quantity || 1);
      });
    });
  return Object.entries(map)
    .map(([category, gmv]) => ({ category, gmv: Math.round(gmv) }))
    .sort((a, b) => b.gmv - a.gmv);
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
