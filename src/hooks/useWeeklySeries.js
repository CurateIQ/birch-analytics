/**
 * useWeeklySeries.js
 * Fetches weekly aggregated data for shopify, ga4, or askbirch sources.
 * Module-level cache persists across hook instances for the session.
 */

import { useState, useEffect } from 'react';
import { fetchOrders } from '../api/shopify';
import { fetchEngagementMetrics, fetchTrafficByChannel } from '../api/ga4';
import { PROXY, PROXY_HEADERS } from '../api/proxy';
import { mondayOf, listWeeks, weekBounds } from '../utils/weeks';

// Module-level cache: key = `${source}:${weekStartISO}` → aggregate object
const cache = new Map();

function computeShopifyWeek(orders, weekStart) {
  const completed = orders.filter(
    o => o.financial_status !== 'refunded' && !o.cancel_reason
  );
  const cancelled = orders.filter(o => o.cancel_reason);
  const returned = orders.filter(
    o => o.financial_status === 'refunded' || o.financial_status === 'partially_refunded'
  );

  const gmv = completed.reduce((sum, o) => sum + parseFloat(o.total_price || 0), 0);
  const orderCount = completed.length;
  const aov = orderCount > 0 ? gmv / orderCount : 0;
  const totalItems = completed.reduce((sum, o) => sum + (o.line_items?.length || 0), 0);
  const itemsPerOrder = orderCount > 0 ? totalItems / orderCount : 0;
  const cancellationRate = orders.length > 0
    ? Math.round((cancelled.length / orders.length) * 1000) / 10
    : 0;
  const returnRate = orders.length > 0
    ? Math.round((returned.length / orders.length) * 1000) / 10
    : 0;

  // Fulfillment metrics
  const fulfillDays = [];
  const deliveryDays = [];
  let onTimeCount = 0;
  let fulfillmentTotal = 0;

  orders.forEach(o => {
    const fulfillments = o.fulfillments || [];
    fulfillments.forEach((f, idx) => {
      const orderTime = new Date(o.created_at).getTime();
      const fulfillTime = new Date(f.created_at).getTime();
      const diffDays = (fulfillTime - orderTime) / (1000 * 60 * 60 * 24);
      const diffHours = (fulfillTime - orderTime) / (1000 * 60 * 60);

      if (idx === 0 && diffDays >= 0 && diffDays <= 30) {
        fulfillDays.push(diffDays);
      }
      if (diffHours >= 0) {
        fulfillmentTotal++;
        if (diffHours < 24) onTimeCount++;
      }

      if (f.shipment_status === 'delivered') {
        const delivTime = new Date(f.updated_at).getTime();
        const dDays = (delivTime - orderTime) / (1000 * 60 * 60 * 24);
        if (dDays >= 0 && dDays <= 90) {
          deliveryDays.push(dDays);
        }
      }
    });
  });

  const avgFulfillmentDays = fulfillDays.length > 0
    ? Math.round((fulfillDays.reduce((s, v) => s + v, 0) / fulfillDays.length) * 10) / 10
    : null;

  const avgDeliveryDays = deliveryDays.length > 0
    ? Math.round((deliveryDays.reduce((s, v) => s + v, 0) / deliveryDays.length) * 10) / 10
    : null;

  const onTimePct = fulfillmentTotal > 0
    ? Math.round((onTimeCount / fulfillmentTotal) * 100)
    : null;

  return {
    weekStart,
    gmv: Math.round(gmv * 100) / 100,
    orderCount,
    aov: Math.round(aov * 100) / 100,
    itemsPerOrder: Math.round(itemsPerOrder * 10) / 10,
    cancellationRate,
    returnRate,
    avgFulfillmentDays,
    avgDeliveryDays,
    onTimePct,
  };
}

async function fetchShopifyWeek(weekStart) {
  const key = `shopify:${weekStart.toISOString()}`;
  if (cache.has(key)) return cache.get(key);
  const { start, end } = weekBounds(weekStart);
  const orders = await fetchOrders(start, end, 250);
  const result = computeShopifyWeek(orders, weekStart.toISOString());
  cache.set(key, result);
  return result;
}

async function fetchGA4Week(weekStart) {
  const key = `ga4:${weekStart.toISOString()}`;
  if (cache.has(key)) return cache.get(key);
  const { start, end } = weekBounds(weekStart);
  const [engagement, traffic] = await Promise.all([
    fetchEngagementMetrics(start, end),
    fetchTrafficByChannel(start, end, start, end),
  ]);
  const result = {
    weekStart: weekStart.toISOString(),
    totalSessions: traffic?.totalSessions ?? null,
    avgSessionDuration: engagement?.avgSessionDuration ?? null,
    pagesPerSession: engagement?.pagesPerSession ?? null,
    bounceRate: engagement?.bounceRate ?? null,
    newUserPct: engagement?.newUserPct ?? null,
    activeUsers: engagement?.activeUsers ?? null,
    conversionRate: engagement?.conversionRate ?? null,
  };
  cache.set(key, result);
  return result;
}

async function fetchAskBirchWeek(weekStart) {
  const key = `askbirch:${weekStart.toISOString()}`;
  if (cache.has(key)) return cache.get(key);
  const { start, end } = weekBounds(weekStart);
  try {
    const res = await fetch(
      `${PROXY}/ai/queries?startDate=${start}&endDate=${end}&limit=1`,
      { headers: PROXY_HEADERS }
    );
    const json = await res.json();
    const result = {
      weekStart: weekStart.toISOString(),
      totalQueries: json?.total ?? null,
    };
    cache.set(key, result);
    return result;
  } catch {
    const result = { weekStart: weekStart.toISOString(), totalQueries: null };
    cache.set(key, result);
    return result;
  }
}

export function useWeeklySeries(source) {
  const [weeklyData, setWeeklyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const floor = mondayOf(new Date('2026-06-12T12:00:00'));
        const current = mondayOf(new Date());
        const weeks = listWeeks(floor, current);

        const results = new Array(weeks.length).fill(null);

        // Fetch in batches of 3
        for (let i = 0; i < weeks.length; i += 3) {
          const batch = weeks.slice(i, i + 3);
          const batchResults = await Promise.all(
            batch.map(w => {
              if (source === 'shopify') return fetchShopifyWeek(w);
              if (source === 'ga4') return fetchGA4Week(w);
              if (source === 'askbirch') return fetchAskBirchWeek(w);
              return Promise.resolve(null);
            })
          );
          batchResults.forEach((r, j) => { results[i + j] = r; });
          if (cancelled) return;
          setWeeklyData(results.filter(Boolean));
        }

        if (!cancelled) {
          setWeeklyData(results.filter(Boolean));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Failed to load weekly data');
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [source]);

  return { weeklyData, loading, error };
}
