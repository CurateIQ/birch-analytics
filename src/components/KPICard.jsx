/**
 * KPICard.jsx
 * Bold label, WoW pill, ? info icon with definition, double-click drill-down.
 */

import React, { useState } from 'react';

export function KPICard({ label, value, change, changeLabel, suffix = '', drillData, drillTitle, definition }) {
  const [active, setActive]     = useState(false);
  const [showDrill, setShowDrill] = useState(false);
  const [showDef, setShowDef]   = useState(false);

  const changeNum  = parseFloat(change);
  const isPositive = changeNum > 0;
  const isNegative = changeNum < 0;
  const isFlat     = change === null || change === undefined || isNaN(changeNum) || changeNum === 0;
  const isInverted = ['cancellation','return','abandon','burn'].some(k => label.toLowerCase().includes(k));

  const pillColor = isFlat ? 'amber'
    : (isPositive && !isInverted) || (isNegative && isInverted) ? 'green' : 'red';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
      <div
        onClick={() => setActive(a => !a)}
        onDoubleClick={() => { if (drillData) setShowDrill(s => !s); }}
        style={{
          background: active ? '#FFFFFF' : '#F4F2EC',
          border: `0.5px solid ${active ? '#5A7A5C' : '#E0DDD6'}`,
          borderRadius: 8, padding: '10px 12px',
          cursor: drillData ? 'pointer' : 'default',
          transition: 'all 0.15s', position: 'relative',
        }}
      >
        {drillData && (
          <span style={{ position:'absolute', top:5, right:30, fontSize:9, color:'#8C8A85', opacity: active ? 1 : 0, transition:'opacity 0.15s' }}>
            dbl-click ↗
          </span>
        )}

        {/* Label + ? icon */}
        <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:5 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#3D3226', letterSpacing:'0.05em', textTransform:'uppercase', flex:1 }}>
            {label}
          </div>
          {definition && (
            <div
              onClick={e => { e.stopPropagation(); setShowDef(s => !s); }}
              style={{
                width:16, height:16, borderRadius:'50%',
                background: showDef ? '#3D3226' : '#C8BFB0',
                color: showDef ? '#F5F2EA' : '#7A6E62',
                fontSize:10, fontWeight:700,
                display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', flexShrink:0, transition:'all 0.15s',
              }}
            >?</div>
          )}
        </div>

        {/* Definition */}
        {showDef && definition && (
          <div style={{
            fontSize:11, lineHeight:1.55, color:'#5F5E5A',
            background:'#F5F2EA', border:'0.5px solid #C8BFB0',
            borderRadius:6, padding:'7px 9px', marginBottom:6,
            animation:'slideIn 0.15s ease',
          }}>
            {definition}
          </div>
        )}

        {/* Value */}
        <div style={{ fontSize:20, fontWeight:500, color:'#1A1A1A', lineHeight:1.1 }}>
          {value !== null && value !== undefined ? `${value}${suffix}` : '—'}
        </div>

        {/* Pill */}
        {!isFlat && change !== null && change !== undefined && (
          <div style={{ marginTop:4 }}>
            <span style={{
              fontSize:10, padding:'2px 6px', borderRadius:99, fontWeight:500,
              background: pillColor==='green' ? '#EAF3DE' : pillColor==='red' ? '#FCEBEB' : '#FAEEDA',
              color: pillColor==='green' ? '#3B6D11' : pillColor==='red' ? '#A32D2D' : '#854F0B',
            }}>
              {isPositive ? '↑' : '↓'} {Math.abs(changeNum)}% WoW
            </span>
          </div>
        )}
        {isFlat && (
          <div style={{ marginTop:4 }}>
            <span style={{ fontSize:10, padding:'2px 6px', borderRadius:99, fontWeight:500, background:'#FAEEDA', color:'#854F0B' }}>→ flat</span>
          </div>
        )}
        {changeLabel && <div style={{ fontSize:10, color:'#8C8A85', marginTop:3 }}>{changeLabel}</div>}
      </div>

      {showDrill && drillData && (
        <DrillPanel title={drillTitle} data={drillData} onClose={() => setShowDrill(false)} />
      )}
    </div>
  );
}

function DrillPanel({ title, data, onClose }) {
  const max = Math.max(...data.map(d => d.value));
  return (
    <div style={{ background:'#F4F2EC', border:'0.5px solid #E0DDD6', borderRadius:8, padding:'10px 12px', marginTop:4, animation:'slideIn 0.2s ease' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:'#3D3226' }}>{title}</span>
        <span onClick={onClose} style={{ cursor:'pointer', color:'#8C8A85', fontSize:14 }}>×</span>
      </div>
      {data.map((row, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', borderBottom: i < data.length-1 ? '0.5px solid #E0DDD6' : 'none' }}>
          <span style={{ fontSize:11, color:'#1A1A1A', width:120, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.label}</span>
          <div style={{ flex:1, height:4, background:'#FFFFFF', borderRadius:99 }}>
            <div style={{ height:4, borderRadius:99, background:'#5A7A5C', width:`${max > 0 ? (row.value/max)*100 : 0}%` }} />
          </div>
          <span style={{ fontSize:11, color:'#5F5E5A', minWidth:60, textAlign:'right', fontFamily:'DM Mono, monospace' }}>{row.formatted}</span>
        </div>
      ))}
    </div>
  );
}
