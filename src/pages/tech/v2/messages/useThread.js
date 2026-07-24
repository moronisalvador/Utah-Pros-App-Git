/**
 * ════════════════════════════════════════════════
 * FILE: useThread.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The engine behind one open conversation. It loads the newest ~30 messages, loads
 *   older ones as you scroll up, and keeps the thread live: when a reply is delivered
 *   or read the little checkmarks update in place (no reload), and when a new text
 *   arrives it slides in. When YOU send, the bubble appears instantly as "Sending…"
 *   and then flips to Sent — or to Failed with a one-tap Retry if the contact opted out
 *   or the network dropped. It also marks the thread read the moment you open it. All
 *   sending goes through the server (POST /api/send-message) — the app never writes a
 *   text-message row itself.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (React hook)
 *   Rendered by:  src/pages/tech/v2/messages/ThreadView.jsx
 *
 * DEPENDS ON:
 *   Packages:  @tanstack/react-query, react
 *   Internal:  @/contexts/AuthContext (db), @/lib/realtime (subscribeToMessages,
 *              getAuthHeader), @/lib/techQuery (techKeys), ./msgsSelectors (pure
 *              cache/overlay math), @/components/conversations/messageUtils (parseMediaUrls)
 *   Data:      reads  → messages (thread pages)
 *              writes → conversations (unread_count=0 on open, via db.update — F-red
 *                       safe). Outbound SMS/notes go ONLY through POST /api/send-message
 *                       (the worker is the sole writer of any message row).
 *
 * NOTES / GOTCHAS:
 *   - OPTIMISTIC OVERLAY MODEL (challenge-mandated): render = React Query server pages
 *     + a pane-local `overlay` of not-yet-confirmed bubbles keyed by `_clientId`. A
 *     delivery-status UPDATE patches the cached row in place (ticks never refetch); an
 *     INSERT appends to the cache AND drops the reconciled overlay twin. Reconnect /
 *     suspend invalidates as the safety net.
 *   - The realtime subscription is gated on `active` (thread open + pane visible) so a
 *     backgrounded pane holds no socket; on return the suspend-recovery refetch closes
 *     any gap.
 *   - Mounted per conversation (ThreadView is keyed by convId), so `overlay` and
 *     `retryStore` reset naturally on a thread switch — no cross-thread bleed.
 * ════════════════════════════════════════════════
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToMessages, getAuthHeader } from '@/lib/realtime';
import { techKeys } from '@/lib/techQuery';
import {
  isRetryableMediaReference,
  parseMediaUrls,
} from '@/components/conversations/messageUtils';
import { impact } from '@/lib/nativeHaptics';
import {
  flattenThreadPages, nextThreadCursor, mergeOverlay, reconcileOverlay,
  appendMessageToPages, patchMessageInPages, markPendingByMatch, dropByClientId,
  failByClientId, summarizeSendResult,
} from './msgsSelectors';

const MSG_COLS = 'id,type,body,status,sent_by,sender_contact_id,media_urls,error_code,error_message,num_segments,created_at,employees(full_name)';
const PAGE = 30;

function emitToast(message, type = 'info') {
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));
}

// Human reason for a non-OK /api/send-message response (the four 403 codes + fallback).
function sendFailureReason(data, status) {
  switch (data.code) {
    case 'DND_ACTIVE': return 'Contact has Do Not Disturb on — message blocked';
    case 'NO_CONSENT': return 'Contact has not opted in to texts';
    case 'CONTACT_NOT_FOUND': return 'No valid contact on this conversation';
    case 'ALL_RECIPIENTS_BLOCKED': return 'Every recipient is blocked or opted out';
    default: return data.error || `Message not sent (${status})`;
  }
}

// Clear the unread badge for one conversation across every cached convos view + the
// global unread_total the Messages-tab badge reads. Keeps the badge honest instantly,
// before the server round-trip.
function clearConvoUnread(queryClient, convId) {
  queryClient.setQueriesData({ queryKey: ['tech', 'convos'] }, (data) => {
    if (!data || !Array.isArray(data.conversations)) return data;
    let delta = 0;
    const conversations = data.conversations.map((c) => {
      if (c.id !== convId) return c;
      delta = Number(c.unread_count) || 0;
      return delta ? { ...c, unread_count: 0 } : c;
    });
    if (!delta) return data;
    return { ...data, conversations, unread_total: Math.max(0, (Number(data.unread_total) || 0) - delta) };
  });
}

export function useThread(convId, { active = true } = {}) {
  const { db, employee } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!db && !!convId;

  const [overlay, setOverlay] = useState([]);   // optimistic bubbles for THIS conv
  const [sending, setSending] = useState(false);
  const retryStore = useRef({});                // clientId → { text, media_urls, isNote }
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // ─── SECTION: Data fetching (infinite, keyset by created_at) ──────────────
  const query = useInfiniteQuery({
    queryKey: techKeys.thread(convId),
    enabled,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const cursor = pageParam ? `&created_at=lt.${encodeURIComponent(pageParam)}` : '';
      const rows = await db.select(
        'messages',
        `conversation_id=eq.${convId}${cursor}&order=created_at.desc&limit=${PAGE}&select=${MSG_COLS}`,
      );
      return rows || [];
    },
    getNextPageParam: (lastPage) => nextThreadCursor(lastPage, PAGE),
    staleTime: 15_000,
  });

  const pages = query.data?.pages;
  const serverAsc = useMemo(() => flattenThreadPages(pages || []), [pages]);
  const messages = useMemo(() => mergeOverlay(serverAsc, overlay), [serverAsc, overlay]);

  // Patch the thread cache; return the SAME pages ref from `fn` to skip a needless notify.
  const setPages = useCallback((fn) => {
    queryClient.setQueryData(techKeys.thread(convId), (old) => {
      if (!old) return old;
      const nextPages = fn(old.pages);
      return nextPages === old.pages ? old : { ...old, pages: nextPages };
    });
  }, [queryClient, convId]);

  // ─── SECTION: Mark-read (on open + inbound-while-open desync guard) ──────────────
  const markRead = useCallback(async () => {
    if (!convId) return;
    clearConvoUnread(queryClient, convId);   // instant badge/row clear
    try { await db.update('conversations', `id=eq.${convId}`, { unread_count: 0 }); }
    catch (e) { console.error('Mark read error:', e); }
  }, [convId, db, queryClient]);

  // Mark read when the thread opens (and when the pane re-activates with it open, so a
  // thread opened while the pane was backgrounded still clears on return).
  useEffect(() => {
    if (enabled && active) markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, enabled, active]);

  // ─── SECTION: Realtime (active-gated) ──────────────
  useEffect(() => {
    if (!enabled || !active) return undefined;
    const unsub = subscribeToMessages(convId, (newMsg, eventType) => {
      if (eventType === 'update') {
        setPages((p) => patchMessageInPages(p, newMsg));   // delivery ticks — never refetch
        return;
      }
      // INSERT: append to cache (dedupe by id) + drop the reconciled optimistic twin.
      setPages((p) => appendMessageToPages(p, newMsg));
      setOverlay((o) => reconcileOverlay(o, newMsg));
      // Unread-desync guard: an inbound to the open+visible thread must stay read.
      if (newMsg.type === 'sms_inbound' && (typeof document === 'undefined' || document.visibilityState === 'visible')) {
        markRead();
      }
    });
    return unsub;
  }, [enabled, active, convId, setPages, markRead]);

  // ─── SECTION: Suspend / reconnect recovery (safety net) ──────────────
  // Capacitor suspends the webview and realtime dies silently; only after a real
  // hidden→visible transition do we invalidate the open thread (append-model reconciles).
  const wasHidden = useRef(false);
  useEffect(() => {
    if (!enabled || !active) return undefined;
    const onVis = () => {
      if (document.visibilityState === 'hidden') { wasHidden.current = true; return; }
      if (wasHidden.current) {
        wasHidden.current = false;
        queryClient.invalidateQueries({ queryKey: techKeys.thread(convId) });
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, active, convId, queryClient]);

  // ─── SECTION: Send (optimistic → POST → reconcile) ──────────────
  const dispatchSend = useCallback(async ({ clientId, text, media_urls, isNote }) => {
    setSending(true);
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          conversation_id: convId,
          body: text,
          sent_by: employee?.id || null,
          client_request_id: clientId,
          is_internal_note: isNote,
          ...(media_urls && media_urls.length ? { media_urls } : {}),
        }),
      });

      if (!res.ok) {
        let data = {};
        try { data = await res.json(); } catch { /* non-JSON error body */ }
        const reason = sendFailureReason(data, res.status);
        if (mounted.current) {
          setOverlay((o) => o.map((m) => (m._clientId === clientId
            ? { ...m, _pending: false, _failed: true, status: 'failed', error_message: reason, error_code: data.code || m.error_code }
            : m)));
        }
        setPages((p) => failByClientId(p, clientId, reason, data.code));   // carrier-retry row, if any
        emitToast(reason, 'error');
        return;
      }

      // 201 — but the row can still be a FAILED row (201 ≠ delivered); MessageBubble reads status.
      const data = await res.json();
      const real = data.message;
      if (real) {
        real.employees = employee ? { full_name: employee.full_name } : (real.employees || null);
        setPages((p) => appendMessageToPages(dropByClientId(p, clientId), real));
        if (mounted.current) setOverlay((o) => reconcileOverlay(o, real, clientId));
      }
      // Native "sent" tap (light) — only on a genuinely-accepted row, not a failed 201.
      if (real && real.status !== 'failed') impact('light');
      // Group / broadcast: surface a partial block ("Sent to 3 of 5 — 2 blocked") so a
      // tech knows some recipients were skipped for consent. Direct threads (twilio.length
      // ≤ 1) never trigger this — a blocked direct send already returns 403.
      const summary = summarizeSendResult(data.twilio);
      if (summary.total > 1 && (summary.blocked > 0 || summary.failed > 0)) {
        const missed = summary.blocked + summary.failed;
        emitToast(`Sent to ${summary.sent} of ${summary.total} — ${missed} not reached`, 'info');
      }
      delete retryStore.current[clientId];
    } catch (err) {
      console.error('Send error:', err);
      const reason = 'Network error — message not sent';
      if (mounted.current) {
        setOverlay((o) => o.map((m) => (m._clientId === clientId
          ? { ...m, _pending: false, _failed: true, status: 'failed', error_message: reason }
          : m)));
      }
      setPages((p) => failByClientId(p, clientId, reason, null));
      emitToast(reason, 'error');
    } finally {
      if (mounted.current) setSending(false);
    }
  }, [convId, employee, setPages]);

  // Public: send a new message (text and/or media, or an internal note).
  const send = useCallback(({ text, media_urls = [], isNote = false }) => {
    const body = (text || '').trim();
    // A photo can send with no caption (media-only MMS); a text or note still needs a body.
    if (!body && !(media_urls && media_urls.length)) return;
    const clientId = crypto.randomUUID();
    const optimistic = {
      id: clientId,
      _clientId: clientId,
      _pending: true,
      type: isNote ? 'internal_note' : 'sms_outbound',
      body,
      status: 'pending',
      media_urls: media_urls.length ? JSON.stringify(media_urls) : null,
      created_at: new Date().toISOString(),
      employees: employee ? { full_name: employee.full_name } : null,
    };
    retryStore.current[clientId] = { text: body, media_urls, isNote };
    setOverlay((o) => [...o, optimistic]);
    dispatchSend({ clientId, text: body, media_urls, isNote });
  }, [employee, dispatchSend]);

  // Public: retry a failed bubble — an optimistic overlay one (payload in retryStore)
  // OR a carrier-failed real row (reconstructed from the row, flipped in place).
  const retry = useCallback((msg) => {
    const stored = msg._clientId ? retryStore.current[msg._clientId] : null;
    const payload = stored || {
      text: msg.body || '',
      media_urls: parseMediaUrls(msg.media_urls).filter(isRetryableMediaReference),
      isNote: msg.type === 'internal_note',
    };
    if (!payload.text && !(payload.media_urls && payload.media_urls.length)) {
      emitToast('Cannot retry this message', 'error');
      return;
    }
    // Keep the id across a fetch-level retry; a persisted failed provider row
    // represents a completed attempt, so an explicit user retry gets a new id.
    const matchKey = msg._clientId || crypto.randomUUID();
    retryStore.current[matchKey] = payload;
    // Flip the exact bubble back to pending — overlay entry OR cache row.
    setOverlay((o) => o.map((m) => (m._clientId === msg._clientId
      ? { ...m, _clientId: matchKey, _pending: true, _failed: false, status: 'pending', error_message: null, error_code: null }
      : m)));
    setPages((p) => markPendingByMatch(p, matchKey, msg.id));
    dispatchSend({ clientId: matchKey, text: payload.text, media_urls: payload.media_urls, isNote: payload.isNote });
  }, [dispatchSend, setPages]);

  return {
    messages,
    isColdStart: query.isPending,      // no cached page yet → skeleton, never a spinner over content
    isFetching: query.isFetching,
    error: query.error,
    hasMore: !!query.hasNextPage,
    loadingEarlier: query.isFetchingNextPage,
    loadEarlier: query.fetchNextPage,
    refetch: query.refetch,
    sending,
    send,
    retry,
    markRead,
  };
}

export default useThread;
