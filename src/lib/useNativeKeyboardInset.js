/**
 * ════════════════════════════════════════════════
 * FILE: useNativeKeyboardInset.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Tells a screen how many pixels of it the on-screen keyboard is covering,
 *   so it can lift its buttons above it. It only does this inside the installed
 *   iPhone app. In a normal web browser it always answers zero and attaches
 *   nothing at all, so the website behaves exactly as it always has.
 *
 * Exports:
 *   useNativeKeyboardInset() -> number   pixels covered (0 on web, always)
 *
 * DEPENDS ON:
 *   Packages:  react, @capacitor/core
 *   Internal:  ./nativeKeyboardLayout.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - NATIVE-ONLY BY OWNER DECISION (2026-07-27). The PWA's current keyboard
 *     behaviour is deliberately frozen: it works, and the owner does not want
 *     the web UI to move. nativeKeyboardLayout.js DOES ship a tested web
 *     adapter, but this hook never reaches it — wiring the PWA is a separate,
 *     explicit product decision, not something to slip in behind a refactor.
 *   - Returns a number, not a CSS string, so a caller can decide between
 *     padding, height, or transform. Callers must treat 0 as "do nothing" and
 *     render byte-identically to today, which is what keeps the web safe.
 * ════════════════════════════════════════════════
 */
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { observeKeyboardInset, KB_INSET_VAR } from './nativeKeyboardLayout.js';
import { scrollBehavior } from './reducedMotion.js';

export { KB_INSET_VAR };

/**
 * Where a tech sticky-CTA bar rests with no keyboard: above the tab bar, clear
 * of the home indicator. Identical in all four field forms, so it lives here
 * once rather than being retyped per screen.
 */
export const TECH_STICKY_CTA_BOTTOM =
  'calc(var(--tech-nav-height) + max(12px, env(safe-area-inset-bottom, 12px)))';

/**
 * Bottom offset for a `position: fixed` tech CTA, given the keyboard inset.
 *
 * With a keyboard up, the tab bar and the home indicator are both BEHIND it, so
 * offsetting by either would float the button into the middle of the keyboard.
 * Sit directly on the keyboard instead, with the same 12px breathing room.
 *
 * kbInset 0 (always true on web) returns the resting value unchanged.
 */
export function techStickyCtaBottom(kbInset) {
  return kbInset > 0 ? `${kbInset + 12}px` : TECH_STICKY_CTA_BOTTOM;
}

export default function useNativeKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // The web branch attaches NOTHING — no listener, no observer, no variable.
    if (!Capacitor.isNativePlatform()) return undefined;

    // The port pushes changes; nothing polls. A keyboard moves a handful of
    // times per session, so a per-frame read would burn 60 callbacks a second
    // to observe almost nothing (motion-standard.md §7, perf-budget.md §5).
    let previous = 0;
    const unobserve = observeKeyboardInset((px) => {
      setInset(px);
      // Reveal the focused field. This is NOT something the browser does for
      // us here: capacitor.config sets Keyboard.resize "none", so the WKWebView
      // keeps its full height and only the VISUAL viewport shrinks. Nothing
      // about the layout changed as far as the page is concerned, so there is
      // no scroll-into-view — the keyboard simply covers whatever is under it.
      // Extra bottom padding gives room to scroll but cannot start the scroll.
      if (px > 0 && previous === 0) {
        const el = document.activeElement;
        const editable = el && (
          el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
        );
        // Next frame: the padding that creates the scrollable room is applied
        // in the same React commit as this state change.
        if (editable) {
          requestAnimationFrame(() => {
            // MOTION-02: 'auto' under Reduce Motion — the field still comes
            // into view, only the travel is removed.
            try { el.scrollIntoView({ block: 'center', behavior: scrollBehavior() }); } catch { /* best effort */ }
          });
        }
      }
      previous = px;
    });
    return () => {
      unobserve();
      setInset(0);
    };
  }, []);

  return inset;
}
