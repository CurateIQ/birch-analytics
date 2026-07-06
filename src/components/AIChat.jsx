/**
 * AIChat.jsx — routes Claude API calls through birch-api-proxy Lambda.
 */

import React, { useState, useRef, useEffect } from 'react';
import { PROXY, PROXY_HEADERS } from '../api/proxy';

const SUGGESTIONS = [
  'What was the top selling brand this week?',
  'Which category is growing fastest?',
  'How is fulfillment time trending?',
  'What are our top returning customer metrics?',
  'Which brands have the highest return rates?',
];

function ChatContent({ dashboardData, onClose, isMobile }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I have access to your live Birch data from Shopify and Klaviyo. Ask me anything about orders, customers, brands, fulfillment, or any other metric." },
  ]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [showSugg, setShowSugg] = useState(true);
  const messagesEndRef          = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const buildSystem = () => {
    if (!dashboardData) return 'You are a business analytics assistant for Birch, a curated e-commerce marketplace for parents.';
    const d = dashboardData;
    return `You are a business analytics assistant for Birch, a curated e-commerce marketplace for parents (Millennial/Gen Z, 25-44).

CURRENT WEEK DATA:
- GMV: $${d.orders?.gmv?.toLocaleString()} (${d.orders?.gmvWoW > 0 ? '+' : ''}${d.orders?.gmvWoW}% WoW)
- Orders: ${d.orders?.orderCount}
- AOV: $${d.orders?.aov}
- Items/order: ${d.orders?.itemsPerOrder}
- Cancellation: ${d.orders?.cancellationRate}%
- Return rate: ${d.orders?.returnRate}%
- New customers: ${d.customers?.newCustomerCount}
- MAU: ${d.customers?.mau?.toLocaleString()}
- WAU: ${d.customers?.wau?.toLocaleString()}
- New vs returning: ${d.customers?.newOrdersPct}% / ${d.customers?.returningOrdersPct}%
- Total brands: ${d.marketplace?.totalBrands}
- Total SKUs: ${d.marketplace?.totalSKUs}
- Avg fulfillment: ${d.marketplace?.avgFulfillmentDays} days
- Email list: ${d.email?.totalListSize?.toLocaleString()}

TOP BRANDS BY GMV:
${(d.orders?.gmvByBrand || []).slice(0,10).map((b,i) => `${i+1}. ${b.brand}: $${b.gmv.toLocaleString()}`).join('\n')}

TOP CATEGORIES:
${(d.orders?.gmvByCategory || []).slice(0,8).map((c,i) => `${i+1}. ${c.category}: $${c.gmv.toLocaleString()}`).join('\n')}

Answer concisely using this data. Be direct and analytical.`;
  };

  const send = async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setShowSugg(false);
    setLoading(true);
    try {
      const res = await fetch(`${PROXY}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...PROXY_HEADERS },
        body: JSON.stringify({
          system: buildSystem(),
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
          source: 'dashboard',
        }),
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || 'Sorry, I could not get a response.';
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection error. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={{ padding:'12px 16px', borderBottom:'0.5px solid #E0DDD6', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600, color:'#3D3226', display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:'#7A9E7E', display:'inline-block' }} />
            Ask your data
          </div>
          <div style={{ fontSize:11, color:'#8C8A85', marginTop:2 }}>Powered by Claude · live Shopify + Klaviyo</div>
        </div>
        {isMobile && onClose && (
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:6, background:'#F4F2EC', border:'0.5px solid #E0DDD6', cursor:'pointer', fontSize:16, color:'#5F5E5A', display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        )}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column', gap:10 }}>
        {messages.map((msg, i) => (
          <div key={i}>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase', color: msg.role==='user' ? '#378ADD' : '#7A9E7E', marginBottom:3 }}>
              {msg.role === 'user' ? 'You' : 'Birch AI'}
            </div>
            <div style={{ fontSize:12.5, lineHeight:1.55, color:'#1A1A1A', background: msg.role==='user' ? '#FFFFFF' : '#F4F2EC', border:'0.5px solid #E0DDD6', borderRadius:8, padding:'8px 10px', whiteSpace:'pre-wrap' }}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.05em', textTransform:'uppercase', color:'#7A9E7E', marginBottom:3 }}>Birch AI</div>
            <div style={{ background:'#F4F2EC', border:'0.5px solid #E0DDD6', borderRadius:8, padding:'10px 12px', display:'flex', gap:4 }}>
              {[0,0.15,0.3].map((d,i) => <span key={i} style={{ width:5, height:5, borderRadius:'50%', background:'#7A9E7E', display:'inline-block', animation:`bounce 1s ${d}s infinite` }} />)}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {showSugg && (
        <div style={{ padding:'0 16px 8px', flexShrink:0 }}>
          <div style={{ fontSize:10, color:'#8C8A85', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>Try asking</div>
          {SUGGESTIONS.map((s,i) => (
            <button key={i} onClick={() => send(s)} style={{ display:'block', width:'100%', textAlign:'left', background:'#F4F2EC', border:'0.5px solid #E0DDD6', borderRadius:7, padding:'6px 10px', fontSize:12, color:'#5F5E5A', cursor:'pointer', marginBottom:4, fontFamily:'DM Sans,sans-serif' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding:'10px 16px 14px', borderTop:'0.5px solid #E0DDD6', display:'flex', gap:8, alignItems:'flex-end', flexShrink:0 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Ask a question about your data…"
          rows={1}
          style={{ flex:1, background:'#F4F2EC', border:'0.5px solid #E0DDD6', borderRadius:8, padding:'8px 10px', fontSize:13, color:'#1A1A1A', fontFamily:'DM Sans,sans-serif', resize:'none', minHeight:36, maxHeight:90, outline:'none', lineHeight:1.4 }}
          onFocus={e=>e.target.style.borderColor='#5A7A5C'}
          onBlur={e=>e.target.style.borderColor='#E0DDD6'}
        />
        <button onClick={() => send(input)} disabled={loading || !input.trim()}
          style={{ width:34, height:34, borderRadius:7, background: loading||!input.trim() ? '#E0DDD6' : '#3D3226', border:'none', cursor: loading||!input.trim() ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  );
}

export function AIChat({ dashboardData }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile]     = useState(window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!isMobile) {
    return (
      <div style={{ height:'100%', fontFamily:'DM Sans,sans-serif' }}>
        <ChatContent dashboardData={dashboardData} isMobile={false} />
      </div>
    );
  }

  return (
    <>
      {!mobileOpen && (
        <button onClick={() => setMobileOpen(true)} aria-label="Open AI chat"
          style={{ position:'fixed', bottom:24, right:20, zIndex:50, width:52, height:52, borderRadius:'50%', background:'#3D3226', border:'none', cursor:'pointer', boxShadow:'0 4px 16px rgba(61,50,38,0.35)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5F2EA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ position:'absolute', top:10, right:10, width:8, height:8, borderRadius:'50%', background:'#7A9E7E', border:'2px solid #3D3226' }} />
        </button>
      )}
      {mobileOpen && (
        <>
          <div onClick={() => setMobileOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(61,50,38,0.4)', zIndex:51 }} />
          <div style={{ position:'fixed', left:0, right:0, bottom:0, zIndex:52, height:'75vh', background:'#FFFFFF', borderRadius:'16px 16px 0 0', boxShadow:'0 -4px 24px rgba(61,50,38,0.15)', display:'flex', flexDirection:'column', fontFamily:'DM Sans,sans-serif' }}>
            <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 0' }}>
              <div style={{ width:36, height:4, borderRadius:99, background:'#E0DDD6' }} />
            </div>
            <ChatContent dashboardData={dashboardData} isMobile={true} onClose={() => setMobileOpen(false)} />
          </div>
        </>
      )}
      <style>{`@keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }`}</style>
    </>
  );
}
