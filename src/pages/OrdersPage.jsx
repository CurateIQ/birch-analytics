import React, { useEffect } from 'react';
import { KPICard } from '../components/KPICard';
import { TrendChart } from '../components/TrendChart';
import { useWeeklySeries } from '../hooks/useWeeklySeries';

const fmt = {
  usd:    v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
  usdDec: v => v == null ? '—' : `$${Number(v).toFixed(2)}`,
  pct:    v => v == null ? '—' : `${v}%`,
  num:    v => v == null ? '—' : Number(v).toLocaleString(),
  days:   v => v == null ? '—' : `${v}d`,
};

const DEFS = {
  gmv:          'Total value of all orders placed in the period, before deductions. Tracked as rolling last 7 complete days (midnight ET to midnight ET). The primary top-line growth metric.',
  orders:       'Count of completed orders in the last 7 complete days. Tracked alongside GMV to understand whether revenue growth is driven by more orders or higher order values.',
  aov:          'GMV divided by number of orders for the week. Measures how much customers spend per transaction.',
  itemsPerOrder:'Average number of SKUs included in each order this week. A rising number signals catalog depth and cross-sell effectiveness.',
  cancellation: 'Percentage of orders cancelled after placement, before fulfilment, this week. High rates may signal pricing, shipping, or trust issues.',
  returnRate:   'Percentage of delivered orders resulting in a return or refund this week. A key quality and trust signal for a curated marketplace.',
};

function PageShell({ title, onBack, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 18px' }}>
        <button onClick={onBack} style={{ background: '#F0EDE6', border: '0.5px solid #E0DDD6', borderRadius: 7, padding: '4px 10px', fontSize: 11, color: '#3D3226', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}>
          ← Dashboard
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#3D3226', letterSpacing: '0.02em' }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#8C8A85', textTransform: 'uppercase', margin: '20px 0 8px' }}>
      {children}
    </div>
  );
}

function ChartCard({ title, children, id }) {
  return (
    <div id={id} style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#3D3226', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

export function OrdersPage({ data, onBack, scrollTarget }) {
  const { weeklyData, loading: trendLoading } = useWeeklySeries('shopify');

  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  const o = data?.orders;

  return (
    <PageShell title="Orders & Transactions" onBack={onBack}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <KPICard
          label="GMV (week)"
          value={fmt.usd(o?.gmv)}
          change={o?.gmvWoW}
          definition={DEFS.gmv}
          drillTitle="GMV by brand"
          drillData={(o?.gmvByBrand || []).slice(0, 8).map(b => ({ label: b.brand, value: b.gmv, formatted: fmt.usd(b.gmv) }))}
        />
        <KPICard
          label="Orders placed"
          value={fmt.num(o?.orderCount)}
          change={o?.ordersWoW}
          definition={DEFS.orders}
          drillTitle="Orders by category"
          drillData={(o?.gmvByCategory || []).slice(0, 8).map(c => ({ label: c.category, value: c.gmv, formatted: fmt.usd(c.gmv) }))}
        />
        <KPICard label="Avg order value"    value={fmt.usdDec(o?.aov)}            change={o?.aovWoW} definition={DEFS.aov} />
        <KPICard label="Items per order"    value={o?.itemsPerOrder}               change={null}      definition={DEFS.itemsPerOrder} />
        <KPICard label="Cancellation rate"  value={fmt.pct(o?.cancellationRate)}   change={null}      definition={DEFS.cancellation} />
        <KPICard label="Return rate"        value={fmt.pct(o?.returnRate)}         change={null}      definition={DEFS.returnRate} />
      </div>

      <SectionLabel>Weekly Trends</SectionLabel>

      {trendLoading && (
        <div style={{ fontSize: 12, color: '#8C8A85', marginBottom: 8 }}>Loading weekly trend data…</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ChartCard title="Weekly GMV" id="trend-gmv">
          <TrendChart
            id="trend-gmv-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.gmv }))}
            label="Weekly GMV"
            color="#5A7A5C"
            valueFormatter={v => '$' + Math.round(v).toLocaleString()}
          />
        </ChartCard>

        <ChartCard title="Weekly Orders" id="trend-orders">
          <TrendChart
            id="trend-orders-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.orderCount }))}
            label="Weekly Orders"
            color="#378ADD"
            valueFormatter={v => v?.toLocaleString()}
          />
        </ChartCard>

        <ChartCard title="Avg Order Value" id="trend-aov">
          <TrendChart
            id="trend-aov-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.aov }))}
            label="Avg Order Value"
            color="#C8763A"
            valueFormatter={v => v ? '$' + Number(v).toFixed(0) : '—'}
          />
        </ChartCard>

        <ChartCard title="Items per Order" id="trend-items">
          <TrendChart
            id="trend-items-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.itemsPerOrder }))}
            label="Items per Order"
            color="#7A5C8A"
            valueFormatter={v => v?.toFixed(1)}
          />
        </ChartCard>

        <ChartCard title="Cancellation Rate" id="trend-cancel">
          <TrendChart
            id="trend-cancel-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.cancellationRate }))}
            label="Cancellation Rate"
            color="#A32D2D"
            valueFormatter={v => v != null ? v + '%' : '—'}
          />
        </ChartCard>

        <ChartCard title="Return Rate" id="trend-return">
          <TrendChart
            id="trend-return-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.returnRate }))}
            label="Return Rate"
            color="#854F0B"
            valueFormatter={v => v != null ? v + '%' : '—'}
          />
        </ChartCard>
      </div>

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
