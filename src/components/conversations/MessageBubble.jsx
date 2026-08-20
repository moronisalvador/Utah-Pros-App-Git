/**
 * ════════════════════════════════════════════════
 * FILE: MessageBubble.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Draws a single message inside a conversation — the coloured chat bubble, any
 *   photo/file attachments on it, and the little line underneath showing the time
 *   and whether the text was sent, delivered, read, or failed. A quiet name above
 *   the bubble identifies every staff sender and each customer in a group chat.
 *   If a message failed to send it shows why and offers a one-tap "Retry".
 *
 * WHERE IT LIVES:
 *   Route:        n/a (rendered by Conversations.jsx for every message in a thread)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./messageUtils (media parsing, linkify, failure classification),
 *              @/hooks/useResumeRefetch (shared foreground-resume subscription)
 *   Data:      reads/writes → none (pure presentation)
 *
 * NOTES / GOTCHAS:
 *   - An optimistic (not-yet-confirmed) message carries `_pending: true` and a
 *     temporary `id` starting with "pending-"; a failed one carries `_failed: true`.
 *   - Attachments render inside fixed 220x200 boxes (identical size while the
 *     signed URL resolves, downloads, and after load — the thread never reflows)
 *     and open the shared tech Lightbox in-page instead of a new tab. A
 *     broken/non-image URL falls back to a file link via per-item error state,
 *     so an auth-gated Twilio media URL degrades gracefully.
 * ════════════════════════════════════════════════
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeResume } from '@/hooks/useResumeRefetch';
import { useSignedUrl } from '@/hooks/useSignedUrls';
import Lightbox from '../tech/Lightbox';
import {
  parseMediaUrls, isLikelyImageUrl, linkifyTokens, uiClassForMessage, failureReason,
  isAmbiguousSend, messageSenderName, legacyPublicJobFilesPath,
} from './messageUtils';

function formatMsgTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── SECTION: Helpers — attachment item ──────────────

const OWNED_MEDIA_PREFIX = 'upr-storage://message-attachments/';

// Fixed-footprint media box: identical size while the signed URL resolves,
// while the image downloads, and after it renders — the thread never reflows
// (owner-reported 2026-08-06: images collapsed for seconds, then resized the
// whole page). Inline styles because src/index.css sits at its byte ceiling.
const MEDIA_BOX_STYLE = {
  width: 220,
  maxWidth: '100%',
  height: 200,
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
  background: 'var(--bg-tertiary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
};
const MEDIA_PLACEHOLDER_STYLE = { ...MEDIA_BOX_STYLE, cursor: 'default' };
const MEDIA_IMG_STYLE = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

function usePrivateMediaUrl(messageId, index, reference, apiKey) {
  const isPrivate = reference.startsWith(OWNED_MEDIA_PREFIX);
  const [state, setState] = useState({ url: isPrivate ? null : reference, failed: false });

  useEffect(() => {
    if (!isPrivate) {
      setState({ url: reference, failed: false });
      return undefined;
    }
    if (!messageId || !apiKey) {
      setState({ url: null, failed: true });
      return undefined;
    }
    let active = true;
    let loading = false;
    let refreshTimer;
    const load = async () => {
      if (
        loading
        || (typeof document !== 'undefined' && document.hidden)
      ) return;
      loading = true;
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      try {
        const res = await fetch('/api/message-media-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ message_id: messageId, index }),
        });
        if (!res.ok) throw new Error('private media unavailable');
        const payload = await res.json();
        if (active) {
          setState({ url: payload.url, failed: false });
          refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            void load();
          }, Math.max(60, payload.expires_in - 60) * 1000);
        }
      } catch {
        if (active) setState({ url: null, failed: true });
      } finally {
        loading = false;
      }
    };
    const unsubscribeResume = (
      typeof document !== 'undefined'
      && typeof window !== 'undefined'
    ) ? subscribeResume({
        doc: document,
        win: window,
        getOnResume: () => load,
        getOnFocus: () => undefined,
        hiddenEdgeOnly: true,
      }) : undefined;
    void load();
    return () => {
      active = false;
      unsubscribeResume?.();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [apiKey, index, isPrivate, messageId, reference]);

  return { ...state, isPrivate };
}

function MediaItem({ url, messageId, index, apiKey, onMediaLayout, onOpen, onUrlReady }) {
  const [broken, setBroken] = useState(false);
  // Legacy public job-files media needs signing now that the bucket is private.
  // `useSignedUrl(null)` is a no-op, so this hook is unconditional and costs
  // nothing for the `upr-storage://` references that are the normal case.
  const legacyPath = legacyPublicJobFilesPath(url);
  const legacySigned = useSignedUrl(legacyPath);
  const privateMedia = usePrivateMediaUrl(messageId, index, url, apiKey);
  const resolvedUrl = legacyPath ? legacySigned.url : privateMedia.url;
  // The extension check runs against the ORIGINAL reference for both signed
  // shapes — a signed URL carries `?token=…`, which hides the `.jpg`.
  const displayable = !broken
    && isLikelyImageUrl(privateMedia.isPrivate || legacyPath ? url : resolvedUrl);
  useEffect(() => {
    if (resolvedUrl && displayable) onUrlReady?.(index, resolvedUrl);
  }, [displayable, index, onUrlReady, resolvedUrl]);
  const handleError = () => {
    setBroken(true);
    // Notify after React swaps the broken image for its file-link fallback.
    requestAnimationFrame(() => onMediaLayout?.());
  };
  if ((privateMedia.isPrivate || legacyPath) && !resolvedUrl) {
    return (
      <span
        className="conv-media-file"
        style={MEDIA_PLACEHOLDER_STYLE}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {privateMedia.failed ? '📎 Attachment unavailable' : 'Loading attachment…'}
      </span>
    );
  }
  if (!displayable) {
    return (
      <a className="conv-media-file" href={resolvedUrl} target="_blank" rel="noopener noreferrer">
        📎 View attachment
      </a>
    );
  }
  return (
    <button
      type="button"
      className="conv-media-thumb"
      style={MEDIA_BOX_STYLE}
      onClick={() => onOpen?.(index)}
      aria-label="View attachment full screen"
    >
      <img
        src={resolvedUrl}
        alt="Attachment"
        loading="lazy"
        decoding="async"
        style={MEDIA_IMG_STYLE}
        onLoad={onMediaLayout}
        onError={handleError}
      />
    </button>
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
  const ambiguous = isAmbiguousSend(msg);

  if (failed) {
    return (
      <span className={`conv-status conv-status-failed uiclass-${uiClassForMessage(msg)}`}>
        <span className="conv-status-reason" title={failureReason(msg)}>
          {ambiguous ? 'Awaiting provider confirmation' : `Failed — ${failureReason(msg)}`}
        </span>
        {onRetry && !ambiguous && (
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

export default function MessageBubble({
  msg,
  participants = [],
  isMultiConversation = false,
  onRetry,
  onMediaLayout,
}) {
  const { db } = useAuth();
  const isInbound = msg.type === 'sms_inbound' || msg.type === 'email_inbound';
  const isNote = msg.type === 'internal_note';
  const media = parseMediaUrls(msg.media_urls);
  const failed = msg._failed || msg.status === 'failed' || msg.status === 'undelivered';

  // In-page viewer for this message's images (owner-directed 2026-08-06 —
  // media used to open in a new tab). Indexes align 1:1 with `media`; each
  // MediaItem reports its resolved (possibly signed) URL as it becomes known.
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [galleryUrls, setGalleryUrls] = useState({});
  const handleUrlReady = useCallback((index, url) => {
    setGalleryUrls((previous) => (previous[index] === url ? previous : { ...previous, [index]: url }));
  }, []);

  const cls = `message ${isInbound ? 'inbound' : isNote ? 'internal-note' : 'outbound'}`
    + (msg._pending ? ' is-pending' : '') + (failed ? ' is-failed' : '');

  const tokens = msg.body ? linkifyTokens(msg.body) : [];
  const senderName = messageSenderName(msg, participants, isMultiConversation);

  return (
    <div className={cls} data-msg-id={msg.id}>
      {senderName && <div className="message-sender-name">{senderName}</div>}
      <div className="message-bubble">
        {isNote && <span className="msg-note-label">📝 {msg.employees?.full_name || 'Note'}</span>}
        {media.length > 0 && (
          <div className="conv-media-grid">
            {media.map((url, i) => (
              <MediaItem
                key={i}
                url={url}
                messageId={msg.id}
                index={i}
                apiKey={db?.apiKey}
                onMediaLayout={onMediaLayout}
                onOpen={setLightboxIndex}
                onUrlReady={handleUrlReady}
              />
            ))}
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
      {lightboxIndex != null && media.length > 0 && (
        <Lightbox
          photos={media.map((raw, i) => ({ file_path: galleryUrls[i] || null, name: 'Attachment' }))}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndex={setLightboxIndex}
          db={db}
        />
      )}
    </div>
  );
}
