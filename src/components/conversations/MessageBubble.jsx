/**
 * ════════════════════════════════════════════════
 * FILE: MessageBubble.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Draws a single message inside a conversation — the coloured chat bubble, any
 *   photo/file attachments on it, and the little line underneath showing the time
 *   and whether the text was sent, delivered, read, or failed. If a message failed
 *   to send it shows why and offers a one-tap "Retry". It only draws things; the
 *   parent screen decides what a retry actually does.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered by Conversations.jsx for every message in a thread)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./messageUtils (media parsing, linkify, failure classification)
 *   Data:      reads/writes → none (pure presentation)
 *
 * NOTES / GOTCHAS:
 *   - An optimistic (not-yet-confirmed) message carries `_pending: true` and a
 *     temporary `id` starting with "pending-"; a failed one carries `_failed: true`.
 *   - Attachments render as <img>; a broken/non-image URL falls back to a file link
 *     via per-item error state, so an auth-gated Twilio media URL degrades gracefully.
 * ════════════════════════════════════════════════
 */

import { useState } from 'react';
import {
  parseMediaUrls, isLikelyImageUrl, linkifyTokens, uiClassForMessage, failureReason,
} from './messageUtils';

function formatMsgTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── SECTION: Helpers — attachment item ──────────────

function MediaItem({ url }) {
  const [broken, setBroken] = useState(false);
  if (broken || !isLikelyImageUrl(url)) {
    return (
      <a className="conv-media-file" href={url} target="_blank" rel="noopener noreferrer">
        📎 View attachment
      </a>
    );
  }
  return (
    <a className="conv-media-thumb" href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="Attachment" loading="lazy" onError={() => setBroken(true)} />
    </a>
  );
}

// ─── SECTION: Helpers — delivery status affordance ──────────────

function IconCheckSingle() {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><polyline points="20 6 9 17 4 12" /></svg>);
}
function IconCheckDouble() {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="15" height="13"><polyline points="18 6 7 17 2 12" /><polyline points="22 6 11 17" /></svg>);
}

function StatusAffordance({ msg, onRetry }) {
  const status = msg.status;
  const failed = msg._failed || status === 'failed' || status === 'undelivered';

  if (failed) {
    return (
      <span className={`conv-status conv-status-failed uiclass-${uiClassForMessage(msg)}`}>
        <span className="conv-status-reason" title={failureReason(msg)}>Failed — {failureReason(msg)}</span>
        {onRetry && (
          <button type="button" className="conv-retry-btn" onClick={() => onRetry(msg)}>Retry</button>
        )}
      </span>
    );
  }
  if (msg._pending || status === 'pending') {
    return <span className="conv-status conv-status-pending"><span className="conv-status-spinner" /> Sending…</span>;
  }
  if (status === 'read') return <span className="conv-status conv-status-read"><IconCheckDouble /> Read</span>;
  if (status === 'delivered') return <span className="conv-status conv-status-delivered"><IconCheckDouble /> Delivered</span>;
  // queued / sent / received
  return <span className="conv-status conv-status-sent"><IconCheckSingle /> Sent</span>;
}

// ─── SECTION: Render ──────────────

export default function MessageBubble({ msg, onRetry }) {
  const isInbound = msg.type === 'sms_inbound' || msg.type === 'email_inbound';
  const isNote = msg.type === 'internal_note';
  const media = parseMediaUrls(msg.media_urls);
  const failed = msg._failed || msg.status === 'failed' || msg.status === 'undelivered';

  const cls = `message ${isInbound ? 'inbound' : isNote ? 'internal-note' : 'outbound'}`
    + (msg._pending ? ' is-pending' : '') + (failed ? ' is-failed' : '');

  const tokens = msg.body ? linkifyTokens(msg.body) : [];

  return (
    <div className={cls} data-msg-id={msg.id}>
      <div className="message-bubble">
        {isNote && <span className="msg-note-label">📝 {msg.employees?.full_name || 'Note'}</span>}
        {media.length > 0 && (
          <div className="conv-media-grid">
            {media.map((url, i) => <MediaItem key={i} url={url} />)}
          </div>
        )}
        {msg.body && (
          <span className="conv-msg-text">
            {tokens.map((t, i) => t.type === 'link'
              ? <a key={i} href={t.href} target="_blank" rel="noopener noreferrer" className="conv-msg-link">{t.value}</a>
              : <span key={i}>{t.value}</span>
            )}
          </span>
        )}
      </div>
      <div className="message-meta">
        <span>{formatMsgTime(msg.created_at)}</span>
        {!isInbound && !isNote && <StatusAffordance msg={msg} onRetry={onRetry} />}
      </div>
    </div>
  );
}
