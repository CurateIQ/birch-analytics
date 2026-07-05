/**
 * Sidebar.jsx
 * Slide-out navigation sidebar. Overlays the dashboard, closes on selection.
 */

import React from 'react';

const SECTIONS = [
  {
    group: 'Core Metrics',
    items: [
      { id:'orders',      icon:'📦', name:'Orders & Transactions', sub:'GMV, AOV, returns, cart abandon',   status:'live' },
      { id:'customers',   icon:'👥', name:'Customers',             sub:'MAU, WAU, new vs returning',         status:'live' },
      { id:'operations',  icon:'⚙️', name:'Operations',            sub:'Dwelling orders, late deliveries',   status:'live' },
      { id:'website',     icon:'🌐', name:'Website Traffic',       sub:'Sessions, channels, landing pages',  status:'live' },
      { id:'growth',      icon:'📈', name:'Growth & Catalog',      sub:'GMV by brand, category trends',      status:'live' },
      { id:'marketplace', icon:'🏪', name:'Marketplace & Supply',  sub:'Brands, SKUs, fulfillment',          status:'live' },
      { id:'email',       icon:'✉️', name:'Email & CRM',           sub:'List size, open rate, click rate',   status:'live' },
      { id:'askbirch',    icon:'💬', name:'Ask Birch Queries',     sub:'What customers are asking',          status:'live' },
    ],
  },
  {
    group: 'Coming Soon',
    items: [
      { id:'revenue',    icon:'💰', name:'Revenue & Unit Economics', sub:'Take rate, margin, burn, runway',  status:'soon' },
      { id:'marketing',  icon:'📣', name:'Marketing',               sub:'CAC, paid, organic, influencer',    status:'soon' },
      { id:'brands',     icon:'🏷️', name:'Brand Health',           sub:'Per-brand orders, returns, SLA',    status:'soon' },
      { id:'finance',    icon:'🧾', name:'Finance & Tax',          sub:'Net revenue, tax, compliance',       status:'soon' },
    ],
  },
];

export function Sidebar({ open, onClose, activeSection }) {
  const handleNav = (id, status) => {
    if (status === 'soon') return;
    onClose(id);
  };

  return (
    <>
      {/* Overlay */}
      <div
        onClick={() => onClose(null)}
        style={{
          position:'fixed', inset:0, background:'rgba(61,50,38,0.4)',
          zIndex:10, opacity: open ? 1 : 0,
          pointerEvents: open ? 'all' : 'none',
          transition:'opacity 0.25s',
        }}
      />

      {/* Sidebar */}
      <div style={{
        position:'fixed', top:0, left:0, bottom:0, width:260,
        background:'#3D3226', zIndex:20,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition:'transform 0.25s ease',
        display:'flex', flexDirection:'column',
        overflowY:'auto',
      }}>
        {/* Header */}
        <div style={{ padding:'13px 16px', borderBottom:'1px solid rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <span style={{ fontSize:13, fontWeight:600, color:'#F5F2EA' }}>Navigate</span>
          <button onClick={() => onClose(null)} style={{ width:24, height:24, borderRadius:5, background:'rgba(255,255,255,0.1)', border:'none', color:'#C8BFB0', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>

        {/* Sections */}
        {SECTIONS.map(section => (
          <div key={section.group}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:'0.12em', color:'rgba(200,191,176,0.4)', textTransform:'uppercase', padding:'14px 16px 5px' }}>
              {section.group}
            </div>
            {section.items.map(item => (
              <div
                key={item.id}
                onClick={() => handleNav(item.id, item.status)}
                style={{
                  display:'flex', alignItems:'center', gap:10,
                  padding:'9px 16px',
                  cursor: item.status === 'soon' ? 'default' : 'pointer',
                  borderLeft: `3px solid ${activeSection === item.id ? '#7A9E7E' : 'transparent'}`,
                  background: activeSection === item.id ? 'rgba(122,158,126,0.2)' : 'transparent',
                  transition:'background 0.12s',
                  opacity: item.status === 'soon' ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (item.status !== 'soon') e.currentTarget.style.background = activeSection === item.id ? 'rgba(122,158,126,0.2)' : 'rgba(255,255,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = activeSection === item.id ? 'rgba(122,158,126,0.2)' : 'transparent'; }}
              >
                <div style={{ width:28, height:28, borderRadius:6, background:'rgba(255,255,255,0.08)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0 }}>
                  {item.icon}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12.5, fontWeight:500, color:'#F5F2EA' }}>{item.name}</div>
                  <div style={{ fontSize:10, color:'rgba(200,191,176,0.5)', marginTop:1 }}>{item.sub}</div>
                </div>
                <span style={{
                  fontSize:9, padding:'2px 6px', borderRadius:99, fontWeight:600, flexShrink:0,
                  background: item.status === 'live' ? 'rgba(122,158,126,0.3)' : 'rgba(200,191,176,0.1)',
                  color: item.status === 'live' ? '#A8D4AC' : 'rgba(200,191,176,0.4)',
                }}>
                  {item.status === 'live' ? 'Live' : 'Soon'}
                </span>
              </div>
            ))}
            {section.group !== 'Coming Soon' && (
              <div style={{ height:1, background:'rgba(255,255,255,0.08)', margin:'6px 16px' }} />
            )}
          </div>
        ))}
        <div style={{ height:20 }} />
      </div>
    </>
  );
}
