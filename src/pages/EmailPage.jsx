import React, { useEffect } from 'react';
import { KPICard } from '../components/KPICard';
import { TrendChart } from '../components/TrendChart';

const fmt = {
  num: v => v == null ? '—' : Number(v).toLocaleString(),
};

const DEFS = {
  listSize:  'Total number of profiles across all Klaviyo email and SMS lists. A direct CAC reduction lever as the list grows.',
  openRate:  'Percentage of delivered emails that were opened by recipients. Industry benchmark for e-commerce is 20–30%. Check Klaviyo dashboard for the latest number.',
  clickRate: 'Percentage of delivered emails where a recipient clicked at least one link. Industry benchmark for e-commerce is 2–5%. Check Klaviyo dashboard for the latest number.',
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

export function EmailPage({ data, onBack, scrollTarget }) {
  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  const e = data?.email;

  return (
    <PageShell title="Email & CRM" onBack={onBack}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <KPICard label="Total list size" value={fmt.num(e?.totalListSize)} change={null} definition={DEFS.listSize} />
        <KPICard label="Open rate"  value={null} change={null} changeLabel="Klaviyo — check dashboard" definition={DEFS.openRate} />
        <KPICard label="Click rate" value={null} change={null} changeLabel="Klaviyo — check dashboard" definition={DEFS.clickRate} />
      </div>

      <SectionLabel>Weekly Trends</SectionLabel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ChartCard title="Total List Size" id="trend-list-size">
          <TrendChart
            id="trend-list-size-chart"
            data={[]}
            label="Total List Size"
            color="#5A7A5C"
            pending={true}
            pendingMessage="Klaviyo weekly snapshots pending"
          />
        </ChartCard>

        <ChartCard title="Open Rate" id="trend-open-rate">
          <TrendChart
            id="trend-open-rate-chart"
            data={[]}
            label="Open Rate"
            color="#378ADD"
            pending={true}
            pendingMessage="Klaviyo — check dashboard"
          />
        </ChartCard>

        <ChartCard title="Click Rate" id="trend-click-rate">
          <TrendChart
            id="trend-click-rate-chart"
            data={[]}
            label="Click Rate"
            color="#C8763A"
            pending={true}
            pendingMessage="Klaviyo — check dashboard"
          />
        </ChartCard>
      </div>

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
