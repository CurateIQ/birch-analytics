import React, { useState } from 'react';
import { KPICard } from '../components/KPICard';
import { fetchCampaignFunnel } from '../api/ga4';

const fmt = {
  usd:    v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
  usdDec: v => v == null ? '—' : `$${Number(v).toFixed(2)}`,
  num:    v => v == null ? '—' : Number(v).toLocaleString(),
};

const DEFS = {
  cpc: 'Cost per click, pulled directly from the ad platform\'s own API. A delivery metric — no attribution ambiguity.',
  cpm: 'Cost per 1,000 impressions, pulled directly from the ad platform\'s own API. A delivery metric — no attribution ambiguity.',
  cac: 'Ad spend ÷ new customers attributed via last non-direct click (Shopify order data), not Meta\'s self-reported conversions — this will not match Meta Ads Manager\'s own number. New customer = first-ever Shopify order.',
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

function PanelCard({ title, badge, badgeColor, children }) {
  return (
    <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#3D3226' }}>{title}</span>
        {badge && (
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 99, fontWeight: 600, background: badgeColor === 'green' ? 'rgba(122,158,126,0.3)' : '#F0EDE6', color: badgeColor === 'green' ? '#3D4E3E' : '#8C8A85' }}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

const TBL_HEAD = { fontSize: 10, fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 6, borderBottom: '1px solid #E0DDD6', whiteSpace: 'nowrap' };
const TBL_CELL = { padding: '6px 0', borderBottom: '0.5px solid #F0EDE6', verticalAlign: 'top' };

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
    <div style={{ background: '#F4F2EC', border: '0.5px solid #E0DDD6', borderRadius: 8, padding: '12px 14px', marginTop: 4, animation: 'slideIn 0.2s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#3D3226' }}>{campaign.campaignName} — funnel</span>
        <span onClick={onClose} style={{ cursor: 'pointer', color: '#8C8A85', fontSize: 15 }}>×</span>
      </div>

      {!ga4Connected && (
        <div style={{ fontSize: 11, color: '#854F0B', marginBottom: 8 }}>⏳ Pre-purchase stages await GA4 connection — purchase stage below is live.</div>
      )}
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
        Landing → checkout filtered by GA4 sessionCampaignName. Purchase count is new customers attributed to this campaign via last non-direct click (Shopify), same data used for CAC.
      </div>
    </div>
  );
}

function CampaignTable({ title, campaigns, ga4Connected, dateStart, dateEnd }) {
  const [drillCampaign, setDrillCampaign] = useState(null);

  if (!campaigns?.length) {
    return (
      <div style={{ background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#3D3226', marginBottom: 10 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#8C8A85' }}>No campaign data</div>
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
              {['Campaign', 'Spend', 'CPC', 'CPM', 'CAC'].map(h => (
                <th key={h} style={{ ...TBL_HEAD, textAlign: h === 'Campaign' ? 'left' : 'right', paddingRight: h !== 'Campaign' ? 10 : 0 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => (
              <React.Fragment key={c.campaignId || i}>
                <tr
                  onDoubleClick={() => setDrillCampaign(drillCampaign?.campaignId === c.campaignId ? null : c)}
                  style={{ cursor: 'pointer' }}
                  title="Double-click for funnel breakdown"
                >
                  <td style={{ ...TBL_CELL, color: '#3D3226', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.campaignName}</td>
                  <td style={{ ...TBL_CELL, textAlign: 'right', paddingRight: 10, fontFamily: 'DM Mono, monospace' }}>{fmt.usd(c.spend)}</td>
                  <td style={{ ...TBL_CELL, textAlign: 'right', paddingRight: 10, fontFamily: 'DM Mono, monospace' }}>{fmt.usdDec(c.cpc)}</td>
                  <td style={{ ...TBL_CELL, textAlign: 'right', paddingRight: 10, fontFamily: 'DM Mono, monospace' }}>{fmt.usdDec(c.cpm)}</td>
                  <td style={{ ...TBL_CELL, textAlign: 'right', fontFamily: 'DM Mono, monospace' }}>
                    {c.cac != null ? fmt.usdDec(c.cac) : <span style={{ color: '#C8BFB0' }}>pending</span>}
                  </td>
                </tr>
                {drillCampaign?.campaignId === c.campaignId && (
                  <tr>
                    <td colSpan={5} style={{ padding: 0, border: 'none' }}>
                      <CampaignDrillDown
                        campaign={c}
                        ga4Connected={ga4Connected}
                        dateStart={dateStart}
                        dateEnd={dateEnd}
                        onClose={() => setDrillCampaign(null)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 9, color: '#C8BFB0', marginTop: 6 }}>Double-click a row for the campaign funnel breakdown</div>
    </div>
  );
}

export function CampaignsPage({ data, onBack }) {
  const meta = data?.campaigns?.meta;
  const google = data?.campaigns?.google;
  const ranges = data?.ranges;
  const ga4Connected = data?.website?.connected === true;
  const metaConnected = meta?.connected === true;

  return (
    <PageShell title="Marketing" onBack={onBack}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>

        {/* Google Ads — pending */}
        <PanelCard title="Google Ads">
          <div style={{ padding: '10px 12px', background: '#FAEEDA', border: '0.5px solid #E8C97A', borderRadius: 8, fontSize: 11, color: '#854F0B', marginBottom: 10 }}>
            ⏳ Google Ads credentials pending — data will populate automatically once GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_REFRESH_TOKEN, and GOOGLE_ADS_CUSTOMER_ID are added to the Lambda.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <KPICard label="CPC" value={null} change={null} changeLabel="Google Ads pending" definition={DEFS.cpc} />
            <KPICard label="CPM" value={null} change={null} changeLabel="Google Ads pending" definition={DEFS.cpm} />
            <KPICard label="CAC" value={null} change={null} changeLabel="Google Ads pending" definition={DEFS.cac} />
          </div>
        </PanelCard>

        {/* Meta Ads — live */}
        <PanelCard title="Meta Ads" badge={metaConnected ? 'Live' : 'Pending'} badgeColor={metaConnected ? 'green' : null}>
          {!metaConnected && (
            <div style={{ padding: '10px 12px', background: '#FAEEDA', border: '0.5px solid #E8C97A', borderRadius: 8, fontSize: 11, color: '#854F0B', marginBottom: 10 }}>
              ⏳ Meta Marketing API not yet reachable — check META_ACCESS_TOKEN / META_AD_ACCOUNT_ID, or the System User may still be propagating permissions.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <KPICard label="CPC (7d)" value={meta?.cpc7 != null ? fmt.usdDec(meta.cpc7) : null} change={null} changeLabel={meta?.cpc7 == null ? 'no data' : null} definition={DEFS.cpc} />
            <KPICard label="CPM (7d)" value={meta?.cpm7 != null ? fmt.usdDec(meta.cpm7) : null} change={null} changeLabel={meta?.cpm7 == null ? 'no data' : null} definition={DEFS.cpm} />
            <KPICard label="CAC (7d)" value={meta?.cac7 != null ? fmt.usdDec(meta.cac7) : null} change={null} changeLabel={meta?.cac7 == null ? 'pending match' : null} definition={DEFS.cac} />
            <KPICard label="CPC (30d)" value={meta?.cpc30 != null ? fmt.usdDec(meta.cpc30) : null} change={null} changeLabel={meta?.cpc30 == null ? 'no data' : null} definition={DEFS.cpc} />
            <KPICard label="CPM (30d)" value={meta?.cpm30 != null ? fmt.usdDec(meta.cpm30) : null} change={null} changeLabel={meta?.cpm30 == null ? 'no data' : null} definition={DEFS.cpm} />
            <KPICard label="CAC (30d)" value={meta?.cac30 != null ? fmt.usdDec(meta.cac30) : null} change={null} changeLabel={meta?.cac30 == null ? 'pending match' : null} definition={DEFS.cac} />
          </div>
        </PanelCard>
      </div>

      {meta?.unmatched?.length > 0 && (
        <div style={{ padding: '10px 12px', background: '#FCEBEB', border: '0.5px solid #E24B4A', borderRadius: 8, fontSize: 11, color: '#A32D2D', marginTop: 12 }}>
          ⚠ {meta.unmatched.length} UTM campaign{meta.unmatched.length !== 1 ? 's' : ''} with attributed orders didn't match any Meta campaign name (check UTM ↔ campaign naming): {meta.unmatched.join(', ')}
        </div>
      )}

      <SectionLabel>Meta Campaigns</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <CampaignTable
          title="Rolling 7 days"
          campaigns={meta?.campaigns7}
          ga4Connected={ga4Connected}
          dateStart={ranges?.weekStart}
          dateEnd={ranges?.weekEnd}
        />
        <CampaignTable
          title="Rolling 30 days"
          campaigns={meta?.campaigns30}
          ga4Connected={ga4Connected}
          dateStart={ranges?.monthStart}
          dateEnd={ranges?.monthEnd}
        />
      </div>

      <div style={{ height: 40 }} />
    </PageShell>
  );
}
