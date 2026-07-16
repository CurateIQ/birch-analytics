/**
 * QueryExport.jsx — browse & download all Ask Birch chat sessions within a
 * chosen date range. Nothing loads by default: the user picks From/To and
 * clicks Load, which fetches the /ai/queries proxy endpoint.
 *
 * Pagination: the worker returns at most one 100-row page per request, ordered
 * newest-first, with an `offset` param. "Load more" fetches the next page
 * (offset += 100) and appends, so the user can page past the first 100 into
 * older sessions. We keep pulling until the worker reports no more pages or
 * the oldest returned row falls before the From date.
 *
 * The only remaining limit is the analytics endpoint's 90-day query window —
 * a cap on how far back THIS dashboard list looks, NOT data retention. Chats
 * are kept indefinitely in D1 and any session stays viewable by id (via the
 * "View chat" transcript), regardless of age.
 *
 * The accumulated rows are then paged 25-at-a-time client-side for display;
 * Download CSV exports the full accumulated set, minus any excluded customers.
 *
 * Exclusions: the user can hide specific customers (e.g. staff/test accounts)
 * by customer id. Excluded ids are applied client-side over the accumulated
 * rows — they drop out of the table, the count, and the CSV — and persist to
 * localStorage so the same accounts stay filtered across reloads. Guests (no
 * customer id) can't be individually excluded.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { PROXY, PROXY_HEADERS } from '../api/proxy';
import { customerAdminUrl } from './ChatTranscriptModal';

const MAX_DAYS = 90;
const BATCH = 100;      // rows per worker request (server cap)
const PAGE_SIZE = 25;   // rows per client-side display page
const DAY_MS = 24 * 60 * 60 * 1000;
const EXCLUDE_KEY = 'birch:chatExcludedCustomers';

// Excluded customer ids persisted across sessions.
function loadExcluded() {
  try {
    const arr = JSON.parse(localStorage.getItem(EXCLUDE_KEY) || '[]');
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch { return []; }
}

// Split a free-text field into distinct customer ids (comma/space/newline sep).
function parseIds(text) {
  return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

// yyyy-mm-dd for <input type="date">
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 3);
  return { from: isoDate(from), to: isoDate(to) };
}

// Start-of-day (local) for `from`, end-of-day for `to`, as epoch ms.
function rangeBounds(fromStr, toStr) {
  const fromMs = new Date(`${fromStr}T00:00:00`).getTime();
  const toMs = new Date(`${toStr}T23:59:59.999`).getTime();
  return { fromMs, toMs };
}

// Merge a new batch into the accumulated rows, de-duping by session and
// keeping the list sorted newest-first.
function mergeRows(prev, next) {
  const seen = new Set(prev.map((r) => r.sessionId));
  const merged = prev.slice();
  for (const r of next) {
    if (!seen.has(r.sessionId)) { seen.add(r.sessionId); merged.push(r); }
  }
  merged.sort((a, b) => b.ts - a.ts);
  return merged;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function QueryExport({ onViewChat }) {
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [state, setState] = useState({
    status: 'idle',      // idle | loading | loaded | error
    rows: null,
    error: null,
    hasMore: false,      // another server page exists within the range
    nextOffset: 0,       // offset to request on the next "Load more"
    capped: false,       // From date is older than the 90-day worker window
    loadingMore: false,
  });
  const [page, setPage] = useState(0);
  const [excluded, setExcluded] = useState(loadExcluded);
  const [exInput, setExInput] = useState('');
  const excludedSet = useMemo(() => new Set(excluded), [excluded]);

  useEffect(() => {
    try { localStorage.setItem(EXCLUDE_KEY, JSON.stringify(excluded)); } catch { /* ignore */ }
  }, [excluded]);

  function addExcluded(ids) {
    const list = Array.isArray(ids) ? ids.map(String) : parseIds(String(ids));
    if (!list.length) return;
    setExcluded((prev) => Array.from(new Set([...prev, ...list])));
    setPage(0);
  }
  function removeExcluded(id) {
    setExcluded((prev) => prev.filter((x) => x !== String(id)));
  }

  // Fetch one worker page at `offset`; returns rows filtered to [from, to]
  // plus whether older in-range pages remain.
  async function fetchBatch(offset) {
    const { fromMs, toMs } = rangeBounds(from, to);
    const daysBack = Math.ceil((Date.now() - fromMs) / DAY_MS);
    const days = Math.min(MAX_DAYS, Math.max(1, daysBack));
    const capped = daysBack > MAX_DAYS;

    const res = await fetch(`${PROXY}/ai/queries?days=${days}&limit=${BATCH}&offset=${offset}`, { headers: PROXY_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const batch = data.recent || [];

    const inRange = batch.filter((r) => r.ts != null && r.ts >= fromMs && r.ts <= toMs);
    // batch is newest-first, so its last element is the oldest.
    const oldestTs = batch.length ? batch[batch.length - 1].ts : null;
    // Stop once we've paged older than From (all further rows are out of range).
    const withinFrom = oldestTs == null || oldestTs >= fromMs;
    const serverMore = data.hasMore != null ? data.hasMore : batch.length === BATCH;
    return { inRange, hasMore: serverMore && withinFrom, capped };
  }

  async function load() {
    if (!from || !to) return;
    if (from > to) {
      setState((s) => ({ ...s, status: 'error', rows: null, error: 'From date is after To date.' }));
      return;
    }
    setPage(0);
    setState({ status: 'loading', rows: null, error: null, hasMore: false, nextOffset: 0, capped: false, loadingMore: false });
    try {
      const { inRange, hasMore, capped } = await fetchBatch(0);
      setState({ status: 'loaded', rows: inRange, error: null, hasMore, nextOffset: BATCH, capped, loadingMore: false });
    } catch (e) {
      setState({ status: 'error', rows: null, error: e.message, hasMore: false, nextOffset: 0, capped: false, loadingMore: false });
    }
  }

  async function loadMore() {
    if (state.status !== 'loaded' || !state.hasMore || state.loadingMore) return;
    const offset = state.nextOffset;
    setState((s) => ({ ...s, loadingMore: true }));
    try {
      const { inRange, hasMore, capped } = await fetchBatch(offset);
      setState((s) => ({
        ...s,
        rows: mergeRows(s.rows || [], inRange),
        hasMore,
        nextOffset: offset + BATCH,
        capped: s.capped || capped,
        loadingMore: false,
      }));
    } catch (e) {
      setState((s) => ({ ...s, loadingMore: false, error: e.message }));
    }
  }

  function downloadCsv() {
    const rows = (state.rows || []).filter(
      (r) => !(r.customerId != null && excludedSet.has(String(r.customerId)))
    );
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

  const { status, rows, error, hasMore, capped, loadingMore } = state;
  const allRows = rows || [];
  const visibleRows = excludedSet.size
    ? allRows.filter((r) => !(r.customerId != null && excludedSet.has(String(r.customerId))))
    : allRows;
  const totalRows = visibleRows.length;
  const hiddenCount = allRows.length - totalRows;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const pageStart = curPage * PAGE_SIZE;
  const pageRows = visibleRows.slice(pageStart, pageStart + PAGE_SIZE);
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
              {totalRows}{hasMore ? '+' : ''} {totalRows === 1 ? 'session' : 'sessions'} loaded
            </span>
            <button onClick={downloadCsv} disabled={totalRows === 0} style={btnStyle(false)}>
              ⬇ Download CSV
            </button>
          </>
        )}
      </div>

      {/* Customer exclusion filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: excluded.length ? 6 : 8 }}>
        <span style={{ fontSize: 10, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Exclude customers</span>
        <input
          type="text"
          value={exInput}
          onChange={(e) => setExInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { addExcluded(exInput); setExInput(''); } }}
          placeholder="Customer ID(s)…"
          style={{ ...inputStyle, width: 150 }}
        />
        <button onClick={() => { addExcluded(exInput); setExInput(''); }} disabled={!exInput.trim()} style={btnStyle(false)}>Add</button>
        {excluded.length > 0 && (
          <button onClick={() => setExcluded([])} style={{ ...btnStyle(false), background: 'transparent', color: '#8C8A85' }}>Clear all</button>
        )}
        {hiddenCount > 0 && status === 'loaded' && (
          <span style={{ fontSize: 10, color: '#8C8A85' }}>{hiddenCount} hidden</span>
        )}
      </div>

      {excluded.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {excluded.map((id) => (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, background: '#F0EDE6', color: '#3D3226', borderRadius: 99, padding: '2px 4px 2px 9px', fontFamily: 'DM Mono, monospace' }}>
              {id}
              <button onClick={() => removeExcluded(id)} title="Stop excluding" style={{ border: 'none', background: '#E0DDD6', color: '#5F5E5A', borderRadius: 99, width: 14, height: 14, lineHeight: '14px', fontSize: 11, cursor: 'pointer', padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {capped && status === 'loaded' && (
        <div style={{ fontSize: 10, color: '#B0483C', marginBottom: 8 }}>
          This list only reaches back 90 days, so chats before that won't appear here.
        </div>
      )}

      {/* Results */}
      {status === 'idle' && (
        <div style={{ fontSize: 12, color: '#8C8A85', padding: '4px 0' }}>Pick a date range and click Load to see every chat in that window.</div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 12, color: '#B0483C', padding: '4px 0' }}>Couldn't load queries ({error})</div>
      )}
      {status === 'loaded' && totalRows === 0 && (
        <div style={{ fontSize: 12, color: '#8C8A85', padding: '4px 0' }}>No chats in this date range.</div>
      )}
      {status === 'loaded' && totalRows > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 46px 70px 80px', gap: '0 8px', fontSize: 10 }}>
            {['Query', 'Date', 'Msgs', 'Customer', ''].map((h, i) => (
              <div key={i} style={{ position: 'sticky', top: 0, background: '#FFFFFF', fontWeight: 700, color: '#8C8A85', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: 5, borderBottom: '1px solid #E0DDD6' }}>{h}</div>
            ))}
            {pageRows.map((r, i) => (
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
                <div style={{ padding: '5px 0', borderBottom: '0.5px solid #F0EDE6', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {customerAdminUrl(r.customerId) ? (
                    <>
                      <a href={customerAdminUrl(r.customerId)} target="_blank" rel="noreferrer" style={{ color: '#378ADD', fontWeight: 600, textDecoration: 'none', fontSize: 10 }}>Customer ↗</a>
                      <button onClick={() => addExcluded(String(r.customerId))} title={`Exclude customer ${r.customerId}`} style={{ border: 'none', background: 'transparent', color: '#B8B5AE', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}>×</button>
                    </>
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

      {/* Pager + Load more */}
      {status === 'loaded' && totalRows > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
          {totalRows > PAGE_SIZE && (
            <>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={curPage === 0} style={pagerBtnStyle(curPage === 0)}>← Prev</button>
              <span style={{ fontSize: 10, color: '#5F5E5A', fontFamily: 'DM Mono, monospace' }}>
                {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, totalRows)} of {totalRows} · page {curPage + 1}/{pageCount}
              </span>
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={curPage >= pageCount - 1} style={pagerBtnStyle(curPage >= pageCount - 1)}>Next →</button>
            </>
          )}
          {hasMore && (
            <button onClick={loadMore} disabled={loadingMore} style={{ ...btnStyle(false), marginLeft: 'auto' }}>
              {loadingMore ? 'Loading…' : `Load more (next ${BATCH})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function pagerBtnStyle(disabled) {
  return {
    border: '0.5px solid #E0DDD6', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
    fontFamily: 'inherit', background: '#FFFFFF', color: disabled ? '#C4C1BA' : '#3D3226',
    cursor: disabled ? 'default' : 'pointer',
  };
}
