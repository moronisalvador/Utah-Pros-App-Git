/**
 * ════════════════════════════════════════════════
 * FILE: useNavDirection.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Watches which way you're moving through the app — forward into a new screen,
 *   or Back to one you already saw — and writes that direction onto the page so
 *   the screen-slide animation can push the right way (new screen in from the
 *   right on forward, from the left on Back). It draws nothing itself.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a hook)
 *   Rendered by:  mounted once via <NavDirectionTracker /> inside <BrowserRouter> in src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none (sets document.documentElement.dataset.nav)
 *
 * NOTES / GOTCHAS:
 *   - Pairs with the View-Transition CSS in src/index.css (html[data-nav="back"]
 *     rules). No data-nav attribute → the CSS defaults to the forward push, so
 *     this is purely progressive enhancement.
 *   - Direction is derived from the remix-router history index (window.history
 *     .state.idx), which is the ONLY reliable back-vs-forward signal — react
 *     router's useNavigationType() returns POP for BOTH back and forward.
 *   - useLayoutEffect (not useEffect) so the attribute is set BEFORE the browser
 *     paints / the View-Transition snapshot resolves for the new route.
 * ════════════════════════════════════════════════
 */
import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Sets html[data-nav] to 'back' | 'forward' each navigation so the directional
// View-Transition animation (index.css) can reverse on Back. History idx is the
// only reliable back-vs-forward signal (useNavigationType returns POP for both).
export function useNavDirection() {
  const location = useLocation();
  const prevIdx = useRef(typeof window !== 'undefined' ? (window.history.state?.idx ?? 0) : 0);
  useLayoutEffect(() => {
    const idx = window.history.state?.idx ?? 0;
    document.documentElement.dataset.nav = idx < prevIdx.current ? 'back' : 'forward';
    prevIdx.current = idx;
  }, [location]);
}
