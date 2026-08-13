/**
 * CollectivePage.jsx
 * Collective unit economics — margin analysis for the 6 Collective suppliers.
 * Layout: KPI cards → rolling 7-day charts → since-launch weekly charts → by-brand table.
 */

import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { KPICard } from '../components/KPICard';
import { fetchCollectiveMarginData } from '../api/collectiveMargin';

// ── colour tokens ─────────────────────────────────────────────────────────────
const GROSS_COLOR = '#5A7A5C';
const NET_COLOR   = '#C8763A';

// ── shared sub-components ─────────────────────────────────────────────────────

function PageShell({ title, subtitle, onBack, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 18px' }}>
        <button
          onClick={onBack}
          style={{ background: '#F0EDE6', border: '0.5px solid #E0DDD6', borderRadius: 7, padding: '4px 10px', fontSize: 11, color: '#3D3226', cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
        >
          ← Dashboard
        </button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#3D3226', letterSpacing: '0.02em' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10, color: '#8C8A85', marginTop: 1 }}>{subtitle}</div>}
        </div>
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

function ChartCard({ title, children, id, legend }) {
  return (
    <div id={id} style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#3D3226' }}>{title}</div>
        {legend && (
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#5F5E5A' }}>
            {legend.map((l, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{
                  display: 'inline-block', width: 20, height: 2,
                  background: l.color,
                  borderTop: l.dashed ? `2px dashed ${l.color}` : 'none',
                  borderBottom: l.dashed ? 'none' : 'none',
                  opacity: l.dashed ? 0.7 : 1,
                }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

const KPI_GROUP_LABEL = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#8C8A85',
  textTransform: 'uppercase', marginBottom: 6,
};

// ── dual-line chart ───────────────────────────────────────────────────────────

function DualTooltip({ active, payload, valueFormatter }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;

  const shown = {};
  payload.forEach(p => {
    if (p.value == null) return;
    const key = p.dataKey.replace('Est', '').replace('Pct', 'Pct');
    const label = p.dataKey.startsWith('gross') ? 'Gross' : 'Net';
    const isEst = p.dataKey.endsWith('Est');
    if (!shown[label]) shown[label] = { value: p.value, color: p.color, estimated: isEst };
  });

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 6, padding: '6px 10px', fontSize: 11 }}>
      <div style={{ color: '#8C8A85', marginBottom: 3 }}>{d?.range || d?.label}</div>
      {Object.entries(shown).map(([name, { value, color, estimated }], i) => (
        <div key={i} style={{ color, fontWeight: 500, fontFamily: 'DM Mono, monospace' }}>
          {name}{estimated ? ' *' : ''}: {valueFormatter(value)}
        </div>
      ))}
      {Object.values(shown).some(s => s.estimated) && (
        <div style={{ color: '#C8BFB0', fontSize: 10, marginTop: 3 }}>* estimated cost</div>
      )}
    </div>
  );
}

function DualLineChart({ data, dollarKey, pctKey, height = 180, valueFormatter, isDollar = true }) {
  const grossKey = isDollar ? 'gross' : 'grossPct';
  const netKey   = isDollar ? 'net'   : 'netPct';
  const grossEstKey = isDollar ? 'grossEst' : 'grossPctEst';
  const netEstKey   = isDollar ? 'netEst'   : 'netPctEst';

  const hasEstimated = data.some(d => d[grossEstKey] != null || d[netEstKey] != null);
  const hasReal      = data.some(d => d[grossKey] != null || d[netKey] != null);

  const allNull = !hasEstimated && !hasReal;
  if (allNull) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px dashed #E0DDD6', borderRadius: 6, color: '#C8BFB0', fontSize: 12, background: '#FAFAF8' }}>
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: '#8C8A85' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: '#8C8A85' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={valueFormatter}
          width={48}
        />
        <Tooltip content={<DualTooltip valueFormatter={valueFormatter} />} />
        {/* Real data (solid) */}
        <Line type="monotone" dataKey={grossKey} stroke={GROSS_COLOR} strokeWidth={2}
          dot={{ r: 2, fill: GROSS_COLOR }} activeDot={{ r: 4 }} connectNulls={false} name="Gross" />
        <Line type="monotone" dataKey={netKey} stroke={NET_COLOR} strokeWidth={2}
          dot={{ r: 2, fill: NET_COLOR }} activeDot={{ r: 4 }} connectNulls={false} name="Net" />
        {/* Estimated data (dashed) */}
        {hasEstimated && (
          <>
            <Line type="monotone" dataKey={grossEstKey} stroke={GROSS_COLOR} strokeWidth={2}
              strokeDasharray="4 2"
              dot={{ r: 2, fill: 'none', stroke: GROSS_COLOR, strokeWidth: 1.5 }}
              activeDot={{ r: 4 }} connectNulls={false} name="Gross (est.)" />
            <Line type="monotone" dataKey={netEstKey} stroke={NET_COLOR} strokeWidth={2}
              strokeDasharray="4 2"
              dot={{ r: 2, fill: 'none', stroke: NET_COLOR, strokeWidth: 1.5 }}
              activeDot={{ r: 4 }} connectNulls={false} name="Net (est.)" />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── formatters ────────────────────────────────────────────────────────────────

const usd  = v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct  = v => v == null ? '—' : `${v}%`;
const fmtChartDollar = v => v == null ? '' : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
const fmtChartPct    = v => v == null ? '' : `${Math.round(v)}%`;

// ── table row styling ─────────────────────────────────────────────────────────

const TH = { fontSize: 10, fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 6, borderBottom: '1px solid #E0DDD6' };
const TD = { padding: '5px 0', borderBottom: '0.5px solid #F0EDE6', fontSize: 10 };

function NetPctCell({ value }) {
  const danger = value != null && value < 15;
  return (
    <td style={{
      ...TD, textAlign: 'right', fontFamily: 'DM Mono, monospace',
      color: danger ? '#A32D2D' : '#1A1A1A',
      background: danger ? 'rgba(163,45,45,0.06)' : 'transparent',
      paddingRight: 8,
    }}>
      {pct(value)}
    </td>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export function CollectivePage({ onBack }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    fetchCollectiveMarginData()
      .then(setResult)
      .catch(e => setError(e.message || 'Failed to load margin data'))
      .finally(() => setLoading(false));
  }, []);

  const snapshotLabel = result
    ? result.isLiveFallback
      ? `Live cost data (no snapshot on file yet — costs from today's Shopify catalog)`
      : `Cost data from snapshot ${result.snapshotDate}`
    : null;

  const hasEstimatedWeeks = result?.weeklyLaunch?.some(w => w.estimated);

  const weeklyLegend = hasEstimatedWeeks
    ? [
        { label: 'Gross', color: GROSS_COLOR },
        { label: 'Net', color: NET_COLOR },
        { label: 'Estimated', color: '#C8BFB0', dashed: true },
      ]
    : [
        { label: 'Gross', color: GROSS_COLOR },
        { label: 'Net', color: NET_COLOR },
      ];

  const dailyLegend = [
    { label: 'Gross', color: GROSS_COLOR },
    { label: 'Net', color: NET_COLOR },
  ];

  return (
    <PageShell
      title="Collective Unit Economics"
      subtitle="Contribution margin for the 6 Collective suppliers"
      onBack={onBack}
    >
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#8C8A85', fontSize: 13 }}>
          Loading cost data and order history…
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 14px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#A32D2D', marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {result && (
        <>
          {/* Snapshot info banner */}
          <div style={{ padding: '7px 12px', background: result.isLiveFallback ? '#FAEEDA' : '#F0EDE6', border: `0.5px solid ${result.isLiveFallback ? '#E8C97A' : '#E0DDD6'}`, borderRadius: 7, fontSize: 11, color: result.isLiveFallback ? '#854F0B' : '#5F5E5A', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{snapshotLabel}</span>
            {result.coveredRevenuePct < 95 && (
              <span style={{ color: '#854F0B', fontWeight: 600 }}>⚠ {result.coveredRevenuePct}% revenue covered — {100 - result.coveredRevenuePct}% has no cost match</span>
            )}
          </div>

          {/* ── Section 1: Rolling 7 Days KPIs ── */}
          <SectionLabel>Rolling 7 Days</SectionLabel>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'start', marginBottom: 12 }}>
            {/* Gross group */}
            <div>
              <div style={KPI_GROUP_LABEL}>Without discount (gross)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <KPICard
                  label="Revenue"
                  value={usd(result.kpi.revenueGross)}
                  change={null}
                  definition="Total Collective line-item revenue before any discount codes, for the rolling 7-day window. Includes all 6 Collective suppliers."
                />
                <KPICard
                  label="Margin $"
                  value={usd(result.kpi.marginDollarGross)}
                  change={null}
                  definition="Gross revenue minus COGS minus payment processing fees. Does not subtract discount amounts — this is margin if all orders were full-price."
                />
                <KPICard
                  label="Margin %"
                  value={pct(result.kpi.marginPctGross)}
                  change={null}
                  definition="Margin $ ÷ Revenue Gross × 100. Pre-discount margin percentage."
                />
              </div>
            </div>

            {/* Discount callout */}
            <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 16px', textAlign: 'center', minWidth: 130 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Discounts</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#1A1A1A', fontFamily: 'DM Mono, monospace' }}>{usd(result.kpi.discounts)}</div>
              {result.kpi.discountMarginImpact != null && (
                <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 3 }}>
                  −{result.kpi.discountMarginImpact} margin pts
                </div>
              )}
              <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 4 }}>gross → net impact</div>
            </div>

            {/* Net group */}
            <div>
              <div style={KPI_GROUP_LABEL}>With discount (net, actual)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <KPICard
                  label="Revenue"
                  value={usd(result.kpi.revenueNet)}
                  change={null}
                  definition="Collective line-item revenue after discount codes are applied. This is the actual cash collected from customers for Collective items."
                />
                <KPICard
                  label="Margin $"
                  value={usd(result.kpi.marginDollarNet)}
                  change={null}
                  definition="Net revenue minus COGS minus payment processing fees. This is actual contribution margin — what goes to Birch after paying suppliers and Stripe."
                />
                <KPICard
                  label="Margin %"
                  value={pct(result.kpi.marginPctNet)}
                  change={null}
                  definition="Margin $ ÷ Revenue Net × 100. Actual realised margin after discounts. Target: 20%+. Below 15% flagged red in by-brand table."
                />
              </div>
            </div>
          </div>

          {/* ── Section 2: Rolling 7-day daily charts ── */}
          <SectionLabel>Rolling 7 Days — Daily</SectionLabel>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <ChartCard title="Margin $ — daily (last 7 days)" legend={dailyLegend}>
              <DualLineChart
                data={result.daily7}
                isDollar={true}
                valueFormatter={fmtChartDollar}
                height={180}
              />
            </ChartCard>
            <ChartCard title="Margin % — daily (last 7 days)" legend={dailyLegend}>
              <DualLineChart
                data={result.daily7}
                isDollar={false}
                valueFormatter={fmtChartPct}
                height={180}
              />
            </ChartCard>
          </div>

          {/* ── Section 3: Since-launch weekly ── */}
          <SectionLabel>Since Launch — Weekly</SectionLabel>

          {hasEstimatedWeeks && (
            <div style={{ padding: '7px 12px', background: '#F0EDE6', border: '0.5px solid #E0DDD6', borderRadius: 7, fontSize: 11, color: '#5F5E5A', marginBottom: 10 }}>
              Dashed segments use estimated cost data (earliest available snapshot as proxy). Solid segments reflect real same-week cost snapshots.
              {result.firstSnapshotDate
                ? ` First real snapshot: ${result.firstSnapshotDate}.`
                : ' No real snapshots yet — all data uses live catalog costs.'}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <ChartCard title="Margin $ — weekly (since Jun 2026)" legend={weeklyLegend}>
              <DualLineChart
                data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))}
                isDollar={true}
                valueFormatter={fmtChartDollar}
                height={200}
              />
            </ChartCard>
            <ChartCard title="Margin % — weekly (since Jun 2026)" legend={weeklyLegend}>
              <DualLineChart
                data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))}
                isDollar={false}
                valueFormatter={fmtChartPct}
                height={200}
              />
            </ChartCard>
          </div>

          {/* ── Section 4: By-supplier table ── */}
          <SectionLabel>By Supplier</SectionLabel>

          <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Supplier', 'Orders', 'Margin $ Gross', 'Margin $ Net', 'Margin % Gross', 'Margin % Net'].map((h, i) => (
                      <th key={h} style={{ ...TH, textAlign: i === 0 ? 'left' : 'right', paddingRight: i !== 0 ? 8 : 0 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.byVendor.map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...TD, color: '#3D3226', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }} title={row.vendor}>
                        {row.vendor}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>
                        {row.orderCount || '—'}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>
                        {usd(row.marginDollarGross)}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>
                        {usd(row.marginDollarNet)}
                      </td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>
                        {pct(row.marginPctGross)}
                      </td>
                      <NetPctCell value={row.marginPctNet} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 6 }}>
              Since launch · Margin % Net below 15% highlighted red · Shipping = $0 · Processing fee = 2.25% + $0.30/order
            </div>
          </div>

          <div style={{ height: 40 }} />
        </>
      )}
    </PageShell>
  );
}
