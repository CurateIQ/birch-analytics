/**
 * UnitEconomicsPage.jsx
 * Tabs: Collective | NJ Warehouse | Manual Wholesale
 */

import React, { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { KPICard } from '../components/KPICard';
import { fetchCollectiveMarginData } from '../api/collectiveMargin';
import { fetchNJWarehouseMarginData } from '../api/njWarehouseMargin';
import {
  fetchManualWholesaleMarginData,
  parseSupplierDocument,
  saveManualWholesaleCosts,
} from '../api/manualWholesaleMargin';

const GROSS_COLOR = '#5A7A5C';
const NET_COLOR   = '#C8763A';

// ── shared layout sub-components ─────────────────────────────────────────────

function PageShell({ title, subtitle, onBack, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 14px' }}>
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

function TabBar({ tab, setTab }) {
  const tabs = [
    { id: 'collective',       label: 'Collective' },
    { id: 'nj_warehouse',     label: 'NJ Warehouse' },
    { id: 'manual_wholesale', label: 'Manual Wholesale' },
  ];
  return (
    <div style={{ display: 'flex', gap: 0, borderBottom: '1.5px solid #E0DDD6', marginBottom: 16 }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '7px 16px', fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
            color: tab === t.id ? '#3D3226' : '#8C8A85',
            borderBottom: tab === t.id ? '2.5px solid #3D3226' : '2.5px solid transparent',
            marginBottom: -1.5, fontFamily: 'DM Sans, sans-serif',
            transition: 'color 0.12s',
          }}
        >
          {t.label}
        </button>
      ))}
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

function ChartCard({ title, children, legend, footnote }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#3D3226' }}>{title}</div>
        {legend && (
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#5F5E5A' }}>
            {legend.map((l, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{
                  display: 'inline-block', width: 20, height: 2,
                  borderTop: l.dashed ? `2px dashed ${l.color}` : `2px solid ${l.color}`,
                  opacity: l.dashed ? 0.7 : 1,
                }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
      {footnote}
    </div>
  );
}

const KPI_GROUP_LABEL = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: '#8C8A85',
  textTransform: 'uppercase', marginBottom: 6,
};

// ── COGS exclusion footnote — shown on every KPI/chart section when count > 0 ─

function ExclusionNote({ count, gmv }) {
  if (!count) return null;
  const usd = v => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return (
    <div style={{
      padding: '8px 12px', background: '#FEF3E2',
      border: '1px solid #F5A623', borderRadius: 7,
      fontSize: 12, color: '#7A4A00', marginBottom: 14,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <span>
        <strong>{count} order{count !== 1 ? 's' : ''} with {usd(gmv)} GMV excluded</strong> — COGS not available.
        These orders are not included in any revenue or margin figure above.
        Upload cost data to include them.
      </span>
    </div>
  );
}

// ── dual-line chart ───────────────────────────────────────────────────────────

function DualTooltip({ active, payload, valueFormatter }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const shown = {};
  payload.forEach(p => {
    if (p.value == null) return;
    const label  = p.dataKey.toLowerCase().startsWith('gross') ? 'Gross' : 'Net';
    const isEst  = p.dataKey.endsWith('Est') || p.dataKey.endsWith('PctEst');
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

function DualLineChart({ data, isDollar = true, valueFormatter, height = 180 }) {
  const grossKey    = isDollar ? 'gross'    : 'grossPct';
  const netKey      = isDollar ? 'net'      : 'netPct';
  const grossEstKey = isDollar ? 'grossEst' : 'grossPctEst';
  const netEstKey   = isDollar ? 'netEst'   : 'netPctEst';

  const hasReal      = data.some(d => d[grossKey] != null || d[netKey] != null);
  const hasEstimated = data.some(d => d[grossEstKey] != null || d[netEstKey] != null);

  if (!hasReal && !hasEstimated) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px dashed #E0DDD6', borderRadius: 6, color: '#C8BFB0', fontSize: 12, background: '#FAFAF8' }}>
        No data yet
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#8C8A85' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#8C8A85' }} axisLine={false} tickLine={false} tickFormatter={valueFormatter} width={48} />
        <Tooltip content={<DualTooltip valueFormatter={valueFormatter} />} />
        <Line type="monotone" dataKey={grossKey} stroke={GROSS_COLOR} strokeWidth={2} dot={{ r: 2, fill: GROSS_COLOR }} activeDot={{ r: 4 }} connectNulls={false} name="Gross" />
        <Line type="monotone" dataKey={netKey}   stroke={NET_COLOR}   strokeWidth={2} dot={{ r: 2, fill: NET_COLOR }}   activeDot={{ r: 4 }} connectNulls={false} name="Net" />
        {hasEstimated && (
          <>
            <Line type="monotone" dataKey={grossEstKey} stroke={GROSS_COLOR} strokeWidth={2} strokeDasharray="4 2" dot={{ r: 2, fill: 'none', stroke: GROSS_COLOR, strokeWidth: 1.5 }} activeDot={{ r: 4 }} connectNulls={false} name="Gross (est.)" />
            <Line type="monotone" dataKey={netEstKey}   stroke={NET_COLOR}   strokeWidth={2} strokeDasharray="4 2" dot={{ r: 2, fill: 'none', stroke: NET_COLOR,   strokeWidth: 1.5 }} activeDot={{ r: 4 }} connectNulls={false} name="Net (est.)" />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── formatters ────────────────────────────────────────────────────────────────

const usd            = v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct            = v => v == null ? '—' : `${v}%`;
const fmtChartDollar = v => v == null ? '' : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`;
const fmtChartPct    = v => v == null ? '' : `${Math.round(v)}%`;

// ── table styles ──────────────────────────────────────────────────────────────

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

// ── data-quality banners ──────────────────────────────────────────────────────

function SnapshotBanner({ result }) {
  if (!result) return null;
  const amber = result.isLiveFallback;
  const snapshotLabel = result.isLiveFallback
    ? 'Live cost data (no snapshot on file yet — costs from today\'s Shopify catalog)'
    : `Cost data from snapshot ${result.snapshotDate}`;
  return (
    <div style={{ padding: '7px 12px', background: amber ? '#FAEEDA' : '#F0EDE6', border: `0.5px solid ${amber ? '#E8C97A' : '#E0DDD6'}`, borderRadius: 7, fontSize: 11, color: amber ? '#854F0B' : '#5F5E5A', marginBottom: 14 }}>
      {snapshotLabel}
    </div>
  );
}

function CoverageMeter({ label, pct: value, color = '#5A7A5C' }) {
  const danger = value < 80;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: danger ? '#854F0B' : '#5F5E5A' }}>
      <span style={{ minWidth: 160 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: '#F0EDE6', borderRadius: 99, maxWidth: 120, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(value, 100)}%`, background: danger ? '#C8763A' : color, borderRadius: 99 }} />
      </div>
      <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 600, minWidth: 36 }}>{value}%</span>
    </div>
  );
}

// ── KPI layout (shared 3-column: gross | discount | net) ─────────────────────

function KPIRow({ result }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'start', marginBottom: 12 }}>
      <div>
        <div style={KPI_GROUP_LABEL}>Without discount (gross)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <KPICard label="Revenue"  value={usd(result.kpi.revenueGross)}     change={null} definition="Total revenue before discount codes." />
          <KPICard label="Margin $" value={usd(result.kpi.marginDollarGross)} change={null} definition="Revenue minus COGS minus all fees, pre-discount." />
          <KPICard label="Margin %" value={pct(result.kpi.marginPctGross)}   change={null} definition="Pre-discount margin %." />
        </div>
      </div>
      <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 16px', textAlign: 'center', minWidth: 130 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Discounts</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1A1A1A', fontFamily: 'DM Mono, monospace' }}>{usd(result.kpi.discounts)}</div>
        {result.kpi.discountMarginImpact != null && (
          <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 3 }}>−{result.kpi.discountMarginImpact} margin pts</div>
        )}
        <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 4 }}>gross → net impact</div>
      </div>
      <div>
        <div style={KPI_GROUP_LABEL}>With discount (net, actual)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <KPICard label="Revenue"  value={usd(result.kpi.revenueNet)}     change={null} definition="Revenue after discount codes applied." />
          <KPICard label="Margin $" value={usd(result.kpi.marginDollarNet)} change={null} definition="Actual contribution margin after all costs." />
          <KPICard label="Margin %" value={pct(result.kpi.marginPctNet)}   change={null} definition="Actual realised margin %. Below 15% flagged red." />
        </div>
      </div>
    </div>
  );
}

// ── reconciliation control ────────────────────────────────────────────────────

function ReconciliationLine({ included, excluded, stream, shopify, note }) {
  return (
    <div style={{ fontSize: 10, color: '#8C8A85', marginTop: 6, fontFamily: 'DM Mono, monospace' }}>
      In numbers: {included} orders
      {excluded > 0 ? ` · Excluded (no COGS): ${excluded}` : ''}
      {` · Stream total: ${stream} · Shopify all streams: ${shopify}`}
      {note ? <span style={{ fontFamily: 'DM Sans, sans-serif', color: '#B0ADA8' }}> — {note}</span> : null}
    </div>
  );
}

// ── Collective section ────────────────────────────────────────────────────────

function CollectiveSection() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    fetchCollectiveMarginData()
      .then(setResult)
      .catch(e => setError(e.message || 'Failed to load Collective margin data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#8C8A85', fontSize: 13 }}>Loading cost data and order history…</div>;
  if (error)   return <div style={{ padding: '12px 14px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#A32D2D' }}>⚠ {error}</div>;
  if (!result) return null;

  const hasEstimatedWeeks = result.weeklyLaunch?.some(w => w.estimated);
  const weeklyLegend = [
    { label: 'Gross', color: GROSS_COLOR },
    { label: 'Net',   color: NET_COLOR },
    ...(hasEstimatedWeeks ? [{ label: 'Estimated', color: '#C8BFB0', dashed: true }] : []),
  ];
  const dailyLegend = [{ label: 'Gross', color: GROSS_COLOR }, { label: 'Net', color: NET_COLOR }];

  const exclusionNote = <ExclusionNote count={result.excludedCount} gmv={result.excludedGMV} />;

  return (
    <>
      <SnapshotBanner result={result} />
      {exclusionNote}

      <SectionLabel>Rolling 7 Days</SectionLabel>
      <KPIRow result={result} />

      <SectionLabel>Rolling 7 Days — Daily</SectionLabel>
      <div style={{ display: 'grid', gap: 12 }}>
        <ChartCard title="Margin $ — daily (last 7 days)" legend={dailyLegend} footnote={exclusionNote}>
          <DualLineChart data={result.daily7} isDollar={true}  valueFormatter={fmtChartDollar} />
        </ChartCard>
        <ChartCard title="Margin % — daily (last 7 days)" legend={dailyLegend}>
          <DualLineChart data={result.daily7} isDollar={false} valueFormatter={fmtChartPct} />
        </ChartCard>
      </div>

      <SectionLabel>Since Launch — Weekly</SectionLabel>
      {hasEstimatedWeeks && (
        <div style={{ padding: '7px 12px', background: '#F0EDE6', border: '0.5px solid #E0DDD6', borderRadius: 7, fontSize: 11, color: '#5F5E5A', marginBottom: 10 }}>
          Dashed segments use estimated cost data (earliest available snapshot as proxy). Solid segments reflect real same-week cost snapshots.
          {result.firstSnapshotDate ? ` First real snapshot: ${result.firstSnapshotDate}.` : ' No real snapshots yet.'}
        </div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        <ChartCard title="Margin $ — weekly (since Jun 2026)" legend={weeklyLegend} footnote={exclusionNote}>
          <DualLineChart data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))} isDollar={true}  valueFormatter={fmtChartDollar} height={200} />
        </ChartCard>
        <ChartCard title="Margin % — weekly (since Jun 2026)" legend={weeklyLegend}>
          <DualLineChart data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))} isDollar={false} valueFormatter={fmtChartPct} height={200} />
        </ChartCard>
      </div>

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
                  <td style={{ ...TD, color: '#3D3226', fontWeight: 500, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }} title={row.vendor}>{row.vendor}</td>
                  <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{row.orderCount || '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{usd(row.marginDollarGross)}</td>
                  <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{usd(row.marginDollarNet)}</td>
                  <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{pct(row.marginPctGross)}</td>
                  <NetPctCell value={row.marginPctNet} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 6 }}>
          Since launch · Margin % Net below 15% highlighted red · Shipping = $0 · Processing fee = 2.25% + $0.30/order · Orders with missing COGS excluded
        </div>
        <ReconciliationLine
          included={result.byVendor.reduce((s, r) => s + (r.orderCount || 0), 0)}
          excluded={result.excludedCount}
          stream={result.streamOrderCount}
          shopify={result.shopifyOrderCount}
          note="stream = Collective vendor/fulfillment_service match, non-cancelled"
        />
      </div>
      <div style={{ height: 40 }} />
    </>
  );
}

// ── NJ Warehouse section ──────────────────────────────────────────────────────

function NJWarehouseSection() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    fetchNJWarehouseMarginData()
      .then(setResult)
      .catch(e => setError(e.message || 'Failed to load NJ Warehouse margin data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#8C8A85', fontSize: 13 }}>Loading NJ Warehouse costs, orders, and Veeqo shipping data…</div>;
  if (error)   return <div style={{ padding: '12px 14px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#A32D2D' }}>⚠ {error}</div>;
  if (!result) return null;

  const hasEstimatedWeeks = result.weeklyLaunch?.some(w => w.estimated);
  const weeklyLegend = [
    { label: 'Gross', color: GROSS_COLOR },
    { label: 'Net',   color: NET_COLOR },
    ...(hasEstimatedWeeks ? [{ label: 'Estimated', color: '#C8BFB0', dashed: true }] : []),
  ];
  const dailyLegend = [{ label: 'Gross', color: GROSS_COLOR }, { label: 'Net', color: NET_COLOR }];
  const exclusionNote = <ExclusionNote count={result.excludedCount} gmv={result.excludedGMV} />;

  return (
    <>
      <SnapshotBanner result={result} />
      {exclusionNote}

      <div style={{ background: '#F8F6F0', border: '0.5px solid #E0DDD6', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Data Completeness</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <CoverageMeter label="COGS coverage (revenue with known cost)" pct={result.coveredRevenuePct} />
          <CoverageMeter label="Shipping coverage (orders with Veeqo data)" pct={result.shippingCoveredPct} color="#378ADD" />
        </div>
        {result.isVeeqoFallback && (
          <div style={{ fontSize: 10, color: '#854F0B', marginTop: 6 }}>⚠ Veeqo returned no orders — using fulfillment_service to identify NJ Warehouse orders (JIT orders may be included)</div>
        )}
        {result.isVeeqoPartial && (
          <div style={{ fontSize: 10, color: '#854F0B', marginTop: 6 }}>⚠ Shipping data incomplete — Veeqo fetch failed mid-pagination. Margin may be overstated for orders in the missing pages.</div>
        )}
        {result.coveredRevenuePct < 80 && (
          <div style={{ fontSize: 10, color: '#854F0B', marginTop: 4 }}>⚠ Low COGS coverage — populate unit costs in Shopify admin to improve margin accuracy</div>
        )}
        <ReconciliationLine
          included={result.kpi.orderCount ?? 0}
          excluded={result.excludedCount}
          stream={result.streamOrderCount}
          shopify={result.shopifyOrderCount}
          note="stream = Veeqo NJ Warehouse allocation (or manual fallback), non-cancelled, Babybay/Naturepedic excluded"
        />
      </div>

      <SectionLabel>Rolling 7 Days</SectionLabel>
      <KPIRow result={result} />

      <SectionLabel>Rolling 7 Days — Daily</SectionLabel>
      <div style={{ display: 'grid', gap: 12 }}>
        <ChartCard title="Margin $ — daily (last 7 days)" legend={dailyLegend} footnote={exclusionNote}>
          <DualLineChart data={result.daily7} isDollar={true}  valueFormatter={fmtChartDollar} />
        </ChartCard>
        <ChartCard title="Margin % — daily (last 7 days)" legend={dailyLegend}>
          <DualLineChart data={result.daily7} isDollar={false} valueFormatter={fmtChartPct} />
        </ChartCard>
      </div>

      <SectionLabel>Since Launch — Weekly</SectionLabel>
      {hasEstimatedWeeks && (
        <div style={{ padding: '7px 12px', background: '#F0EDE6', border: '0.5px solid #E0DDD6', borderRadius: 7, fontSize: 11, color: '#5F5E5A', marginBottom: 10 }}>
          Dashed segments use estimated cost data. Solid segments reflect real same-week cost snapshots.
          {result.firstSnapshotDate ? ` First real snapshot: ${result.firstSnapshotDate}.` : ' No real snapshots yet.'}
        </div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        <ChartCard title="Margin $ — weekly (since Jun 2026)" legend={weeklyLegend} footnote={exclusionNote}>
          <DualLineChart data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))} isDollar={true}  valueFormatter={fmtChartDollar} height={200} />
        </ChartCard>
        <ChartCard title="Margin % — weekly (since Jun 2026)" legend={weeklyLegend}>
          <DualLineChart data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))} isDollar={false} valueFormatter={fmtChartPct} height={200} />
        </ChartCard>
      </div>

      {result.byCategory?.length > 0 && (
        <>
          <SectionLabel>By Product Category</SectionLabel>
          <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    {['Category', 'Margin $ Gross', 'Margin $ Net', 'Margin % Gross', 'Margin % Net'].map((h, i) => (
                      <th key={h} style={{ ...TH, textAlign: i === 0 ? 'left' : 'right', paddingRight: i !== 0 ? 8 : 0 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.byCategory.map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...TD, color: '#3D3226', fontWeight: 500, paddingRight: 8 }}>{row.category}</td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{usd(row.marginDollarGross)}</td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{usd(row.marginDollarNet)}</td>
                      <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{pct(row.marginPctGross)}</td>
                      <NetPctCell value={row.marginPctNet} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 6 }}>
              Since launch · Margin % Net below 15% highlighted red · Processing 2.25% + $0.30/order · Handling $2.00 + $0.35/additional unit · Shipping from Veeqo · Orders with missing COGS excluded
            </div>
          </div>
        </>
      )}
      <div style={{ height: 40 }} />
    </>
  );
}

// ── Manual Wholesale — file upload component ──────────────────────────────────

function UploadBox({ vendor, label, accept, hint, onParsed, disabled }) {
  const [status, setStatus]   = useState('idle'); // idle | parsing | done | error
  const [message, setMessage] = useState('');
  const inputRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    setStatus('parsing');
    setMessage('');
    try {
      let result;
      if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
        // CSV: read as text, send as text/plain
        const text = await file.text();
        const b64  = btoa(unescape(encodeURIComponent(text)));
        result = await parseSupplierDocument(vendor, b64, 'text/plain');
      } else {
        // PDF: read as ArrayBuffer → base64
        const buf  = await file.arrayBuffer();
        const b64  = btoa(String.fromCharCode(...new Uint8Array(buf)));
        result = await parseSupplierDocument(vendor, b64, 'application/pdf');
      }
      setStatus('done');
      onParsed(result);
    } catch (e) {
      setStatus('error');
      setMessage(e.message || 'Parse failed');
    }
  }

  return (
    <div style={{ border: '1.5px dashed #D0CCC4', borderRadius: 10, padding: '16px 18px', background: '#FAFAF8' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#3D3226', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#8C8A85', marginBottom: 12 }}>{hint}</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files[0])}
        disabled={disabled}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={disabled || status === 'parsing'}
        style={{
          background: '#3D3226', color: '#FFF', border: 'none', borderRadius: 7,
          padding: '7px 14px', fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1, fontFamily: 'DM Sans, sans-serif',
        }}
      >
        {status === 'parsing' ? 'Parsing…' : 'Choose file'}
      </button>
      {status === 'error' && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#A32D2D' }}>⚠ {message}</div>
      )}
    </div>
  );
}

function ParsedPreview({ vendor, parsed, onConfirm, onDiscard, saving }) {
  if (!parsed) return null;

  const rows = vendor === 'babybay'
    ? (parsed.rows || [])
    : parsed.orderId ? [{ orderId: parsed.orderId, cost: parsed.cost, orderDate: '' }] : [];

  const usdFmt = v => `$${Number(v).toFixed(2)}`;

  return (
    <div style={{ marginTop: 14, background: '#F0EDE6', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3D3226', marginBottom: 8 }}>
        Parsed {rows.length} order{rows.length !== 1 ? 's' : ''} — review before saving
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: 'left' }}>Order #</th>
              {vendor === 'babybay' && <th style={{ ...TH, textAlign: 'left' }}>Date</th>}
              <th style={{ ...TH, textAlign: 'right', paddingRight: 8 }}>
                {vendor === 'babybay' ? 'Net Payout' : 'Total Cost'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...TD }}>{r.orderId}</td>
                {vendor === 'babybay' && <td style={{ ...TD }}>{r.orderDate || '—'}</td>}
                <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{usdFmt(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={() => onConfirm(rows)}
          disabled={saving}
          style={{ background: '#3D3226', color: '#FFF', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'DM Sans, sans-serif' }}
        >
          {saving ? 'Saving…' : `Save ${rows.length} record${rows.length !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={onDiscard}
          style={{ background: '#F0EDE6', border: '0.5px solid #D0CCC4', borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function UploadSection({ vendor, label, hint, accept }) {
  const [parsed, setParsed]   = useState(null);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(null); // { count }
  const [saveError, setSaveError] = useState('');

  async function handleConfirm(rows) {
    setSaving(true);
    setSaveError('');
    try {
      const costRows = rows.map(r => ({
        orderId:  String(r.orderId),
        cost:     parseFloat(r.cost),
        vendor,
        source:   vendor === 'babybay' ? 'babybay_weekly_invoice' : 'naturepedic_po_upload',
        date:     r.orderDate || new Date().toISOString().slice(0, 10),
      }));
      await saveManualWholesaleCosts(costRows);
      setSaved({ count: costRows.length });
      setParsed(null);
    } catch (e) {
      setSaveError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <UploadBox
        vendor={vendor}
        label={label}
        accept={accept}
        hint={hint}
        onParsed={setParsed}
        disabled={saving}
      />
      <ParsedPreview
        vendor={vendor}
        parsed={parsed}
        onConfirm={handleConfirm}
        onDiscard={() => setParsed(null)}
        saving={saving}
      />
      {saved && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#3D6B40' }}>
          ✓ Saved {saved.count} cost record{saved.count !== 1 ? 's' : ''}. Reload the page to see updated margins.
        </div>
      )}
      {saveError && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#A32D2D' }}>⚠ {saveError}</div>
      )}
    </div>
  );
}

// ── Manual Wholesale section ──────────────────────────────────────────────────

function ManualWholesaleSection() {
  const [result, setResult]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    fetchManualWholesaleMarginData()
      .then(setResult)
      .catch(e => setError(e.message || 'Failed to load Manual Wholesale data'))
      .finally(() => setLoading(false));
  }, []);

  const dailyLegend   = [{ label: 'Gross', color: GROSS_COLOR }, { label: 'Net', color: NET_COLOR }];
  const weeklyLegend  = dailyLegend;

  return (
    <>
      {/* Persistent arrangement banner */}
      <div style={{
        padding: '10px 14px', background: '#EEF3FD',
        border: '1px solid #B8CCF0', borderRadius: 8,
        fontSize: 12, color: '#2C4A7A', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>ℹ</span>
        <span>
          <strong>Manual Wholesale</strong> — Babybay and Naturepedic, temporary arrangement (~2–3 months).
          Cost data entered via manual invoice/PO upload rather than API integration.
        </span>
      </div>

      {/* Upload controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#8C8A85' }}>
          {result ? `${result.uploadedCostCount} cost records on file` : ''}
        </div>
        <button
          onClick={() => setShowUpload(v => !v)}
          style={{ background: '#F0EDE6', border: '0.5px solid #D0CCC4', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
        >
          {showUpload ? '▲ Hide upload' : '▼ Upload invoices'}
        </button>
      </div>

      {showUpload && (
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '16px 16px', marginBottom: 16 }}>
          <SectionLabel>Upload Cost Data</SectionLabel>
          <UploadSection
            vendor="babybay"
            label="BabyBay — Weekly Settlement Invoice"
            hint="PDF or CSV · Columns: Order Date, Order ID, Promo Eligible, MSRP, Birch Margin, Promo Margin, Net Payout. Cost stored = Net Payout."
            accept=".pdf,.csv,.txt"
          />
          <UploadSection
            vendor="naturepedic"
            label="Naturepedic — Per-Order PO / Order Confirmation"
            hint="PDF · Extracts PO # (= Shopify order number) and Total (what Birch owes, including shipping + tax)."
            accept=".pdf"
          />
        </div>
      )}

      {loading && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#8C8A85', fontSize: 13 }}>Loading Manual Wholesale orders and cost data…</div>}
      {error   && <div style={{ padding: '12px 14px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#A32D2D' }}>⚠ {error}</div>}

      {result && (
        <>
          <ExclusionNote count={result.excludedCount} gmv={result.excludedGMV} />

          <SectionLabel>Rolling 7 Days</SectionLabel>
          <KPIRow result={result} />

          <SectionLabel>Rolling 7 Days — Daily</SectionLabel>
          <div style={{ display: 'grid', gap: 12 }}>
            <ChartCard title="Margin $ — daily (last 7 days)" legend={dailyLegend}>
              <DualLineChart data={result.daily7} isDollar={true}  valueFormatter={fmtChartDollar} />
            </ChartCard>
            <ChartCard title="Margin % — daily (last 7 days)" legend={dailyLegend}>
              <DualLineChart data={result.daily7} isDollar={false} valueFormatter={fmtChartPct} />
            </ChartCard>
          </div>

          <SectionLabel>Since Launch — Weekly</SectionLabel>
          <div style={{ display: 'grid', gap: 12 }}>
            <ChartCard title="Margin $ — weekly (since Jun 2026)" legend={weeklyLegend}>
              <DualLineChart data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))} isDollar={true}  valueFormatter={fmtChartDollar} height={200} />
            </ChartCard>
            <ChartCard title="Margin % — weekly (since Jun 2026)" legend={weeklyLegend}>
              <DualLineChart data={result.weeklyLaunch.map(w => ({ ...w, label: w.weekLabel, range: w.weekRange }))} isDollar={false} valueFormatter={fmtChartPct} height={200} />
            </ChartCard>
          </div>

          {result.byVendor?.length > 0 && (
            <>
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
                          <td style={{ ...TD, color: '#3D3226', fontWeight: 500, paddingRight: 8 }}>{row.vendor}</td>
                          <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{row.orderCount || '—'}</td>
                          <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{usd(row.marginDollarGross)}</td>
                          <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{usd(row.marginDollarNet)}</td>
                          <td style={{ ...TD, textAlign: 'right', paddingRight: 8, fontFamily: 'DM Mono, monospace' }}>{pct(row.marginPctGross)}</td>
                          <NetPctCell value={row.marginPctNet} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 6 }}>
                  Since launch · Margin % Net below 15% highlighted red · Cost = uploaded invoice/PO amount (shipping bundled) · Processing fee = 2.25% + $0.30/order
                </div>
                <ReconciliationLine
                  included={result.byVendor.reduce((s, r) => s + (r.orderCount || 0), 0)}
                  excluded={result.excludedCount}
                  stream={result.streamOrderCount}
                  shopify={result.shopifyOrderCount}
                  note="excluded = orders with no uploaded cost yet"
                />
              </div>
            </>
          )}
        </>
      )}
      <div style={{ height: 40 }} />
    </>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export function UnitEconomicsPage({ onBack }) {
  const [tab, setTab] = useState('collective');

  return (
    <PageShell
      title="Revenue & Unit Economics"
      subtitle="Contribution margin by fulfillment stream"
      onBack={onBack}
    >
      <TabBar tab={tab} setTab={setTab} />
      {tab === 'collective'       && <CollectiveSection />}
      {tab === 'nj_warehouse'     && <NJWarehouseSection />}
      {tab === 'manual_wholesale' && <ManualWholesaleSection />}
    </PageShell>
  );
}
