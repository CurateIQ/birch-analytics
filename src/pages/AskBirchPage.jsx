import React, { useEffect } from 'react';
import { TrendChart } from '../components/TrendChart';
import { useWeeklySeries } from '../hooks/useWeeklySeries';
import { customerAdminUrl } from '../components/ChatTranscriptModal';

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

export function AskBirchPage({ data, onBack, scrollTarget, onViewChat }) {
  const { weeklyData, loading: trendLoading } = useWeeklySeries('askbirch');

  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      document.getElementById(scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  const ab = data?.askBirch;

  return (
    <PageShell title="Ask Birch — Customer Queries" onBack={onBack}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* Top queries */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#3D3226' }}>Top queries (7 days)</span>
            <span style={{ fontSize: 10, background: '#F0EDE6', color: '#5F5E5A', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>
              {ab?.total || 0} total
            </span>
          </div>
          {(ab?.topQueries?.length || 0) === 0 ? (
            <div style={{ fontSize: 12, color: '#8C8A85', padding: '8px 0' }}>No queries yet — data builds as customers chat</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 36px', gap: '0 8px', fontSize: 10 }}>
              {['Query', '#'].map(h => (
                <div key={h} style={{ fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 5, borderBottom: '1px solid #E0DDD6' }}>{h}</div>
              ))}
              {(ab.topQueries || []).slice(0, 15).map((q, i) => (
                <React.Fragment key={i}>
                  <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6', color: '#3D3226', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={q.query}>{q.query}</div>
                  <div style={{ padding: '4px 0', borderBottom: '0.5px solid #F0EDE6', color: '#378ADD', fontWeight: 600, fontFamily: 'DM Mono, monospace', textAlign: 'right' }}>{q.count}</div>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Recent chats */}
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#3D3226', marginBottom: 10 }}>Recent chats</div>
          {(ab?.recent?.length || 0) === 0 ? (
            <div style={{ fontSize: 12, color: '#8C8A85', padding: '8px 0' }}>No queries yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {(ab.recent || []).slice(0, 12).map((q, i) => (
                <div key={q.sessionId || i} style={{ borderBottom: '0.5px solid #F0EDE6', paddingBottom: 5 }}>
                  <div style={{ fontSize: 11, color: '#3D3226', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={q.query}>
                    {q.query || '(no title)'}
                  </div>
                  <div style={{ fontSize: 10, color: '#8C8A85', marginTop: 1, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>{q.ts ? new Date(q.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    {q.messageCount != null && <span>{q.messageCount} msg</span>}
                    {q.wasEscalated && <span style={{ color: '#B0483C', fontWeight: 600 }}>escalated</span>}
                    {customerAdminUrl(q.customerId) ? (
                      <a href={customerAdminUrl(q.customerId)} target="_blank" rel="noreferrer"
                        style={{ color: '#378ADD', fontWeight: 600, textDecoration: 'none' }}>
                        Customer ↗
                      </a>
                    ) : (
                      <span>guest</span>
                    )}
                    {q.sessionId && onViewChat && (
                      <button onClick={() => onViewChat(q.sessionId)}
                        style={{ border: 'none', background: '#F0EDE6', color: '#3D3226', borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        View chat
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SectionLabel>Weekly Trends</SectionLabel>

      {trendLoading && (
        <div style={{ fontSize: 12, color: '#8C8A85', marginBottom: 8 }}>Loading weekly trend data…</div>
      )}

      <ChartCard title="Weekly Queries" id="trend-queries">
        <TrendChart
          id="trend-queries-chart"
          data={weeklyData.map(w => ({ weekStart: w.weekStart, value: w.totalQueries }))}
          label="Weekly Queries"
          color="#378ADD"
          valueFormatter={v => v != null ? v.toLocaleString() : '—'}
        />
      </ChartCard>

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
