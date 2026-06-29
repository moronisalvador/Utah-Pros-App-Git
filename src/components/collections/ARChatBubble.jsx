/**
 * ════════════════════════════════════════════════
 * FILE: ARChatBubble.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The floating "A/R Copilot" chat button + panel on the Collections A/R screen. Tap
 *   the bubble in the corner to open a small chat. It already knows the numbers on your
 *   screen (it builds a quick summary of your outstanding invoices and aging every time
 *   you send a message), so it can answer things like "who should I call first", find a
 *   customer's phone number, or explain why an invoice is the amount it is — fast. It
 *   only ADVISES; it never sends anything or changes any record. The chat clears when you
 *   close it (nothing is saved).
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /collections (the A/R · Outstanding tab)
 *   Rendered by:  src/components/collections/ARDashboard.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./arSnapshot (buildArSnapshot), ./collTokens (palette),
 *              @/lib/realtime (getAuthHeader)
 *   Data:      reads  → none directly (operates on rows passed in by ARDashboard;
 *                       the AI worker reads invoices/payments/contacts server-side)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Calls the Cloudflare Pages Function POST /api/collections-chat. That endpoint only
 *     exists under the Pages runtime (deploy / `wrangler pages dev`), NOT the bare Vite
 *     dev server — the panel/snapshot render locally, but a live reply needs the deploy.
 *   - The panel does NOT block the page (no backdrop) so the user can scroll/filter the
 *     A/R table while chatting — that live view is exactly what the AI is reading.
 *   - `hidden` is set true while a New-invoice/estimate modal is open so the bubble
 *     (z-index 80/90) doesn't sit under / fight the modal (z-index 200).
 *   - formatText also turns phone numbers / emails in the AI's reply into tap-to-call /
 *     mailto links (a convenience for reaching people — it never sends anything).
 * ════════════════════════════════════════════════
 */

import { useState, useEffect, useRef } from 'react';
import { STATUS } from './collTokens';
import { buildArSnapshot } from './arSnapshot';
import { getAuthHeader } from '@/lib/realtime';

// ─── SECTION: Helpers ──────────────
// Linkify phone numbers + emails the assistant already wrote, so they're tappable on mobile.
const LINK_RE = /([^\s@]+@[^\s@]+\.[a-z]{2,})|((?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/gi;
function linkify(text, kp) {
  const out = [];
  let last = 0, idx = 0, m;
  const re = new RegExp(LINK_RE);
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`${kp}t${idx}`}>{text.slice(last, m.index)}</span>);
    const val = m[0];
    if (m[1]) out.push(<a key={`${kp}l${idx}`} className="coll-chat-link" href={`mailto:${val}`}>{val}</a>);
    else out.push(<a key={`${kp}l${idx}`} className="coll-chat-link" href={`tel:${val.replace(/[^\d+]/g, '')}`}>{val}</a>);
    last = m.index + val.length; idx += 1;
  }
  if (last < text.length) out.push(<span key={`${kp}t${idx}`}>{text.slice(last)}</span>);
  return out;
}

// Tiny markdown-ish formatter: **bold** spans + tap-to-call/mailto links; line breaks via CSS.
function formatText(text) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/g).map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**')) return <b key={i}>{seg.slice(2, -2)}</b>;
    return <span key={i}>{linkify(seg, i)}</span>;
  });
}

const SUGGESTIONS = [
  'Who should I call first?',
  'What’s overdue and by how much?',
  'Show me everything 90+ days',
  'Any invoices failing to sync to QuickBooks?',
  'What’s the number for my biggest overdue account?',
];

function ChatGlyph({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" />
      <path d="M8.5 11.5h7M8.5 8.5h4" />
    </svg>
  );
}
function CloseGlyph({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

// ─── SECTION: Component ──────────────
export default function ARChatBubble({ rows = [], filteredRows = [], today, viewState = {}, hidden = false }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollRef = useRef(null);

  // Keep the log pinned to the newest message.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, open]);

  // ─── SECTION: Event handlers ──────────────
  const send = async (text) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setError(''); setInput(''); setConfirmClear(false);
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setBusy(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 95000);
    try {
      // Build the live snapshot from the rows currently on screen — zero extra fetches.
      const snapshot = buildArSnapshot({ rows, filteredRows, today, viewState });
      const auth = await getAuthHeader();
      const res = await fetch('/api/collections-chat', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, snapshot }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setError(e.name === 'AbortError'
        ? 'That took too long — try a narrower question.'
        : (e.message || 'Something went wrong — try again.'));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  // Two-click clear (no native confirm, per the design rules): first click arms, second clears.
  const clearChat = () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    setMessages([]); setError(''); setConfirmClear(false);
  };

  if (hidden) return null;

  // ─── SECTION: Render ──────────────
  return (
    <>
      <button type="button" className={`coll-chat-fab${open ? ' open' : ''}`} aria-label="A/R Copilot" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        {open ? <CloseGlyph /> : <ChatGlyph />}
      </button>

      {open && (
        <div className="coll-chat-panel" role="dialog" aria-label="A/R Copilot">
          <div className="coll-chat-head">
            <div className="coll-chat-title"><span className="coll-chat-dot" />A/R Copilot</div>
            <div className="coll-chat-headbtns">
              <button type="button" className="coll-chat-headbtn" onClick={clearChat} onBlur={() => setConfirmClear(false)}
                disabled={!messages.length} style={confirmClear ? { color: STATUS.danger.text, fontWeight: 700 } : undefined}>
                {confirmClear ? 'Clear?' : 'Clear'}
              </button>
              <button type="button" className="coll-chat-headbtn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
          </div>

          <div ref={scrollRef} className="coll-chat-log">
            {messages.length === 0 && (
              <div className="coll-chat-intro">
                <p className="coll-chat-introtext">
                  Ask about what’s on your A/R screen — totals, aging, who to call first, a customer’s
                  number, or why an invoice is what it is. I read your live numbers; I advise, I don’t send.
                </p>
                <div className="coll-chat-chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="coll-chip" onClick={() => send(s)} disabled={busy}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`coll-chat-msg ${m.role === 'user' ? 'coll-chat-user' : 'coll-chat-ai'}`}>
                {m.role === 'user' ? m.content : formatText(m.content)}
              </div>
            ))}
            {busy && <div className="coll-chat-msg coll-chat-ai coll-chat-think">thinking…</div>}
          </div>

          {error && <div className="coll-chat-err">{error}</div>}

          <div className="coll-chat-composer">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Ask about your A/R…" rows={1} className="coll-chat-input" />
            <button type="button" className="coll-chat-send" onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
          </div>
          <div className="coll-chat-foot">Reads your on-screen A/R · advisory only · Enter to send</div>
        </div>
      )}
    </>
  );
}
