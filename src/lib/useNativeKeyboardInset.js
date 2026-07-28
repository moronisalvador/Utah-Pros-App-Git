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

export { KB_INSET_VAR };

export default function useNativeKeyboardInset() {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    // The web branch attaches NOTHING — no listener, no observer, no variable.
    if (!Capacitor.isNativePlatform()) return undefined;

    // The port pushes changes; nothing polls. A keyboard moves a handful of
    // times per session, so a per-frame read would burn 60 callbacks a second
    // to observe almost nothing (motion-standard.md §7, perf-budget.md §5).
    const unobserve = observeKeyboardInset(setInset);
    return () => {
      unobserve();
      setInset(0);
    };
  }, []);

  return inset;
}
