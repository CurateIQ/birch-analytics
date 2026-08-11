import React, { useEffect } from 'react';
import { TrendChart } from '../components/TrendChart';
import { useWeeklySeries } from '../hooks/useWeeklySeries';

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

export function OperationsPage({ data, onBack, scrollTarget }) {
  const { weeklyData, loading: trendLoading } = useWeeklySeries('shopify');

  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  return (
    <PageShell title="Operations" onBack={onBack}>
      <SectionLabel>Real-time Snapshots</SectionLabel>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Dwelling orders table */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#3D3226' }}>Dwelling orders</span>
            <span style={{ fontSize: 10, background: '#F0EDE6', color: '#5F5E5A', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>
              {(data?.operations?.dwelling?.length || 0)} items
            </span>
          </div>
          {(data?.operations?.dwelling?.length || 0) === 0 ? (
            <div style={{ fontSize: 12, color: '#8C8A85', padding: '8px 0' }}>No orders dwelling &gt;24h ✓</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 64px 56px', gap: '0 6px', fontSize: 10, minWidth: 280 }}>
                {['Order #', 'Item', 'Brand', 'Dwell'].map(h => (
                  <div key={h} style={{ fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 5, borderBottom: '1px solid #E0DDD6', whiteSpace: 'nowrap' }}>{h}</div>
                ))}
                {(data?.operations?.dwelling || []).map((item, i) => {
                  const dwellColor = item.dwellHours > 48 ? '#A32D2D' : item.dwellHours > 36 ? '#854F0B' : '#8C8A85';
                  return (
                    <React.Fragment key={i}>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6' }}>
                        <a href={`https://admin.shopify.com/store/birchstoreco/orders/${item.orderId}`} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#378ADD', textDecoration: 'none' }}>
                          {item.orderName}
                        </a>
                      </div>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6', color: '#3D3226', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</div>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6' }}>
                        {item.isFBB
                          ? <span style={{ color: '#6B3FA0', fontWeight: 600 }}>FBB</span>
                          : <span style={{ color: '#5F5E5A' }}>{item.brand}</span>}
                      </div>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6', color: dwellColor, fontWeight: 500, fontFamily: 'DM Mono, monospace' }}>{item.dwellHours}h</div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Late deliveries table */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#3D3226' }}>Late deliveries (beyond 5 days)</span>
            <span style={{ fontSize: 10, background: '#F0EDE6', color: '#5F5E5A', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>
              {(data?.operations?.late?.length || 0)} items
            </span>
          </div>
          {(data?.operations?.late?.length || 0) === 0 ? (
            <div style={{ fontSize: 12, color: '#8C8A85', padding: '8px 0' }}>No late deliveries ✓</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr 64px 80px 36px', gap: '0 6px', fontSize: 10, minWidth: 340 }}>
                {['Order #', 'Item', 'Brand', 'Carrier / Dest', 'Days'].map(h => (
                  <div key={h} style={{ fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 5, borderBottom: '1px solid #E0DDD6', whiteSpace: 'nowrap' }}>{h}</div>
                ))}
                {(data?.operations?.late || []).map((item, i) => {
                  const daysColor = item.daysOld > 7 ? '#A32D2D' : '#854F0B';
                  return (
                    <React.Fragment key={i}>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6' }}>
                        <a href={`https://admin.shopify.com/store/birchstoreco/orders/${item.orderId}`} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#378ADD', textDecoration: 'none' }}>
                          {item.orderName}
                        </a>
                      </div>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6', color: '#3D3226', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.title}>{item.title}</div>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6' }}>
                        {item.isFBB
                          ? <span style={{ color: '#6B3FA0', fontWeight: 600 }}>FBB</span>
                          : <span style={{ color: '#5F5E5A' }}>{item.brand}</span>}
                      </div>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6', color: '#5F5E5A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.carrier} / {item.destination}</div>
                      <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6', color: daysColor, fontWeight: 600, fontFamily: 'DM Mono, monospace' }}>{item.daysOld}d</div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <SectionLabel>Weekly Trends</SectionLabel>

      {trendLoading && (
        <div style={{ fontSize: 12, color: '#8C8A85', marginBottom: 8 }}>Loading weekly trend data…</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <ChartCard title="Avg Fulfillment Time (days)" id="trend-fulfillment-days">
          <TrendChart
            id="trend-fulfillment-days-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.avgFulfillmentDays }))}
            label="Avg Fulfillment Time (days)"
            color="#5A7A5C"
            valueFormatter={v => v != null ? v + 'd' : '—'}
          />
        </ChartCard>

        <ChartCard title="Avg Delivery Time (days)" id="trend-delivery-days">
          <TrendChart
            id="trend-delivery-days-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.avgDeliveryDays }))}
            label="Avg Delivery Time (days)"
            color="#378ADD"
            valueFormatter={v => v != null ? v + 'd' : '—'}
          />
        </ChartCard>

        <ChartCard title="On-Time Fulfillment %" id="trend-ontime-pct">
          <TrendChart
            id="trend-ontime-pct-chart"
            data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.onTimePct }))}
            label="On-Time Fulfillment %"
            color="#7A9E7E"
            valueFormatter={v => v != null ? v + '%' : '—'}
          />
        </ChartCard>
      </div>

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
