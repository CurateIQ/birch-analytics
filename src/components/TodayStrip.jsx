/**
 * TodayStrip.jsx
 * Live "Today so far" strip — ET midnight to now, vs same time yesterday.
 */

import React from 'react';

const fmt = {
  usd: v => v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits:0, maximumFractionDigits:0 })}`,
  num: v => v == null ? '—' : Number(v).toLocaleString(),
  pct: v => v == null ? '—' : `${v}%`,
};

function TodayCard({ label, value, change, invertGood = false }) {
  const changeNum  = parseFloat(change);
  const isFlat     = change === null || change === undefined || isNaN(changeNum) || changeNum === 0;
  const isPositive = changeNum > 0;
  const isGood     = invertGood ? !isPositive : isPositive;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.07)',
      border: '0.5px solid rgba(255,255,255,0.1)',
      borderRadius: 8, padding: '9px 11px', minWidth: 0,
    }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:'rgba(200,191,176,0.6)', marginBottom:4 }}>
        {label}
      </div>
      <div style={{ fontSize:18, fontWeight:500, color:'#F5F2EA', lineHeight:1.1 }}>
        {value}
      </div>
      <div style={{ marginTop:4, display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
        {!isFlat ? (
          <>
            <span style={{
              fontSize:9, fontWeight:600, padding:'1px 5px', borderRadius:99,
              background: isGood ? 'rgba(122,158,126,0.3)' : 'rgba(226,75,74,0.25)',
              color: isGood ? '#A8D4AC' : '#F4A0A0',
            }}>
              {isPositive ? '↑' : '↓'} {Math.abs(changeNum)}%
            </span>
            <span style={{ fontSize:9, color:'rgba(200,191,176,0.4)' }}>vs yesterday</span>
          </>
        ) : (
          <span style={{ fontSize:9, color:'rgba(200,191,176,0.3)' }}>→ flat vs yesterday</span>
        )}
      </div>
    </div>
  );
}

export function TodayStrip({ today }) {
  if (!today) return null;

  return (
    <div style={{ background:'#3D3226', padding:'10px 16px', flexShrink:0, borderBottom:'2px solid #5A4A38' }}>
      <style>{`
        .today-cards { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; }
        @media (max-width:767px) { .today-cards { grid-template-columns:repeat(2,1fr); } }
      `}</style>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
        <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', color:'#C8BFB0', whiteSpace:'nowrap' }}>Today so far</span>
        <span style={{ fontSize:10, color:'rgba(200,191,176,0.4)', fontFamily:'DM Mono, monospace', whiteSpace:'nowrap' }}>
          {today.dateLabel} · 12:00 AM – {today.timeLabel} ET
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:9, fontWeight:600, color:'#A8D4AC', background:'rgba(122,158,126,0.2)', padding:'2px 7px', borderRadius:99 }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:'#7A9E7E', display:'inline-block' }} />
          Live
        </div>
        <span style={{ fontSize:9, color:'rgba(200,191,176,0.3)', whiteSpace:'nowrap' }}>
          Day = midnight to midnight ET · Week = last 7 complete days ending at midnight ET
        </span>
      </div>

      <div className="today-cards">
        <TodayCard label="GMV today"     value={fmt.usd(today.gmv)}         change={today.gmvVsYest} />
        <TodayCard label="Orders today"  value={fmt.num(today.orders)}       change={today.ordersVsYest} />
        <TodayCard label="AOV today"     value={fmt.usd(today.aov)}          change={today.aovVsYest} />
        <TodayCard label="New customers" value={fmt.num(today.newCustomers)} change={today.newCustVsYest} />
        <TodayCard label="Cart abandon"  value={today.cartAbandon != null ? fmt.pct(today.cartAbandon) : 'GA4 pending'} change={today.cartAbandonVsYest} invertGood={true} />
      </div>
    </div>
  );
}
