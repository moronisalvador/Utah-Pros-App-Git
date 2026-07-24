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
 *     `scrollRef`; a first-visible message anchor survives prepends and delayed media
 *     layout, and opening snaps pre-paint — NO setTimeout.
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
import MessageBubble from '@/components/conversations/MessageBubble';
import {
  captureVisibleMessageAnchor,
  countNewCanonicalMessages,
  repinThreadAfterLayout,
  restoreVisibleMessageAnchor,
} from '@/components/conversations/threadScroll';
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

  const [atBottom, setAtBottom] = useState(true);
  const [newInThread, setNewInThread] = useState(0);
  const [showInfo, setShowInfo] = useState(false);
  const atBottomRef = useRef(true);
  const prevLastId = useRef(undefined);
  const justOpened = useRef(true);
  const prependAnchor = useRef(null);
  const isPrepending = useRef(false);
  const lastScrollTop = useRef(0);
  const rootRef = useRef(null);

  // Keyboard lift (active-gated). Writes a PANE-SCOPED var + a `tv2-msgs-kb-open` class
  // on the nearest .tv2-msgs-pane (never documentElement — legacy owns --conv-kb-offset).
  // CSS uses the var as padding-bottom on the thread layer (adds any residual lift iOS
  // didn't already do) and the class to drop the composer's home-indicator inset while
  // the keyboard is up. Blur-safe, no layout jump.
  useEffect(() => {
    if (!active) return undefined;
    const vv = window.visualViewport;
    const pane = rootRef.current?.closest('.tv2-msgs-pane');
    if (!vv || !pane) return undefined;
    // Keyboard-CLOSED viewport height. window.innerHeight is unreliable on iOS 26 — it
    // tracks the VISUAL viewport, so innerHeight === vv.height with the keyboard up and
    // the old `innerHeight - vv.height` formula computed 0 (verified on-device 2026-07-10:
    // iH479 vv479 oT415). Capture the tallest vv.height we see (keyboard closed) instead.
    let baseline = 0;
    const onResize = () => {
      const vh = vv.height;
      if (vh > baseline) baseline = vh;
      const kbInset = baseline - vh;                 // total keyboard occlusion
      const kbOpen = kbInset > 60;                   // real keyboard, not jitter/URL bar
      // iOS 26 pans the page up by vv.offsetTop to reveal the focused field, covering
      // most/all of the inset; older iOS pans nothing. Lift only the RESIDUAL iOS left,
      // so the docked composer lands flush above the keyboard in both modes.
      const raw = Math.max(0, kbInset - vv.offsetTop);
      const lift = raw > 4 ? raw : 0;
      pane.style.setProperty('--tv2-msgs-kb', `${lift}px`);
      pane.classList.toggle('tv2-msgs-kb-open', kbOpen);
      if (kbOpen && atBottomRef.current) scrollToBottom(false);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    onResize();
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      pane.style.removeProperty('--tv2-msgs-kb');
      pane.classList.remove('tv2-msgs-kb-open');
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
    // A second frame catches synchronous layout; attachment loads notify separately.
    requestAnimationFrame(() => { if (!smooth) go(); });
  }, [scrollRef]);

  const handleMediaLayout = useCallback(() => {
    const el = scrollRef.current;
    if (prependAnchor.current) {
      if (!restoreVisibleMessageAnchor(el, prependAnchor.current)) {
        prependAnchor.current = null;
      }
      return;
    }
    repinThreadAfterLayout({
      scrollElement: el,
      wasAtBottom: atBottomRef.current,
      isPrepending: isPrepending.current,
    });
  }, [scrollRef]);

  // Scroll handler: near-bottom tracking + auto load-earlier near the top (anchored) +
  // dismiss the keyboard when the tech scrolls UP to read history.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) {
      prependAnchor.current = null;
      setNewInThread(0);
    } else {
      prependAnchor.current = captureVisibleMessageAnchor(el);
    }
    // Blur-on-scroll-up: an upward drag past a small threshold dismisses the keyboard.
    if (el.scrollTop < lastScrollTop.current - 24) {
      const ae = document.activeElement;
      if (ae && typeof ae.blur === 'function' && ae.tagName === 'TEXTAREA') ae.blur();
    }
    lastScrollTop.current = el.scrollTop;
    if (el.scrollTop < 80 && hasMore && !loadingEarlier && !isPrepending.current) {
      prependAnchor.current = captureVisibleMessageAnchor(el);
      isPrepending.current = true;
      loadEarlier();
    }
  }, [scrollRef, hasMore, loadingEarlier, loadEarlier]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef, onScroll]);

  // Restore the first visible message after a prepend. Keep its element anchor so
  // delayed attachment layout above it can be corrected without moving the reader.
  useLayoutEffect(() => {
    if (prependAnchor.current) {
      if (!restoreVisibleMessageAnchor(scrollRef.current, prependAnchor.current)) {
        prependAnchor.current = null;
      }
    }
    if (isPrepending.current && !loadingEarlier) {
      isPrepending.current = false;
    }
  }, [messages, loadingEarlier, scrollRef]);

  // Tail growth: snap to bottom on open; follow new messages only if already at bottom,
  // else bump the jump-to-latest pill.
  useLayoutEffect(() => {
    if (isPrepending.current) return;
    const lastId = messages[messages.length - 1]?.id;
    if (lastId === prevLastId.current) return;
    const previousLastId = prevLastId.current;
    const firstPaint = previousLastId === undefined;
    const newCount = countNewCanonicalMessages(messages, previousLastId);
    prevLastId.current = lastId;
    if (justOpened.current || firstPaint) {
      justOpened.current = false;
      setNewInThread(0);
      scrollToBottom(false);
      return;
    }
    if (atBottomRef.current) { scrollToBottom(true); setNewInThread(0); }
    else setNewInThread((n) => n + newCount);
  }, [messages, loadingEarlier, scrollToBottom]);

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
              <MessageBubble
                key={item.data._clientId || item.data.id}
                msg={item.data}
                onRetry={retry}
                onMediaLayout={handleMediaLayout}
              />
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
          onSend={send}
          sending={sending}
        />
      </div>
    </div>
  );
}
