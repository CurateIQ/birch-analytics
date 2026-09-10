/**
 * CampaignsPage.jsx
 * Marketing / Campaigns — Meta Ads + Google Ads
 *
 * Data source: manual CSV uploads stored in Lambda → S3.
 * Meta:   daily rows → rolling 7D / 30D
 * Google: weekly rows → last complete week / last 4 weeks (Task B)
 *
 * Live API connections (Meta Marketing API, Google Ads API) were blocked by
 * platform permission gates. This page uses manual CSV uploads as a workaround
 * while keeping the existing attribution (CAC) logic and CampaignDrillDown
 * unchanged — re-enabling live API is a small swap in campaignData.js.
 */

import React, { useState, useEffect, useRef } from 'react';
import { KPICard } from '../components/KPICard';
import { fetchCampaignPageData, uploadCampaignData } from '../api/campaignData';
import { parseMetaCsv, parseGoogleCsv } from '../utils/parseCampaignCsv';
import { fetchCampaignFunnel } from '../api/ga4';

const fmt = {
  usd:    v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
  usdDec: v => v == null ? '—' : `$${Number(v).toFixed(2)}`,
  num:    v => v == null ? '—' : Number(v).toLocaleString(),
};

const DEFS = {
  cpc:    'Cost per click from the platform\'s own data. A delivery metric — no attribution ambiguity.',
  cpm:    'Cost per 1,000 impressions from the platform\'s own data.',
  cac:       'Ad spend ÷ new customers attributed via last non-direct click (Shopify order data), not the platform\'s self-reported conversions. New customer = first-ever Shopify order.',
  cacGoogle: 'Google\'s own reported conversions ÷ spend. NOT the same last-non-direct-click methodology used for Meta\'s CAC — Google Ads traffic uses auto-tagging (gclid), not UTM parameters, so Shopify cannot attribute it to specific campaigns. This number may include repeat customers and uses Google\'s own attribution window, not ours. Treat as directional only.',
  google:    'Google Ads data is uploaded weekly (Monday–Sunday), so this reflects the most recent complete week(s) rather than a rolling window like Meta\'s.',
};

// ── layout sub-components ─────────────────────────────────────────────────────

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

function PanelCard({ title, badge, badgeColor, uploadBadge, children }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#3D3226' }}>{title}</span>
        {badge && (
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 99, fontWeight: 600, background: badgeColor === 'green' ? 'rgba(122,158,126,0.3)' : '#F0EDE6', color: badgeColor === 'green' ? '#3D4E3E' : '#8C8A85' }}>
            {badge}
          </span>
        )}
        {uploadBadge && (
          <span style={{ fontSize: 9, color: '#8C8A85', marginLeft: 'auto', fontFamily: 'DM Mono, monospace' }}>{uploadBadge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

const TBL_HEAD = { fontSize: 10, fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 6, borderBottom: '1px solid #E0DDD6', whiteSpace: 'nowrap' };
const TBL_CELL = { padding: '6px 0', borderBottom: '0.5px solid #F0EDE6', verticalAlign: 'top' };

// ── GA4 funnel drill-down (unchanged logic) ───────────────────────────────────

const FUNNEL_STAGES = [
  { key: 'landing',  label: 'Landing' },
  { key: 'pdp',       label: 'Product page' },
  { key: 'cart',      label: 'Add to cart' },
  { key: 'checkout',  label: 'Checkout started' },
  { key: 'purchase',  label: 'Purchase (new customers)' },
];

function CampaignDrillDown({ campaign, ga4Connected, dateStart, dateEnd, onClose }) {
  const [funnel, setFunnel] = useState(null);
  const [loading, setLoading] = useState(ga4Connected);
  const [drillError, setDrillError] = useState(null);

  React.useEffect(() => {
    if (!ga4Connected) return;
    let cancelled = false;
    setLoading(true);
    fetchCampaignFunnel(campaign.campaignName, dateStart, dateEnd)
      .then(res => { if (!cancelled) setFunnel(res); })
      .catch(e => { if (!cancelled) setDrillError(e.message || 'Failed to load funnel'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign.campaignName, ga4Connected, dateStart, dateEnd]);

  const stages = FUNNEL_STAGES.map(s => ({
    ...s,
    value: s.key === 'purchase' ? (campaign.newCustomerCount || 0) : (funnel?.[s.key] ?? null),
  }));
  const max = Math.max(...stages.map(s => s.value || 0), 1);

  return (
    <div style={{ background: '#F4F2EC', border: '0.5px solid #E0DDD6', borderRadius: 8, padding: '12px 14px', marginTop: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#3D3226' }}>{campaign.campaignName} — funnel</span>
        <span onClick={onClose} style={{ cursor: 'pointer', color: '#8C8A85', fontSize: 15 }}>×</span>
      </div>
      {!ga4Connected && <div style={{ fontSize: 11, color: '#854F0B', marginBottom: 8 }}>⏳ Pre-purchase stages await GA4 connection.</div>}
      {drillError && <div style={{ fontSize: 11, color: '#A32D2D', marginBottom: 8 }}>⚠ {drillError}</div>}
      {loading && <div style={{ fontSize: 11, color: '#8C8A85', marginBottom: 8 }}>Loading GA4 funnel…</div>}
      {stages.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < stages.length - 1 ? '0.5px solid #E0DDD6' : 'none' }}>
          <span style={{ fontSize: 11, color: '#1A1A1A', width: 150, flexShrink: 0 }}>{s.label}</span>
          <div style={{ flex: 1, height: 6, background: '#FFFFFF', borderRadius: 99 }}>
            <div style={{ height: 6, borderRadius: 99, background: s.key === 'purchase' ? '#5A7A5C' : '#378ADD', width: `${s.value != null ? (s.value / max) * 100 : 0}%` }} />
          </div>
          <span style={{ fontSize: 11, color: '#5F5E5A', minWidth: 50, textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
            {s.value != null ? s.value.toLocaleString() : '—'}
          </span>
        </div>
      ))}
      <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 8 }}>
        Landing → checkout filtered by GA4 sessionCampaignName. Purchase = new customers via last non-direct click (Shopify).
      </div>
    </div>
  );
}

function CampaignTable({ title, campaigns, ga4Connected, dateStart, dateEnd, showCac = true, footnote }) {
  const [drillCampaign, setDrillCampaign] = useState(null);

  if (!campaigns?.length) {
    return (
      <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#3D3226', marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#8C8A85' }}>No campaign data for this period</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#3D3226', marginBottom: 10 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'auto' }}>
          <thead>
            <tr>
              {['Campaign', 'Spend', 'CPC', 'CPM', ...(showCac ? ['CAC'] : [])].map(h => (
                <th key={h} style={{ ...TBL_HEAD, textAlign: h === 'Campaign' ? 'left' : 'right', paddingRight: h !== 'Campaign' ? 10 : 0 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => (
              <React.Fragment key={c.campaignId || i}>
                <tr
                  onDoubleClick={() => setDrillCampaign(drillCampaign?.campaignId === c.campaignId ? null : c)}
                  style={{ cursor: showCac ? 'pointer' : 'default' }}
                  title={showCac ? 'Double-click for funnel breakdown' : undefined}
                >
                  <td style={{ ...TBL_CELL, color: '#3D3226', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaignName}</td>
                  <td style={{ ...TBL_CELL, textAlign: 'right', paddingRight: 10, fontFamily: 'DM Mono, monospace' }}>{fmt.usd(c.spend)}</td>
                  <td style={{ ...TBL_CELL, textAlign: 'right', paddingRight: 10, fontFamily: 'DM Mono, monospace' }}>{fmt.usdDec(c.cpc)}</td>
                  <td style={{ ...TBL_CELL, textAlign: 'right', paddingRight: 10, fontFamily: 'DM Mono, monospace' }}>{fmt.usdDec(c.cpm)}</td>
                  {showCac && (
                    <td style={{ ...TBL_CELL, textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                      {c.cac != null ? fmt.usdDec(c.cac) : <span style={{ color: '#C8BFB0' }}>—</span>}
                    </td>
                  )}
                </tr>
                {drillCampaign?.campaignId === c.campaignId && (
                  <tr>
                    <td colSpan={showCac ? 5 : 4} style={{ padding: 0, border: 'none' }}>
                      <CampaignDrillDown campaign={c} ga4Connected={ga4Connected} dateStart={dateStart} dateEnd={dateEnd} onClose={() => setDrillCampaign(null)} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {footnote && <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 6 }}>{footnote}</div>}
      {showCac && <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 2 }}>Double-click a row for the campaign funnel breakdown</div>}
    </div>
  );
}

// ── Upload controls ───────────────────────────────────────────────────────────

function CsvUploadBox({ platform, label, hint, onUploaded }) {
  const [status, setStatus] = useState('idle'); // idle | parsing | saving | done | error
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null); // { parsed, skipped }
  const inputRef = useRef();

  async function handleFile(file) {
    if (!file) return;
    setStatus('parsing');
    setMessage('');
    setPreview(null);
    try {
      const text = await file.text();
      const result = platform === 'meta' ? parseMetaCsv(text) : parseGoogleCsv(text);
      setPreview(result);
      setStatus('parsed');
    } catch (e) {
      setStatus('error');
      setMessage(e.message || 'Parse failed');
    }
  }

  async function handleSave() {
    if (!preview?.rows?.length) return;
    setStatus('saving');
    try {
      const saved = await uploadCampaignData(platform, preview.rows);
      setStatus('done');
      setMessage(`Saved ${saved.saved} rows.`);
      setPreview(null);
      onUploaded?.();
    } catch (e) {
      setStatus('error');
      setMessage(e.message || 'Save failed');
    }
  }

  return (
    <div style={{ border: '1.5px dashed #D0CCC4', borderRadius: 10, padding: '14px 16px', background: '#FAFAF8', marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#3D3226', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#8C8A85', marginBottom: 10 }}>{hint}</div>
      <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      <button
        onClick={() => { inputRef.current?.click(); }}
        disabled={status === 'parsing' || status === 'saving'}
        style={{ background: '#3D3226', color: '#FFF', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif', opacity: (status === 'parsing' || status === 'saving') ? 0.5 : 1 }}
      >
        {status === 'parsing' ? 'Parsing…' : status === 'saving' ? 'Saving…' : 'Choose CSV'}
      </button>

      {status === 'parsed' && preview && (
        <div style={{ marginTop: 10, background: '#F0EDE6', borderRadius: 7, padding: '10px 12px', fontSize: 11 }}>
          <div style={{ fontWeight: 600, color: '#3D3226', marginBottom: 6 }}>
            Parsed {preview.parsed} row{preview.parsed !== 1 ? 's' : ''}
            {preview.skipped > 0 ? ` · ${preview.skipped} skipped` : ''}
            {' — review before saving'}
          </div>
          <div style={{ maxHeight: 120, overflowY: 'auto', fontFamily: 'DM Mono, monospace', fontSize: 10, color: '#5F5E5A', lineHeight: 1.6 }}>
            {preview.rows.slice(0, 8).map((r, i) => (
              <div key={i}>
                {platform === 'meta'
                  ? `${r.date}  ${r.campaignName.slice(0, 30)}  $${r.spend.toFixed(2)}  ${r.clicks} clicks`
                  : `${r.weekStart}  ${r.campaignName.slice(0, 30)}  $${r.spend.toFixed(2)}  ${r.clicks} clicks`
                }
              </div>
            ))}
            {preview.rows.length > 8 && <div style={{ color: '#B0ADA8' }}>…and {preview.rows.length - 8} more</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={handleSave}
              style={{ background: '#3D3226', color: '#FFF', border: 'none', borderRadius: 7, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
            >
              Save {preview.parsed} records
            </button>
            <button
              onClick={() => { setPreview(null); setStatus('idle'); }}
              style={{ background: '#F0EDE6', border: '0.5px solid #D0CCC4', borderRadius: 7, padding: '6px 14px', fontSize: 11, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {status === 'done' && <div style={{ marginTop: 8, fontSize: 11, color: '#3D6B40' }}>✓ {message} Reload the page to see updated data.</div>}
      {status === 'error' && <div style={{ marginTop: 8, fontSize: 11, color: '#A32D2D' }}>⚠ {message}</div>}
    </div>
  );
}

// ── upload timestamp badge ────────────────────────────────────────────────────

function uploadBadgeText(uploadedAt, dateRange) {
  if (!uploadedAt) return null;
  const d = new Date(uploadedAt);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const range = dateRange ? ` · ${dateRange.start} – ${dateRange.end}` : '';
  return `Data as of ${dateStr} upload${range}`;
}

// ── main page ─────────────────────────────────────────────────────────────────

export function CampaignsPage({ data, onBack }) {
  const [campaignData, setCampaignData] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [fetchError, setFetchError]     = useState(null);
  const [showUpload, setShowUpload]     = useState(false);

  const ga4Connected = data?.website?.connected === true;
  const ranges       = data?.ranges;

  const load = () => {
    setLoading(true);
    setFetchError(null);
    fetchCampaignPageData()
      .then(setCampaignData)
      .catch(e => setFetchError(e.message || 'Failed to load campaign data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const meta   = campaignData?.meta;
  const google = campaignData?.google;

  // Date ranges for GA4 drill-down — use rolling windows consistent with KPI cards
  const now           = new Date();
  const sevenDaysAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmtDate       = d => new Date(d).toISOString().slice(0, 10);

  return (
    <PageShell title="Marketing" onBack={onBack}>

      {/* Upload section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#8C8A85' }}>
          {!loading && meta?.hasData && `Meta: ${meta.dateRange?.start} – ${meta.dateRange?.end}`}
          {!loading && meta?.hasData && google?.hasData && '  ·  '}
          {!loading && google?.hasData && `Google: weeks ${google.dateRange?.start} – ${google.dateRange?.end}`}
          {!loading && !meta?.hasData && !google?.hasData && 'No campaign data yet — upload a CSV to get started'}
        </div>
        <button
          onClick={() => setShowUpload(v => !v)}
          style={{ background: '#F0EDE6', border: '0.5px solid #D0CCC4', borderRadius: 7, padding: '5px 12px', fontSize: 11, cursor: 'pointer', fontFamily: 'DM Sans, sans-serif' }}
        >
          {showUpload ? '▲ Hide upload' : '▼ Upload CSVs'}
        </button>
      </div>

      {showUpload && (
        <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#5F5E5A', marginBottom: 14 }}>
            Export from Ads Manager → Campaigns → Breakdown: Day (Meta) or Segment: Time → Week (Google). Upload the CSV — data is stored in the dashboard's S3 bucket and persists between sessions.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <CsvUploadBox
              platform="meta"
              label="Meta Ads — Campaign export (day breakdown)"
              hint="Ads Manager → Campaigns → Breakdown: Day → Export CSV. Customize columns to include Campaign ID (needed for UTM matching — Meta tags URLs with the numeric ID, not the name). Required columns: Campaign ID, Reporting starts, Campaign name, Amount spent (USD), Impressions, Link clicks, Purchases."
              onUploaded={() => { setShowUpload(false); load(); }}
            />
            <CsvUploadBox
              platform="google"
              label="Google Ads — Campaign report (week segment)"
              hint="Campaigns → Segment: Time → Week → Export CSV. Ensure Campaign ID column is included (add via Columns menu). Required columns: Campaign ID, Week, Campaign, Cost, Impr., Clicks, Conversions. First two rows (Campaign report / All time) are skipped automatically."
              onUploaded={() => { setShowUpload(false); load(); }}
            />
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#8C8A85', fontSize: 13 }}>
          Loading campaign data…
        </div>
      )}
      {fetchError && (
        <div style={{ padding: '12px 14px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 13, color: '#A32D2D', marginBottom: 12 }}>
          ⚠ {fetchError}
        </div>
      )}

      {!loading && (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>

            {/* Meta Ads panel */}
            <PanelCard
              title="Meta Ads"
              badge={meta?.hasData ? 'CSV upload' : 'No data'}
              badgeColor={meta?.hasData ? 'green' : null}
              uploadBadge={uploadBadgeText(meta?.uploadedAt, meta?.dateRange)}
            >
              {!meta?.hasData && (
                <div style={{ padding: '10px 12px', background: '#FAEEDA', border: '0.5px solid #E8C97A', borderRadius: 8, fontSize: 11, color: '#854F0B', marginBottom: 10 }}>
                  ⏳ No Meta data yet — upload a CSV above.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <KPICard label="CPC (7d)"  value={fmt.usdDec(meta?.cpc7)}  change={null} changeLabel={!meta?.hasData ? 'no data' : null} definition={DEFS.cpc} />
                <KPICard label="CPM (7d)"  value={fmt.usdDec(meta?.cpm7)}  change={null} changeLabel={!meta?.hasData ? 'no data' : null} definition={DEFS.cpm} />
                <KPICard label="CAC (7d)"  value={fmt.usdDec(meta?.cac7)}  change={null} changeLabel={meta?.cac7 == null ? 'pending match' : null} definition={DEFS.cac} />
                <KPICard label="CPC (30d)" value={fmt.usdDec(meta?.cpc30)} change={null} changeLabel={!meta?.hasData ? 'no data' : null} definition={DEFS.cpc} />
                <KPICard label="CPM (30d)" value={fmt.usdDec(meta?.cpm30)} change={null} changeLabel={!meta?.hasData ? 'no data' : null} definition={DEFS.cpm} />
                <KPICard label="CAC (30d)" value={fmt.usdDec(meta?.cac30)} change={null} changeLabel={meta?.cac30 == null ? 'pending match' : null} definition={DEFS.cac} />
              </div>
            </PanelCard>

            {/* Google Ads panel — Task B: different label conventions */}
            <PanelCard
              title="Google Ads"
              badge={google?.hasData ? 'CSV upload' : 'No data'}
              badgeColor={google?.hasData ? 'green' : null}
              uploadBadge={uploadBadgeText(google?.uploadedAt, google?.dateRange)}
            >
              {!google?.hasData && (
                <div style={{ padding: '10px 12px', background: '#FAEEDA', border: '0.5px solid #E8C97A', borderRadius: 8, fontSize: 11, color: '#854F0B', marginBottom: 10 }}>
                  ⏳ No Google data yet — upload a CSV above.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <KPICard
                  label="CPC (last complete week)"
                  value={fmt.usdDec(google?.cpcLastWeek)}
                  change={null}
                  changeLabel={!google?.hasData ? 'no data' : null}
                  definition={DEFS.cpc + ' ' + DEFS.google}
                />
                <KPICard
                  label="CPM (last complete week)"
                  value={fmt.usdDec(google?.cpmLastWeek)}
                  change={null}
                  changeLabel={!google?.hasData ? 'no data' : null}
                  definition={DEFS.cpm + ' ' + DEFS.google}
                />
                <KPICard
                  label="CAC (last complete week)"
                  value={fmt.usdDec(google?.cacLastWeek)}
                  change={null}
                  changeLabel={google?.cacLastWeek != null ? "Google's own data" : (!google?.hasData ? 'no data' : null)}
                  definition={DEFS.cacGoogle + ' ' + DEFS.google}
                />
                <KPICard
                  label="CPC (last 4 weeks)"
                  value={fmt.usdDec(google?.cpcLast4Weeks)}
                  change={null}
                  changeLabel={!google?.hasData ? 'no data' : null}
                  definition={DEFS.cpc + ' ' + DEFS.google}
                />
                <KPICard
                  label="CPM (last 4 weeks)"
                  value={fmt.usdDec(google?.cpmLast4Weeks)}
                  change={null}
                  changeLabel={!google?.hasData ? 'no data' : null}
                  definition={DEFS.cpm + ' ' + DEFS.google}
                />
                <KPICard
                  label="CAC (last 4 weeks)"
                  value={fmt.usdDec(google?.cacLast4Weeks)}
                  change={null}
                  changeLabel={google?.cacLast4Weeks != null ? "Google's own data" : (!google?.hasData ? 'no data' : null)}
                  definition={DEFS.cacGoogle + ' ' + DEFS.google}
                />
              </div>
              {google?.lastCompleteWeek && (
                <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 8 }}>
                  Last complete week: {google.lastCompleteWeek} · Google Ads data is weekly (Mon–Sun), not a rolling window
                </div>
              )}
            </PanelCard>
          </div>

          {/* Unmatched UTM warning — only platform-sourced orders that failed to match a specific campaign */}
          {meta?.unmatched?.length > 0 && (
            <div style={{ padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 11, color: '#A32D2D', marginTop: 12 }}>
              ⚠ Meta: {meta.unmatched.length} Meta-sourced UTM campaign{meta.unmatched.length !== 1 ? 's' : ''} with attributed orders didn't match any uploaded campaign ID or name: {meta.unmatched.join(', ')}
            </div>
          )}
          {google?.unmatched?.length > 0 && (
            <div style={{ padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 11, color: '#A32D2D', marginTop: 8 }}>
              ⚠ Google: {google.unmatched.length} Google-sourced UTM campaign{google.unmatched.length !== 1 ? 's' : ''} with attributed orders didn't match any uploaded campaign ID or name: {google.unmatched.join(', ')}
            </div>
          )}

          {/* Meta campaign tables */}
          <SectionLabel>Meta Campaigns</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <CampaignTable
              title="Rolling 7 days"
              campaigns={meta?.campaigns7}
              ga4Connected={ga4Connected}
              dateStart={fmtDate(sevenDaysAgo)}
              dateEnd={fmtDate(now)}
              showCac={true}
              footnote="Spend + clicks from uploaded CSV. CAC = spend ÷ new customers via Shopify last-click attribution."
            />
            <CampaignTable
              title="Rolling 30 days"
              campaigns={meta?.campaigns30}
              ga4Connected={ga4Connected}
              dateStart={fmtDate(thirtyDaysAgo)}
              dateEnd={fmtDate(now)}
              showCac={true}
              footnote="Spend + clicks from uploaded CSV. CAC = spend ÷ new customers via Shopify last-click attribution."
            />
          </div>

          {/* Google campaign tables */}
          <SectionLabel>Google Campaigns</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <CampaignTable
              title={google?.lastCompleteWeek ? `Last complete week (${google.lastCompleteWeek})` : 'Last complete week'}
              campaigns={google?.campaignsLastWeek}
              ga4Connected={ga4Connected}
              dateStart={google?.lastCompleteWeek}
              dateEnd={google?.lastCompleteWeek}
              showCac={true}
              footnote="Spend + clicks from uploaded CSV · Mon–Sun calendar week · CAC = spend ÷ new customers via Shopify last-click attribution."
            />
            <CampaignTable
              title="Last 4 complete weeks"
              campaigns={google?.campaignsLast4Weeks}
              ga4Connected={ga4Connected}
              dateStart={null}
              dateEnd={null}
              showCac={true}
              footnote="Spend + clicks from uploaded CSV · Mon–Sun calendar weeks · CAC = spend ÷ new customers via Shopify last-click attribution."
            />
          </div>
        </>
      )}

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
