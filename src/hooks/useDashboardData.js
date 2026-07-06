/**
 * useDashboardData.js
 * Central data hook — fetches all metrics from Shopify + Klaviyo.
 * Time definitions:
 *   - Day    = midnight to midnight ET (America/New_York)
 *   - Week   = rolling 7 complete days ending at most recent midnight ET
 *   - WoW    = 7 complete days before that
 */

import { useState, useEffect, useCallback } from 'react';
import {
  fetchOrders, fetchCustomers, fetchProducts,
  fetchRefunds, fetchFulfillmentMetrics,
  fetchDwellingItems, fetchLateDeliveries,
  calcOrderMetrics, calcDailyGMV, calcGMVByBrand,
  calcGMVByCategory, calcBrandConcentration,
  calcCatalogMetrics, calcNewBrands, calcCustomerMetrics,
  calcWoWChange,
} from '../api/shopify';
import { fetchListMetrics } from '../api/klaviyo';
import { PROXY, PROXY_HEADERS } from '../api/proxy';
import {
  fetchTrafficByChannel,
  fetchDailySessions,
  fetchTopLandingPages,
  fetchEngagementMetrics,
  fetchCartAbandonRate,
} from '../api/ga4';

const TZ = 'America/New_York';

/** Returns midnight ET for a given offset of days ago */
function etMidnight(daysAgo = 0) {
  const now = new Date();
  // Get current date string in ET
  const etDateStr = now.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const [y, m, d] = etDateStr.split('-').map(Number);
  // Construct midnight ET by using the ET date parts
  const midnight = new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T00:00:00`);
  // Adjust for days ago
  midnight.setDate(midnight.getDate() - daysAgo);
  return midnight;
}

export function getTimeRanges() {
  const todayMidnight    = etMidnight(0);   // today 00:00 ET
  const weekStart        = etMidnight(7);   // 7 days ago midnight ET
  const prevWeekStart    = etMidnight(14);  // 14 days ago midnight ET
  const monthStart       = etMidnight(30);  // 30 days ago midnight ET
  const twoWeeksStart    = etMidnight(14);  // for 14-day GMV chart
  const now              = new Date();

  return {
    // Today: midnight ET → now
    todayStart:    todayMidnight.toISOString(),
    todayEnd:      now.toISOString(),
    // Yesterday: same hour window as today for comparison
    yesterdayStart: etMidnight(1).toISOString(),
    yesterdayEnd:   new Date(etMidnight(1).getTime() + (now - todayMidnight)).toISOString(),
    // This week: 7 complete days ending at today's midnight
    weekStart:     weekStart.toISOString(),
    weekEnd:       todayMidnight.toISOString(),
    // Prior week: 7 complete days before that
    prevWeekStart: prevWeekStart.toISOString(),
    prevWeekEnd:   weekStart.toISOString(),
    // Month: 30 complete days
    monthStart:    monthStart.toISOString(),
    monthEnd:      todayMidnight.toISOString(),
    // 14-day chart
    twoWeeksStart: twoWeeksStart.toISOString(),
    // Current ET date label
    todayLabel:    todayMidnight.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }),
    currentTime:   now.toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }),
  };
}

export function useDashboardData() {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const ranges = getTimeRanges();

      const [
        todayOrders, yesterdayOrders,
        weekOrders, prevWeekOrders,
        monthOrders, twoWeekOrders,
        weekCustomers, prevWeekCustomers,
        currentProducts,
        refundData, fulfillmentData,
        klaviyoLists,
        ga4Traffic, ga4DailySessions, ga4LandingPages, ga4Engagement, ga4CartAbandon,
        opsDwelling, opsLate, aiQueries,
      ] = await Promise.allSettled([
        fetchOrders(ranges.todayStart,     ranges.todayEnd),
        fetchOrders(ranges.yesterdayStart, ranges.yesterdayEnd),
        fetchOrders(ranges.weekStart,      ranges.weekEnd),
        fetchOrders(ranges.prevWeekStart,  ranges.prevWeekEnd),
        fetchOrders(ranges.monthStart,     ranges.monthEnd),
        fetchOrders(ranges.twoWeeksStart,  ranges.weekEnd),
        fetchCustomers(ranges.weekStart,   ranges.weekEnd),
        fetchCustomers(ranges.prevWeekStart, ranges.prevWeekEnd),
        fetchProducts(),
        fetchRefunds(ranges.weekStart,     ranges.weekEnd),
        fetchFulfillmentMetrics(ranges.weekStart, ranges.weekEnd),
        fetchListMetrics(),
        // GA4
        fetchTrafficByChannel(ranges.weekStart, ranges.weekEnd, ranges.prevWeekStart, ranges.prevWeekEnd),
        fetchDailySessions(ranges.twoWeeksStart, ranges.weekEnd),
        fetchTopLandingPages(ranges.weekStart, ranges.weekEnd),
        fetchEngagementMetrics(ranges.weekStart, ranges.weekEnd),
        fetchCartAbandonRate(ranges.todayStart, ranges.todayEnd),
        fetchDwellingItems(),
        fetchLateDeliveries(),
        fetch(`${PROXY}/ai/queries?days=7&limit=25`, { headers: PROXY_HEADERS }).then(r => r.json()),
      ]);

      const r = (res, fb) => res.status === 'fulfilled' ? res.value : fb;

      const tOrders  = r(todayOrders,       []);
      const yOrders  = r(yesterdayOrders,   []);
      const wOrders  = r(weekOrders,        []);
      const pOrders  = r(prevWeekOrders,    []);
      const mOrders  = r(monthOrders,       []);
      const twOrders = r(twoWeekOrders,     []);
      const wCusts   = r(weekCustomers,     []);
      const pCusts   = r(prevWeekCustomers, []);
      const prods    = r(currentProducts,   []);
      const refunds  = r(refundData,        { returnRate: 0, refundCount: 0 });
      const fulfill  = r(fulfillmentData,   { avgFulfillmentDays: null });
      const klaviyo  = r(klaviyoLists,      { totalProfiles: 0, lists: [] });
      const traffic      = r(ga4Traffic,        null);
      const dailySess    = r(ga4DailySessions,  []);
      const landingPg    = r(ga4LandingPages,   []);
      const engage       = r(ga4Engagement,     {});
      const cartAbandon  = r(ga4CartAbandon,    null);
      const dwelling     = r(opsDwelling,       []);
      const late         = r(opsLate,           []);
      const queries      = r(aiQueries,         { total: 0, topQueries: [], recent: [] });

      // Weekly metrics
      const weekM    = calcOrderMetrics(wOrders);
      const prevM    = calcOrderMetrics(pOrders);

      // Today metrics
      const todayM   = calcOrderMetrics(tOrders);
      const yestM    = calcOrderMetrics(yOrders);

      const dailyGMV      = calcDailyGMV(twOrders, 14);
      const gmvByBrand    = calcGMVByBrand(wOrders);
      const gmvByCategory = calcGMVByCategory(wOrders);
      const catalogM      = calcCatalogMetrics(prods);
      const newBrands     = calcNewBrands(prods, prods);
      const brandConc     = calcBrandConcentration(gmvByBrand);
      const custM         = calcCustomerMetrics(wCusts, wOrders);

      // MAU — unique buyers in last 30 days
      const mauSet = new Set(mOrders.map(o => o.customer?.id).filter(Boolean));
      const wauSet = new Set(wOrders.map(o => o.customer?.id).filter(Boolean));

      const todayCartAbandon = cartAbandon !== null ? cartAbandon / 100 : null;

      setData({
        ranges,
        today: {
          gmv:          todayM.gmv,
          gmvVsYest:    calcWoWChange(todayM.gmv, yestM.gmv),
          orders:       todayM.orderCount,
          ordersVsYest: calcWoWChange(todayM.orderCount, yestM.orderCount),
          aov:          todayM.aov,
          aovVsYest:    calcWoWChange(todayM.aov, yestM.aov),
          newCustomers: wCusts.filter(c => {
            const d = new Date(c.created_at);
            return d >= new Date(ranges.todayStart);
          }).length,
          cartAbandon:  todayCartAbandon,
          timeLabel:    ranges.currentTime,
          dateLabel:    ranges.todayLabel,
        },
        orders: {
          gmv:          weekM.gmv,
          gmvWoW:       calcWoWChange(weekM.gmv, prevM.gmv),
          orderCount:   weekM.orderCount,
          ordersWoW:    calcWoWChange(weekM.orderCount, prevM.orderCount),
          aov:          weekM.aov,
          aovWoW:       calcWoWChange(weekM.aov, prevM.aov),
          itemsPerOrder: weekM.itemsPerOrder,
          cancellationRate: weekM.cancellationRate,
          returnRate:   refunds.returnRate,
          dailyGMV,
          gmvByBrand,
          gmvByCategory,
        },
        customers: {
          mau:              mauSet.size,
          wau:              wauSet.size,
          newCustomerCount: wCusts.length,
          newCustomersWoW:  calcWoWChange(wCusts.length, pCusts.length),
          newOrdersPct:     custM.newOrdersPct,
          returningOrdersPct: custM.returningOrdersPct,
          conversionRate:   null,
        },
        marketplace: {
          totalBrands:       catalogM.totalBrands,
          totalSKUs:         catalogM.totalSKUs,
          newBrandsThisWeek: newBrands,
          brandConcentration: brandConc,
          avgFulfillmentDays: fulfill.avgFulfillmentDays,
          overallReturnRate: refunds.returnRate,
          gmvByBrand,
        },
        operations: {
          dwelling,
          late,
        },
        askBirch: {
          total:      queries.total,
          topQueries: queries.topQueries,
          recent:     queries.recent,
        },
        email: {
          totalListSize: klaviyo.totalProfiles,
          lists:         klaviyo.lists,
        },
        website: {
          // Traffic sources
          totalSessions:    traffic?.totalSessions ?? null,
          totalSessionsWoW: traffic?.totalWoW ?? null,
          channels:         traffic?.channels ?? [],
          // Engagement
          avgSessionDuration: engage?.avgSessionDuration ?? null,
          pagesPerSession:    engage?.pagesPerSession ?? null,
          bounceRate:         engage?.bounceRate ?? null,
          newUserPct:         engage?.newUserPct ?? null,
          // Charts
          dailySessions: dailySess,
          topLandingPages: landingPg,
          // GA4 connected flag
          connected: traffic !== null,
        },
      });

      setLastUpdated(new Date());
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return { data, loading, error, lastUpdated, refresh: fetchAll };
}
