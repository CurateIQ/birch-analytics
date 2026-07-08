/**
 * ChatTranscriptModal.jsx — full transcript of one Ask Birch session.
 * Fetches on open via the birch-api-proxy Lambda (/ai/session/:id), which
 * reads the birch-ai worker's D1 store. User/assistant turns only.
 */

import React, { useState, useEffect } from 'react';
import { PROXY, PROXY_HEADERS } from '../api/proxy';

const SHOPIFY_ADMIN = 'https://admin.shopify.com/store/birchstoreco';

export function customerAdminUrl(customerId) {
  return customerId ? `${SHOPIFY_ADMIN}/customers/${customerId}` : null;
}

export function ChatTranscriptModal({ sessionId, onClose }) {
  const [state, setState] = useState({ loading: true, error: null, session: null, messages: [] });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, session: null, messages: [] });
    fetch(`${PROXY}/ai/session/${encodeURIComponent(sessionId)}`, { headers: PROXY_HEADERS })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { if (!cancelled) setState({ loading: false, error: null, session: d.session, messages: d.messages || [] }); })
      .catch(e => { if (!cancelled) setState({ loading: false, error: e.message, session: null, messages: [] }); });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { loading, error, session, messages } = state;
  const custUrl = customerAdminUrl(session?.customer_id);

  function downloadTranscript() {
    if (!messages.length) return;
    const dateStr = session?.last_message_at
      ? new Date(session.last_message_at).toLocaleString('en-US',
          { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '';
    const who = session?.customer_id ? `customer ${session.customer_id}` : 'guest';
    const head = [
      'Ask Birch — Chat transcript',
      session?.intent_chip ? `Topic: ${session.intent_chip}` : null,
      dateStr ? `Date: ${dateStr}` : null,
      `Participant: ${who}`,
      session?.message_count != null ? `Messages: ${session.message_count}` : null,
      session?.was_escalated ? 'Escalated: yes' : null,
      `Session ID: ${sessionId}`,
      '',
      '─'.repeat(48),
      '',
    ].filter((l) => l != null);
    const body = messages.map((m) => {
      const t = m.ts ? new Date(m.ts).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }) : '';
      const speaker = m.role === 'user' ? 'Customer' : 'Birch';
      return `[${t}] ${speaker}:\n${m.content}\n`;
    });
    const text = head.concat(body).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ask-birch-chat_${sessionId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div
      onClick={onClose}
      style={{ position:'fixed', inset:0, background:'rgba(26,26,26,0.45)', zIndex:200,
               display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background:'#FFFFFF', border:'0.5px solid #E0DDD6', borderRadius:12,
                 width:'min(640px, 100%)', maxHeight:'82vh', display:'flex', flexDirection:'column',
                 boxShadow:'0 12px 40px rgba(26,26,26,0.18)', animation:'slideIn 0.15s ease' }}
      >
        {/* Header */}
        <div style={{ padding:'12px 16px', borderBottom:'1px solid #E0DDD6',
                      display:'flex', alignItems:'flex-start', gap:10 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'#3D3226', overflow:'hidden',
                          textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {session?.intent_chip || 'Chat session'}
            </div>
            <div style={{ fontSize:10, color:'#8C8A85', marginTop:3, display:'flex', gap:8, flexWrap:'wrap' }}>
              {session?.last_message_at && (
                <span>{new Date(session.last_message_at).toLocaleString('en-US',
                  { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
              )}
              {session && <span>{session.message_count} messages</span>}
              {session?.was_escalated ? (
                <span style={{ color:'#B0483C', fontWeight:600 }}>escalated</span>
              ) : null}
              {custUrl ? (
                <a href={custUrl} target="_blank" rel="noreferrer"
                   style={{ color:'#378ADD', fontWeight:600, textDecoration:'none' }}>
                  Customer profile ↗
                </a>
              ) : (
                <span>guest</span>
              )}
            </div>
          </div>
          <button onClick={downloadTranscript} disabled={loading || messages.length === 0}
            title="Download full conversation as a text file"
            style={{ border:'none', borderRadius:8, padding:'0 10px', height:26, fontSize:11, fontWeight:600,
                     fontFamily:'inherit', lineHeight:'26px', whiteSpace:'nowrap',
                     background: messages.length ? '#3D3226' : '#F0EDE6',
                     color: messages.length ? '#F7F5EF' : '#B8B5AE',
                     cursor: messages.length ? 'pointer' : 'default' }}>
            ⬇ Download
          </button>
          <button onClick={onClose}
            style={{ border:'none', background:'#F0EDE6', color:'#5F5E5A', borderRadius:8,
                     width:26, height:26, fontSize:14, cursor:'pointer', lineHeight:1 }}>
            ×
          </button>
        </div>

        {/* Messages */}
        <div style={{ overflowY:'auto', padding:'14px 16px', display:'flex',
                      flexDirection:'column', gap:8 }}>
          {loading && <div style={{ fontSize:12, color:'#8C8A85' }}>Loading transcript…</div>}
          {error && <div style={{ fontSize:12, color:'#B0483C' }}>Couldn't load transcript ({error})</div>}
          {!loading && !error && messages.length === 0 && (
            <div style={{ fontSize:12, color:'#8C8A85' }}>No messages in this session.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display:'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth:'82%', padding:'8px 11px', borderRadius:10, fontSize:12, lineHeight:1.45,
                whiteSpace:'pre-wrap', overflowWrap:'break-word',
                background: m.role === 'user' ? '#3D3226' : '#F0EDE6',
                color:      m.role === 'user' ? '#F7F5EF' : '#3D3226',
              }}>
                {m.content}
                <div style={{ fontSize:9, marginTop:4, opacity:0.55 }}>
                  {m.ts ? new Date(m.ts).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }) : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
