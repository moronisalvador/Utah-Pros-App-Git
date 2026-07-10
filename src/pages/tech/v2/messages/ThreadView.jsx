/**
 * ════════════════════════════════════════════════
 * FILE: ThreadView.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One open conversation, full screen: a fixed top bar with a Back arrow and the
 *   person's name, the back-and-forth messages grouped under day headers, and the
 *   reply box pinned at the bottom. It opens already scrolled to the newest message,
 *   loads older messages as you scroll up (keeping your place), and shows a "jump to
 *   latest" pill with a count if new messages arrive while you're reading history.
 *   Sending, retrying, and live delivery ticks are all handled by the useThread engine.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (thread layer of the messaging pane)
 *   Rendered by:  src/pages/tech/v2/TechMessagesV2.jsx (keyed by conversation id)
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  ./useThread, ./msgsSelectors (groupMessagesByDay), ./msgDateUtils
 *              (dayLabel), @/components/conversations/MessageBubble, ./Composer
 *   Data:      via useThread — reads messages, writes through POST /api/send-message
 *
 * NOTES / GOTCHAS:
 *   - The scroller is owned by the pane host (TechMsgsPane) and forwarded here as
 *     `scrollRef`; this view drives pin-to-bottom, load-earlier anchoring, and the
 *     jump pill against it. Anchoring uses a scrollHeight snapshot in useLayoutEffect
 *     (pre-paint) — NO setTimeout.
 *   - The message container is a flex column so MessageBubble's align-self (inbound
 *     left / outbound right) resolves.
 * ════════════════════════════════════════════════
 */
import React, { useRef, useMemo, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import MessageBubble from '@/components/conversations/MessageBubble';
import { useThread } from './useThread';
import { groupMessagesByDay } from './msgsSelectors';
import { dayLabel } from './msgDateUtils';
import Composer from './Composer';

function IconBack(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="15 18 9 12 15 6" /></svg>);
}
function IconDown(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>);
}

function cleanName(s) { return (s || 'Unknown').replace(/\s*\[DEMO\]\s*/g, ''); }

export default function ThreadView({ convId, conv, active, onBack, scrollRef }) {
  const { t } = useTranslation('msgs');
  const {
    messages, isColdStart, hasMore, loadingEarlier, loadEarlier, error,
    sending, send, retry,
  } = useThread(convId, { active });

  const { employee } = useAuth();

  const [atBottom, setAtBottom] = useState(true);
  const [newInThread, setNewInThread] = useState(0);
  const atBottomRef = useRef(true);
  const prevLastId = useRef(undefined);
  const justOpened = useRef(true);
  const prependAnchor = useRef(null);
  const rootRef = useRef(null);

  // Keyboard lift (active-gated). Writes a PANE-SCOPED var on the nearest .tv2-msgs-pane
  // (never documentElement — legacy owns --conv-kb-offset); CSS consumes it as
  // padding-bottom on the thread layer only, shrinking the scroller so the sticky
  // composer rises above the on-screen keyboard. No layout jump, blur-safe.
  useEffect(() => {
    if (!active) return undefined;
    const vv = window.visualViewport;
    const pane = rootRef.current?.closest('.tv2-msgs-pane');
    if (!vv || !pane) return undefined;
    const onResize = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      pane.style.setProperty('--tv2-msgs-kb', `${offset > 80 ? offset : 0}px`);
      if (offset > 80 && atBottomRef.current) scrollToBottom(false);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      pane.style.removeProperty('--tv2-msgs-kb');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const contact = useMemo(() => {
    const parts = conv?.conversation_participants || [];
    const p = parts.find((x) => x.role === 'primary') || parts[0];
    return p?.contacts || null;
  }, [conv]);

  const items = useMemo(() => groupMessagesByDay(messages), [messages]);

  const scrollToBottom = useCallback((smooth) => {
    const el = scrollRef.current;
    if (!el) return;
    const go = () => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; };
    if (smooth && el.scrollTo) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else go();
    // A second frame catches late layout (image height) — rAF, never setTimeout.
    requestAnimationFrame(() => { if (!smooth) go(); });
  }, [scrollRef]);

  // Scroll handler: near-bottom tracking + auto load-earlier near the top (anchored).
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setNewInThread(0);
    if (el.scrollTop < 80 && hasMore && !loadingEarlier && prependAnchor.current == null) {
      prependAnchor.current = el.scrollHeight;
      loadEarlier();
    }
  }, [scrollRef, hasMore, loadingEarlier, loadEarlier]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, onScroll]);

  // Restore scroll position after older messages are prepended (pre-paint, no jump).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (prependAnchor.current != null && el) {
      el.scrollTop = el.scrollHeight - prependAnchor.current;
      prependAnchor.current = null;
      prevLastId.current = messages[messages.length - 1]?.id;
    }
  }, [messages, scrollRef]);

  // Tail growth: snap to bottom on open; follow new messages only if already at bottom,
  // else bump the jump-to-latest pill.
  useEffect(() => {
    if (prependAnchor.current != null) return;
    const lastId = messages[messages.length - 1]?.id;
    if (lastId === prevLastId.current) return;
    const firstPaint = prevLastId.current === undefined;
    prevLastId.current = lastId;
    if (justOpened.current || firstPaint) {
      justOpened.current = false;
      setNewInThread(0);
      scrollToBottom(false);
      return;
    }
    if (atBottomRef.current) { scrollToBottom(true); setNewInThread(0); }
    else setNewInThread((n) => n + 1);
  }, [messages, scrollToBottom]);

  const showLoader = isColdStart && messages.length === 0;

  return (
    <div className="tv2-msgs-thread" ref={rootRef}>
      {/* Fixed top bar (sticky inside the scroller). */}
      <header className="tv2-msgs-thread__bar">
        <button type="button" className="tv2-msgs-thread__back" aria-label={t('thread.back')} onClick={onBack}>
          <IconBack width={24} height={24} />
        </button>
        <div className="tv2-msgs-thread__title">{cleanName(conv?.title)}</div>
        <div className="tv2-msgs-thread__bar-spacer" aria-hidden="true" />
      </header>

      {/* Message body — flex column so bubble align-self resolves. */}
      <div className="tv2-msgs-thread__body">
        {showLoader ? (
          <div className="tv2-msgs-thread__loading">{t('states.loading')}</div>
        ) : error && messages.length === 0 ? (
          <div className="tv2-msgs-thread__empty">{t('states.error')}</div>
        ) : messages.length === 0 ? (
          <div className="tv2-msgs-thread__empty">{t('thread.empty')}</div>
        ) : (
          <>
            {hasMore && (
              <div className="tv2-msgs-thread__earlier">
                {loadingEarlier ? t('thread.loadingEarlier') : t('thread.loadEarlier')}
              </div>
            )}
            {items.map((item) => (item.type === 'day' ? (
              <div key={`day-${item.key}`} className="tv2-msgs-day">{dayLabel(item.key)}</div>
            ) : (
              <MessageBubble key={item.data._clientId || item.data.id} msg={item.data} onRetry={retry} />
            )))}
          </>
        )}
      </div>

      {/* Sticky foot: the jump pill floats above the composer; both stay pinned to the
          bottom of the scroller (sticky is the pill's positioning context). */}
      <div className="tv2-msgs-thread__foot">
        {!atBottom && newInThread > 0 && (
          <button type="button" className="tv2-msgs-jump" onClick={() => { scrollToBottom(true); setNewInThread(0); }}>
            <IconDown width={16} height={16} />
            {t('thread.newCount', { count: newInThread })}
          </button>
        )}
        <Composer
          convId={convId}
          contact={contact}
          employee={employee}
          onSend={send}
          sending={sending}
        />
      </div>
    </div>
  );
}
