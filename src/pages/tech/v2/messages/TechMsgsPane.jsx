/**
 * ════════════════════════════════════════════════
 * FILE: TechMsgsPane.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The frame that holds the messaging screen alive in the background so switching
 *   tabs is instant and nothing reloads. It stacks two "layers": the conversation
 *   list and the open thread. Only one shows at a time (the other is just hidden,
 *   not thrown away), so the list keeps its exact scroll position when you open a
 *   thread and come back, and the thread always opens pinned to the newest message.
 *   When a thread is open it also tells the app to hide the bottom tab bar, but only
 *   while this screen is the one you're looking at.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (layout primitive)
 *   Rendered by:  src/pages/tech/v2/TechMessagesV2.jsx (the messaging pane page)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  index.css (.tv2-msgs-pane / .tv2-msgs-layer / .tv2-msgs-scroll,
 *              inside the TECH-V2: MSGS reserved marker)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - DISCLOSED COPY-IN of src/components/tech/v2/TechPane.jsx (authorized by
 *     .claude/rules/tech-messages-v2-wave-ownership.md §3 — TechPane is NOT edited).
 *     Why a copy and not a reuse: TechPane has ONE scroller; a list↔thread content
 *     swap "clamp-poisons" its single continuous scroll tracker (it would record the
 *     thread's scrollTop and restore it onto the list). Two independent scrollers fix
 *     that — the list layer tracks + restores; the thread layer never does.
 *   - Scroll position is tracked CONTINUOUSLY into a ref via a passive listener, NOT
 *     saved on hide — WebKit reports scrollTop 0 for a display:none element, so a
 *     save-on-hide would always restore to the top. Restore runs in useLayoutEffect
 *     (before paint) so there's no visible jump.
 *   - The thread layer carries `tv2-msgs-thread-open` ONLY while `active` — the CSS
 *     nav-hide rule is scoped to a NOT-hidden pane, so a background pane with a thread
 *     "open" in state can never strand the whole app's tab bar.
 *   - `threadScrollRef` is forwarded to the thread scroller so the page (Phase B1) can
 *     drive pin-to-bottom / load-earlier anchoring; the list scroller stays internal
 *     (the host owns its restore).
 * ════════════════════════════════════════════════
 */
import React, { useRef, useEffect, useLayoutEffect } from 'react';

/**
 * @param {{
 *   active: boolean,           // this pane is the visible tab
 *   threadOpen?: boolean,      // a thread is open (list hidden, thread shown)
 *   list: React.ReactNode,     // conversation-list layer content
 *   thread?: React.ReactNode,  // open-thread layer content
 *   threadScrollRef?: React.RefObject<HTMLDivElement>, // page-owned thread scroller ref
 * }} props
 */
export default function TechMsgsPane({ active, threadOpen = false, list, thread = null, threadScrollRef }) {
  const listScrollRef = useRef(null);
  const listScrollTop = useRef(0);
  const internalThreadRef = useRef(null);
  const threadRef = threadScrollRef || internalThreadRef;

  // Track LIST scroll continuously while it's the visible layer.
  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return undefined;
    const onScroll = () => { listScrollTop.current = el.scrollTop; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Restore the remembered list position when the list layer is (re)shown, pre-paint.
  const listVisible = active && !threadOpen;
  useLayoutEffect(() => {
    if (listVisible && listScrollRef.current) {
      listScrollRef.current.scrollTop = listScrollTop.current;
    }
  }, [listVisible]);

  return (
    <div className="tv2-msgs-pane" hidden={!active} aria-hidden={!active}>
      {/* List layer — own scroller, position restored on return. */}
      <div className="tv2-msgs-layer tv2-msgs-list-layer" hidden={threadOpen}>
        <div className="tv2-msgs-scroll" ref={listScrollRef}>{list}</div>
      </div>
      {/* Thread layer — own scroller, pinned to newest (no restore-to-saved). The
          thread-open class (→ nav-hide) is applied ONLY while this pane is active. */}
      <div
        className={`tv2-msgs-layer tv2-msgs-thread-layer${active && threadOpen ? ' tv2-msgs-thread-open' : ''}`}
        hidden={!threadOpen}
      >
        <div className="tv2-msgs-scroll tv2-msgs-thread-scroll" ref={threadRef}>{thread}</div>
      </div>
    </div>
  );
}
