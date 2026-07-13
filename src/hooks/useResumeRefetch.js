/**
 * ════════════════════════════════════════════════
 * FILE: useResumeRefetch.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one shared way for a screen to quietly refresh its data when you come
 *   back to the app (unlock the phone, switch back to the tab) or, optionally, on
 *   a timer. "Quietly" is the whole point: it calls the refresh function you give
 *   it WITHOUT flashing a spinner, losing your scroll position, or clearing what
 *   you typed — so a tech who checks the calculator and returns sees exactly what
 *   they left. It replaces the 8 hand-rolled visibility handlers the app had.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared hook)
 *   Rendered by:  any page/component that needs to refresh on resume (import from '@/hooks/useResumeRefetch')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none (behavior model: Conversations.jsx:475-489 + usePolledRpc.js:58-84)
 *   Data:      none (the caller's callback does the I/O)
 *
 * NOTES / GOTCHAS:
 *   - The callbacks MUST be silent: do not flip a page-level `loading` flag inside
 *     them (page-lifecycle.md §1-2). This hook never re-renders your page itself.
 *   - `hiddenEdgeOnly` (default true): fire `onResume` only on a real hidden→visible
 *     transition, NOT on every desktop refocus. Pass `onFocus` for the lighter
 *     "any focus" refresh (e.g. a cheap list refresh) — modeled on Conversations.
 *   - Poll: when `pollMs` is set, the poll no-ops while `document.hidden` and fires
 *     `onResume` on the interval (copy of usePolledRpc's hidden-guard). A poll never
 *     toasts (page-lifecycle.md §4) — that's on the caller's callback to honor.
 *   - Callbacks are held in refs, so passing a fresh inline function each render does
 *     NOT re-subscribe the listeners. Both listeners attach UNCONDITIONALLY (the
 *     handlers read the latest callback live and no-op when unset) so a caller that
 *     starts passing `onFocus` later still gets it. `enabled=false` tears down.
 *   - The subscription itself is the exported pure `subscribeResume` (document/window
 *     injected) so its behavior is unit-testable without a DOM (see hooks.test.jsx).
 * ════════════════════════════════════════════════
 */

import { useEffect, useRef } from 'react';

/**
 * Pure subscription behind the hook — attaches the resume/focus/poll listeners to
 * the injected `doc`/`win` targets and returns a cleanup fn. Handlers pull the
 * callback live via getOnResume/getOnFocus, so both listeners attach unconditionally
 * and a late-provided callback still fires. Exported for unit testing (no DOM needed).
 */
export function subscribeResume({ doc, win, getOnResume, getOnFocus, pollMs, hiddenEdgeOnly = true }) {
  let wasHidden = false;

  const handleVisibility = () => {
    if (doc.visibilityState === 'hidden') { wasHidden = true; return; }
    // visible again — fire only on a real hidden→visible edge when hiddenEdgeOnly
    if (!hiddenEdgeOnly || wasHidden) getOnResume()?.();
    wasHidden = false;
  };
  const handleFocus = () => { getOnFocus()?.(); };

  doc.addEventListener('visibilitychange', handleVisibility);
  win.addEventListener('focus', handleFocus);

  let intervalId;
  if (pollMs && pollMs > 0) {
    intervalId = setInterval(() => {
      if (doc.hidden) return; // skip polls while backgrounded
      getOnResume()?.();
    }, pollMs);
  }

  return () => {
    doc.removeEventListener('visibilitychange', handleVisibility);
    win.removeEventListener('focus', handleFocus);
    if (intervalId) clearInterval(intervalId);
  };
}

export function useResumeRefetch({
  onResume,
  onFocus,
  pollMs,
  hiddenEdgeOnly = true,
  enabled = true,
} = {}) {
  const onResumeRef = useRef(onResume);
  const onFocusRef = useRef(onFocus);
  // Keep the latest callbacks in refs (updated after each render) so passing a fresh
  // inline function each render does NOT re-subscribe the listeners below.
  useEffect(() => {
    onResumeRef.current = onResume;
    onFocusRef.current = onFocus;
  });

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    return subscribeResume({
      doc: document,
      win: window,
      getOnResume: () => onResumeRef.current,
      getOnFocus: () => onFocusRef.current,
      pollMs,
      hiddenEdgeOnly,
    });
  }, [enabled, hiddenEdgeOnly, pollMs]);
}

export default useResumeRefetch;
