/**
 * ════════════════════════════════════════════════
 * FILE: TechPane.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps a whole v2 screen (the dashboard or the schedule) alive in the
 *   background so switching tabs is instant and nothing reloads or loses its
 *   place. When a screen isn't the one you're looking at, it's just hidden — not
 *   thrown away — and its scroll position is remembered and restored the moment
 *   you come back. It also tells its screen whether it's the active one so the
 *   screen can pause things like location checks while hidden.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (layout primitive)
 *   Rendered by:  src/components/TechLayout.jsx (the pane host)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  index.css (.tv2-pane, .tv2-pane-scroll, .tv2-pane-header)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Scroll position is tracked CONTINUOUSLY into a ref via a passive listener,
 *     NOT saved on hide — WebKit reports scrollTop 0 for a display:none element,
 *     so a save-on-hide would always restore to the top.
 *   - Restore runs in useLayoutEffect (before paint) so there's no visible jump.
 *   - `header` renders OUTSIDE the scroll container so it doesn't move on
 *     pull-to-refresh (tech-mobile-ux: sticky headers don't move).
 * ════════════════════════════════════════════════
 */
import React, { useRef, useEffect, useLayoutEffect } from 'react';

/**
 * @param {{ active: boolean, header?: React.ReactNode, children: React.ReactNode }} props
 */
export default function TechPane({ active, header, children }) {
  const scrollRef = useRef(null);
  const scrollTop = useRef(0);

  // Track scrollTop continuously while the pane is visible.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => { scrollTop.current = el.scrollTop; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Restore the remembered position when this pane becomes active, before paint.
  useLayoutEffect(() => {
    if (active && scrollRef.current) {
      scrollRef.current.scrollTop = scrollTop.current;
    }
  }, [active]);

  return (
    <div className="tv2-pane" hidden={!active} aria-hidden={!active}>
      {header && <div className="tv2-pane-header">{header}</div>}
      <div className="tv2-pane-scroll" ref={scrollRef}>
        {children}
      </div>
    </div>
  );
}
