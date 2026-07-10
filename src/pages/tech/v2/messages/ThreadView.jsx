/**
 * ════════════════════════════════════════════════
 * FILE: ThreadView.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One open conversation, full screen: a fixed top bar with a Back arrow and the
 *   person's name (tap it to see phone, Do-Not-Disturb state, and a chip that jumps to
 *   the linked job), the back-and-forth messages grouped under day headers, and the
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
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  ./useThread, ./msgsSelectors (groupMessagesByDay, isMultiConversation,
 *              recipientCount), ./msgDateUtils (dayLabel),
 *              @/components/conversations/MessageBubble, @/components/tech/v2/nav
 *              (jobHref — NEVER a hardcoded /tech path, H3-safe), ./Composer
 *   Data:      via useThread — reads messages, writes through POST /api/send-message
 *
 * NOTES / GOTCHAS:
 *   - The scroller is owned by the pane host (TechMsgsPane) and forwarded here as
 *     `scrollRef`; anchoring uses a scrollHeight snapshot in useLayoutEffect (pre-paint)
 *     — NO setTimeout.
 *   - Scrolling UP dismisses the keyboard (blurs the composer) — a native reading gesture.
 *   - The job chip links via jobHref() so the later Job-Hub cutover (M2/H3) retargets it
 *     without a code change here.
 *   - DND is one-tap ON only (techs); turning it OFF is office/admin-only, so no OFF
 *     control is rendered — a DND-on thread shows a read-only state.
 * ════════════════════════════════════════════════
 */
import React, { useRef, useMemo, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import MessageBubble from '@/components/conversations/MessageBubble';
import { jobHref } from '@/components/tech/v2/nav';
import { useThread } from './useThread';
import { groupMessagesByDay, isMultiConversation, recipientCount } from './msgsSelectors';
import { dayLabel } from './msgDateUtils';
import Composer from './Composer';

function IconBack(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="15 18 9 12 15 6" /></svg>);
}
function IconDown(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>);
}
function IconChevron(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="6 9 12 15 18 9" /></svg>);
}
function IconBriefcase(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>);
}
function IconMute(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M18.63 13A17.89 17.89 0 0 1 18 8" /><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" /><path d="M18 8a6 6 0 0 0-9.33-5" /><line x1="1" y1="1" x2="23" y2="23" /></svg>);
}

function cleanName(s) { return (s || 'Unknown').replace(/\s*\[DEMO\]\s*/g, ''); }

export default function ThreadView({ convId, conv, active, onBack, onEnableDnd, scrollRef }) {
  const { t } = useTranslation('msgs');
  const {
    messages, isColdStart, hasMore, loadingEarlier, loadEarlier, error, refetch,
    sending, send, retry,
  } = useThread(convId, { active });

  const { employee } = useAuth();

  const [atBottom, setAtBottom] = useState(true);
  const [newInThread, setNewInThread] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const atBottomRef = useRef(true);
  const prevLastId = useRef(undefined);
  const justOpened = useRef(true);
  const prependAnchor = useRef(null);
  const lastScrollTop = useRef(0);
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
      // Distance from the layout-viewport bottom up to the visual-viewport bottom = the
      // occluded strip (keyboard, and/or just the input-accessory bar when iOS resizes
      // the layout viewport). Lifting the composer by it lands it flush above whatever
      // is occluding — matching the visual viewport bottom in BOTH WKWebView modes.
      // Threshold is a small jitter guard only (accessory bar alone is ~45px, so it must
      // stay below that) — NOT the 80px "is the full keyboard up" gate.
      const raw = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const offset = raw > 24 ? raw : 0;
      pane.style.setProperty('--tv2-msgs-kb', `${offset}px`);
      if (offset > 0 && atBottomRef.current) scrollToBottom(false);
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

  const isMulti = isMultiConversation(conv);
  const contact = useMemo(() => {
    const parts = conv?.conversation_participants || [];
    const p = parts.find((x) => x.role === 'primary') || parts[0];
    return p?.contacts || null;
  }, [conv]);
  const contactPhone = contact?.phone || conv?.conversation_participants?.[0]?.phone || '';

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

  // Scroll handler: near-bottom tracking + auto load-earlier near the top (anchored) +
  // dismiss the keyboard when the tech scrolls UP to read history.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setNewInThread(0);
    // Blur-on-scroll-up: an upward drag past a small threshold dismisses the keyboard.
    if (el.scrollTop < lastScrollTop.current - 24) {
      const ae = document.activeElement;
      if (ae && typeof ae.blur === 'function' && ae.tagName === 'TEXTAREA') ae.blur();
    }
    lastScrollTop.current = el.scrollTop;
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
  const dnd = !!contact?.dnd;

  const onDndTap = () => {
    if (!contact?.id || dnd) return;
    onEnableDnd?.(contact.id, contactPhone);
  };

  return (
    <div className="tv2-msgs-thread-shell" ref={rootRef}>
      {/* Own scroller: sticky header + messages. The composer is docked OUTSIDE this
          scroller (a flex sibling below) so it lands flush above the keyboard without a
          sticky-in-momentum-scroll foot — the iOS combo that left a white gap (bake
          report 2026-07-10). */}
      <div className="tv2-msgs-scroll tv2-msgs-thread-scroll" ref={scrollRef}>
        <div className="tv2-msgs-thread">
      {/* Fixed top bar (sticky inside the scroller). Title toggles the info panel. */}
      <header className="tv2-msgs-thread__bar">
        <button type="button" className="tv2-msgs-thread__back" aria-label={t('thread.back')} onClick={onBack}>
          <IconBack width={24} height={24} />
        </button>
        <button
          type="button"
          className="tv2-msgs-thread__titlebtn"
          aria-expanded={showInfo}
          onClick={() => setShowInfo((v) => !v)}
        >
          <span className="tv2-msgs-thread__title">{cleanName(conv?.title)}</span>
          <span className="tv2-msgs-thread__subline">
            {isMulti && (
              <span className="tv2-msgs-typebadge">
                {t(`thread.type.${conv.type}`)} · {t('thread.recipients', { count: recipientCount(conv) })}
              </span>
            )}
            {dnd && <span className="tv2-msgs-dndchip"><IconMute width={11} height={11} /> {t('thread.dndOn')}</span>}
            <IconChevron className={`tv2-msgs-thread__caret${showInfo ? ' open' : ''}`} width={14} height={14} />
          </span>
        </button>
        <div className="tv2-msgs-thread__bar-spacer" aria-hidden="true" />
      </header>

      {/* Info panel — phone, DND, linked-job chip. Inline expandable (no modal). */}
      {showInfo && (
        <div className="tv2-msgs-info">
          {contactPhone && (
            <a className="tv2-msgs-info__row" href={`tel:${contactPhone}`}>
              <span className="tv2-msgs-info__label">{t('info.phone')}</span>
              <span className="tv2-msgs-info__value">{contactPhone}</span>
            </a>
          )}
          {isMulti && (
            <div className="tv2-msgs-info__row">
              <span className="tv2-msgs-info__label">{t(`thread.type.${conv.type}`)}</span>
              <span className="tv2-msgs-info__value">{t('thread.recipients', { count: recipientCount(conv) })}</span>
            </div>
          )}
          {conv?.job_id && (
            <Link className="tv2-msgs-info__chip" to={jobHref(conv.job_id)}>
              <IconBriefcase width={16} height={16} />
              {t('info.viewJob')}
            </Link>
          )}
          {!isMulti && contact?.id && (
            dnd ? (
              <div className="tv2-msgs-info__dnd on"><IconMute width={16} height={16} /> {t('info.dndOnState')}</div>
            ) : (
              <button type="button" className="tv2-msgs-info__dnd" onClick={onDndTap}>
                <IconMute width={16} height={16} /> {t('info.enableDnd')}
              </button>
            )
          )}
        </div>
      )}

      {/* Message body — flex column so bubble align-self resolves. */}
      <div className="tv2-msgs-thread__body">
        {showLoader ? (
          <div className="tv2-msgs-thread__loading">{t('states.loading')}</div>
        ) : error && messages.length === 0 ? (
          <div className="tv2-msgs-thread__error">
            <div className="tv2-msgs-thread__empty">{t('states.error')}</div>
            <button type="button" className="tv2-msgs-retry-btn" onClick={() => refetch()}>{t('states.retry')}</button>
          </div>
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

        </div>{/* .tv2-msgs-thread */}
      </div>{/* .tv2-msgs-thread-scroll — messages scroll; composer is docked below */}

      {/* Docked foot (OUTSIDE the scroller): the composer sits flush above the keyboard
          and the jump pill floats above it (the foot is the pill's positioning context). */}
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
