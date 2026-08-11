import React, { useEffect } from 'react';
import { KPICard } from '../components/KPICard';
import { TrendChart } from '../components/TrendChart';
import { useWeeklySeries } from '../hooks/useWeeklySeries';

const fmt = {
  pct: v => v == null ? '—' : `${v}%`,
  num: v => v == null ? '—' : Number(v).toLocaleString(),
};

const DEFS = {
  totalSessions:      'Total website sessions on birchstore.com in the last 7 complete days. A session starts when a user lands on the site and ends after 30 minutes of inactivity. Primary top-of-funnel volume metric.',
  bounceRate:         'Percentage of sessions where the visitor left without any interaction. Lower is better. Industry average for e-commerce is 40–55%.',
  avgSessionDuration: 'Average time visitors spend on the site per session. Longer durations signal content resonance and purchase intent.',
  pagesPerSession:    'Average number of pages viewed per session. Higher numbers indicate deeper browsing and product discovery.',
  newUserPct:         'Percentage of sessions from first-time visitors this week. High share signals strong top-of-funnel reach from marketing.',
  conversion:         'Percentage of unique site visitors who completed a purchase. Sourced from GA4. Rolling 7-day window. Target: 5%. Year-one benchmark: 1.5–3%.',
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

export function WebsitePage({ data, onBack, scrollTarget }) {
  const connected = data?.website?.connected !== false;
  const { weeklyData, loading: trendLoading } = useWeeklySeries('ga4');

  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  const w = data?.website;
  const c = data?.customers;

  return (
    <PageShell title="Website Traffic" onBack={onBack}>
      {!connected && (
        <div style={{ padding: '12px 14px', background: '#FAEEDA', border: '0.5px solid #E8C97A', borderRadius: 8, fontSize: 12, color: '#854F0B', marginBottom: 10 }}>
          ⏳ GA4 service account pending access — data will populate automatically once the service account is added as Viewer on the property.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <KPICard
          label="Sessions (week)"
          value={w?.totalSessions != null ? fmt.num(w.totalSessions) : null}
          change={w?.totalSessionsWoW}
          changeLabel={w?.totalSessions == null ? 'GA4 pending' : null}
          definition={DEFS.totalSessions}
        />
        <KPICard
          label="Bounce rate"
          value={w?.bounceRate != null ? fmt.pct(w.bounceRate) : null}
          change={null}
          changeLabel={w?.bounceRate == null ? 'GA4 pending' : 'lower is better'}
          definition={DEFS.bounceRate}
        />
        <KPICard
          label="Avg session duration"
          value={w?.avgSessionDuration}
          change={null}
          changeLabel={w?.avgSessionDuration == null ? 'GA4 pending' : null}
          definition={DEFS.avgSessionDuration}
        />
        <KPICard
          label="Pages per session"
          value={w?.pagesPerSession}
          change={null}
          changeLabel={w?.pagesPerSession == null ? 'GA4 pending' : null}
          definition={DEFS.pagesPerSession}
        />
        <KPICard
          label="New visitor %"
          value={w?.newUserPct != null ? fmt.pct(w.newUserPct) : null}
          change={null}
          changeLabel={w?.newUserPct == null ? 'GA4 pending' : null}
          definition={DEFS.newUserPct}
        />
        <KPICard
          label="Conversion rate"
          value={c?.conversionRate ? fmt.pct(c.conversionRate) : null}
          change={null}
          changeLabel="GA4 pending"
          definition={DEFS.conversion}
        />
      </div>

      <SectionLabel>Weekly Trends</SectionLabel>

      {trendLoading && connected && (
        <div style={{ fontSize: 12, color: '#8C8A85', marginBottom: 8 }}>Loading weekly trend data…</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ChartCard title="Weekly Sessions" id="trend-sessions">
          <TrendChart
            id="trend-sessions-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.totalSessions }))}
            label="Weekly Sessions"
            color="#5A7A5C"
            valueFormatter={v => v?.toLocaleString()}
            pending={!connected}
            pendingMessage="Awaiting GA4 connection"
          />
        </ChartCard>

        <ChartCard title="Bounce Rate" id="trend-bounce">
          <TrendChart
            id="trend-bounce-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.bounceRate }))}
            label="Bounce Rate"
            color="#A32D2D"
            valueFormatter={v => v != null ? v + '%' : '—'}
            pending={!connected}
            pendingMessage="Awaiting GA4 connection"
          />
        </ChartCard>

        <ChartCard title="Avg Session Duration" id="trend-session-duration">
          <TrendChart
            id="trend-session-duration-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: null }))}
            label="Avg Session Duration"
            color="#378ADD"
            valueFormatter={v => v != null ? v : '—'}
            pending={true}
            pendingMessage={connected ? 'Duration stored as string — numeric trend pending' : 'Awaiting GA4 connection'}
          />
        </ChartCard>

        <ChartCard title="Pages per Session" id="trend-pages-per-session">
          <TrendChart
            id="trend-pages-per-session-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.pagesPerSession }))}
            label="Pages per Session"
            color="#C8763A"
            valueFormatter={v => v != null ? v.toFixed(1) : '—'}
            pending={!connected}
            pendingMessage="Awaiting GA4 connection"
          />
        </ChartCard>

        <ChartCard title="New Visitor %" id="trend-new-user-pct">
          <TrendChart
            id="trend-new-user-pct-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.newUserPct }))}
            label="New Visitor %"
            color="#7A5C8A"
            valueFormatter={v => v != null ? v + '%' : '—'}
            pending={!connected}
            pendingMessage="Awaiting GA4 connection"
          />
        </ChartCard>
      </div>

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
