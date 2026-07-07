/**
 * QueryExport.jsx — browse & download all Ask Birch chat sessions within a
 * chosen date range. Nothing loads by default: the user picks From/To and
 * clicks Load, which fetches the existing /ai/queries proxy endpoint.
 *
 * Caveat (frontend-only, no backend change): the worker caps the window at
 * 90 days and returns at most the 100 most-recent sessions. We derive `days`
 * from the From date (capped at 90), request limit=100, then filter the
 * `recent` list to [from, to] client-side. When the worker returns a full
 * 100 rows we warn that the export may be truncated.
 */

import React, { useState } from 'react';
import { PROXY, PROXY_HEADERS } from '../api/proxy';
import { customerAdminUrl } from './ChatTranscriptModal';

const MAX_DAYS = 90;
const MAX_ROWS = 100;

// yyyy-mm-dd for <input type="date">
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: isoDate(from), to: isoDate(to) };
}

// Start-of-day (local) for `from`, end-of-day for `to`, as epoch ms.
function rangeBounds(fromStr, toStr) {
  const fromMs = new Date(`${fromStr}T00:00:00`).getTime();
  const toMs = new Date(`${toStr}T23:59:59.999`).getTime();
  return { fromMs, toMs };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function QueryExport({ onViewChat }) {
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [state, setState] = useState({ status: 'idle', rows: null, error: null, truncated: false });

  async function load() {
    if (!from || !to) return;
    if (from > to) { setState({ status: 'error', rows: null, error: 'From date is after To date.', truncated: false }); return; }

    setState({ status: 'loading', rows: null, error: null, truncated: false });
    try {
      const { fromMs, toMs } = rangeBounds(from, to);
      // Worker window is relative to now; derive days from the From date.
      const daysBack = Math.ceil((Date.now() - fromMs) / (24 * 60 * 60 * 1000));
      const days = Math.min(MAX_DAYS, Math.max(1, daysBack));
      const capped = daysBack > MAX_DAYS;

      const res = await fetch(`${PROXY}/ai/queries?days=${days}&limit=${MAX_ROWS}`, { headers: PROXY_HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const all = data.recent || [];

      const rows = all
        .filter((r) => r.ts != null && r.ts >= fromMs && r.ts <= toMs)
        .sort((a, b) => b.ts - a.ts);

      // If the worker returned the full cap, older sessions in-range may be missing.
      const truncated = all.length >= MAX_ROWS || capped;
      setState({ status: 'loaded', rows, error: null, truncated });
    } catch (e) {
      setState({ status: 'error', rows: null, error: e.message, truncated: false });
    }
  }

  function downloadCsv() {
    const rows = state.rows || [];
    const header = ['date', 'query', 'messages', 'escalated', 'mode', 'customer_id', 'session_id'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.ts ? new Date(r.ts).toISOString() : '',
        r.query || '',
        r.messageCount ?? '',
        r.wasEscalated ? 'yes' : 'no',
        r.mode || '',
        r.customerId || '',
        r.sessionId || '',
      ].map(csvCell).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ask-birch-queries_${from}_to_${to}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const { status, rows, error, truncated } = state;
  const inputStyle = {
    fontFamily: 'inherit', fontSize: 11, color: '#3D3226', border: '0.5px solid #E0DDD6',
    borderRadius: 6, padding: '4px 7px', background: '#FFFFFF',
  };
  const btnStyle = (primary) => ({
    border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
    background: primary ? '#3D3226' : '#F0EDE6', color: primary ? '#F7F5EF' : '#3D3226',
  });

  return (
    <div style={{ gridColumn: '1 / -1', background: '#FFFFFF', border: '0.5px solid #E0DDD6', borderRadius: 10, padding: '12px 14px' }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#3D3226' }}>Browse &amp; export</span>
        <span style={{ fontSize: 9, background: '#FBEEDC', color: '#8A5A1E', padding: '1px 7px', borderRadius: 99, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Max {MAX_ROWS} rows · 90 days
        </span>
        <span style={{ fontSize: 10, color: '#8C8A85' }}>From</span>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#8C8A85' }}>To</span>
        <input type="date" value={to} min={from} max={isoDate(new Date())} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
        <button onClick={load} disabled={status === 'loading'} style={btnStyle(true)}>
          {status === 'loading' ? 'Loading…' : 'Load'}
        </button>
        {status === 'loaded' && (
          <>
            <span style={{ fontSize: 10, background: '#F0EDE6', color: '#5F5E5A', padding: '1px 7px', borderRadius: 99, fontWeight: 600 }}>
              {rows.length} {rows.length === 1 ? 'session' : 'sessions'}
            </span>
            <button onClick={downloadCsv} disabled={rows.length === 0} style={btnStyle(false)}>
              ⬇ Download CSV
            </button>
          </>
        )}
      </div>

      {truncated && status === 'loaded' && (
        <div style={{ fontSize: 10, color: '#B0483C', marginBottom: 8 }}>
          Showing the 100 most-recent sessions (last 90 days max). Older sessions in this range may be omitted.
        </div>
      )}

      {/* Results */}
      {status === 'idle' && (
        <div style={{ fontSize: 12, color: '#8C8A85', padding: '4px 0' }}>Pick a date range and click Load to see every chat in that window.</div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 12, color: '#B0483C', padding: '4px 0' }}>Couldn't load queries ({error})</div>
      )}
      {status === 'loaded' && rows.length === 0 && (
        <div style={{ fontSize: 12, color: '#8C8A85', padding: '4px 0' }}>No chats in this date range.</div>
      )}
      {status === 'loaded' && rows.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 46px 70px 80px', gap: '0 8px', fontSize: 10 }}>
            {['Query', 'Date', 'Msgs', 'Customer', ''].map((h, i) => (
              <div key={i} style={{ position: 'sticky', top: 0, background: '#FFFFFF', fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 5, borderBottom: '1px solid #E0DDD6' }}>{h}</div>
            ))}
            {rows.map((r, i) => (
              <React.Fragment key={r.sessionId || i}>
                <div style={{ padding: '5px 0', borderBottom: '0.5px solid #F0EDE6', color: '#3D3226', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.query || ''}>
                  {r.query || '(no title)'}
                  {r.wasEscalated && <span style={{ color: '#B0483C', fontWeight: 600, marginLeft: 6 }}>escalated</span>}
                </div>
                <div style={{ padding: '5px 0', borderBottom: '0.5px solid #F0EDE6', color: '#5F5E5A', fontFamily: 'DM Mono, monospace' }}>
                  {r.ts ? new Date(r.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
                <div style={{ padding: '5px 0', borderBottom: '0.5px solid #F0EDE6', color: '#378ADD', fontWeight: 600, fontFamily: 'DM Mono, monospace', textAlign: 'right' }}>
                  {r.messageCount ?? ''}
                </div>
                <div style={{ padding: '5px 0', borderBottom: '0.5px solid #F0EDE6' }}>
                  {customerAdminUrl(r.customerId) ? (
                    <a href={customerAdminUrl(r.customerId)} target="_blank" rel="noreferrer" style={{ color: '#378ADD', fontWeight: 600, textDecoration: 'none', fontSize: 10 }}>Customer ↗</a>
                  ) : (
                    <span style={{ fontSize: 10, color: '#8C8A85' }}>guest</span>
                  )}
                </div>
                <div style={{ padding: '5px 0', borderBottom: '0.5px solid #F0EDE6' }}>
                  {r.sessionId && (
                    <button onClick={() => onViewChat(r.sessionId)} style={{ border: 'none', background: '#F0EDE6', color: '#3D3226', borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>View</button>
                  )}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
