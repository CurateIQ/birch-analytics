import React, { useEffect } from 'react';
import { KPICard } from '../components/KPICard';
import { TrendChart } from '../components/TrendChart';
import { useWeeklySeries } from '../hooks/useWeeklySeries';

const fmt = {
  usd:    v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
  pct:    v => v == null ? '—' : `${v}%`,
  num:    v => v == null ? '—' : Number(v).toLocaleString(),
};

const DEFS = {
  mau:          'Monthly Active Users — unique buyers with at least one order in the last 30 complete days (midnight ET). The north star growth metric.',
  wau:          'Weekly Active Users — unique buyers with at least one order in the last 7 complete days. Provides a faster weekly pulse.',
  newCustomers: 'Net new customers who made their first-ever purchase in the last 7 complete days. Leading indicator for MAU growth 4–6 weeks out.',
  newOrdersPct: 'Percentage of orders this week from first-time customers. High share signals strong acquisition.',
  returningPct: 'Percentage of orders this week from customers who have purchased before. Rising share signals growing loyalty.',
  conversion:   'Percentage of unique site visitors who completed a purchase. Sourced from GA4. Rolling 7-day window. Target: 5%. Year-one benchmark: 1.5–3%.',
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

export function CustomersPage({ data, onBack, scrollTarget }) {
  const { weeklyData, loading: trendLoading } = useWeeklySeries('shopify');
  const websiteConnected = data?.website?.connected;
  const { weeklyData: ga4Data, loading: ga4Loading } = useWeeklySeries('ga4');

  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  const c = data?.customers;

  return (
    <PageShell title="Customers" onBack={onBack}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <KPICard label="MAU"               value={fmt.num(c?.mau)}              change={null} changeLabel="30 complete days" definition={DEFS.mau} />
        <KPICard label="WAU"               value={fmt.num(c?.wau)}              change={null} definition={DEFS.wau} />
        <KPICard label="New customers"     value={fmt.num(c?.newCustomerCount)} change={c?.newCustomersWoW} definition={DEFS.newCustomers} />
        <KPICard label="New orders %"      value={fmt.pct(c?.newOrdersPct)}     change={null} definition={DEFS.newOrdersPct} />
        <KPICard label="Returning orders %" value={fmt.pct(c?.returningOrdersPct)} change={null} definition={DEFS.returningPct} />
        <KPICard
          label="Conversion rate"
          value={c?.conversionRate ? fmt.pct(c.conversionRate) : null}
          change={null}
          changeLabel="GA4 pending"
          definition={DEFS.conversion}
        />
      </div>

      <SectionLabel>Weekly Trends</SectionLabel>

      {trendLoading && (
        <div style={{ fontSize: 12, color: '#8C8A85', marginBottom: 8 }}>Loading weekly trend data…</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ChartCard title="Monthly Active Users" id="trend-mau">
          <TrendChart
            id="trend-mau-chart"
            data={[]}
            label="Monthly Active Users"
            color="#5A7A5C"
            pending={true}
            pendingMessage="Customer query endpoint pending"
          />
        </ChartCard>

        <ChartCard title="New Orders %" id="trend-new-orders-pct">
          <TrendChart
            id="trend-new-orders-pct-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: null }))}
            label="New Orders %"
            color="#5A7A5C"
            pending={true}
            pendingMessage="New vs returning breakdown pending"
          />
        </ChartCard>

        <ChartCard title="Returning Orders %" id="trend-returning-pct">
          <TrendChart
            id="trend-returning-pct-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: null }))}
            label="Returning Orders %"
            color="#378ADD"
            pending={true}
            pendingMessage="New vs returning breakdown pending"
          />
        </ChartCard>

        <ChartCard title="Conversion Rate" id="trend-conversion">
          <TrendChart
            id="trend-conversion-chart"
            data={websiteConnected
              ? ga4Data.map(w => ({ weekStart: w.weekStart, value: null }))
              : []
            }
            label="Conversion Rate"
            color="#7A5C8A"
            pending={!websiteConnected}
            pendingMessage="Awaiting GA4 connection"
          />
        </ChartCard>
      </div>

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
