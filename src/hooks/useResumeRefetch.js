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
 *     NOT re-subscribe the listeners. `enabled=false` tears everything down.
 * ════════════════════════════════════════════════
 */

import { useEffect, useRef } from 'react';

export function useResumeRefetch({
  onResume,
  onFocus,
  pollMs,
  hiddenEdgeOnly = true,
  enabled = true,
} = {}) {
  const onResumeRef = useRef(onResume);
  const onFocusRef = useRef(onFocus);
  onResumeRef.current = onResume;
  onFocusRef.current = onFocus;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    let wasHidden = false;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') { wasHidden = true; return; }
      // visible again
      if (!hiddenEdgeOnly || wasHidden) onResumeRef.current?.();
      wasHidden = false;
    };

    const handleFocus = () => { onFocusRef.current?.(); };

    document.addEventListener('visibilitychange', handleVisibility);
    if (onFocusRef.current) window.addEventListener('focus', handleFocus);

    let intervalId;
    if (pollMs && pollMs > 0) {
      intervalId = setInterval(() => {
        if (document.hidden) return; // skip polls while backgrounded
        onResumeRef.current?.();
      }, pollMs);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled, hiddenEdgeOnly, pollMs]);
}

export default useResumeRefetch;
