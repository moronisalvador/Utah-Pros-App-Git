/**
 * ════════════════════════════════════════════════
 * FILE: useTwoClickConfirm.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared logic behind the app's "click once to arm, click again to confirm"
 *   delete buttons — the pattern that replaces the banned alert()/confirm() pop-ups
 *   for destructive actions. The first click arms a specific item (and the button
 *   turns red saying "Confirm"); a second click within a few seconds runs the
 *   action; clicking away, waiting too long, or arming a different item cancels it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared hook)
 *   Rendered by:  any component with a destructive action (import from '@/hooks/useTwoClickConfirm')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none (formalizes the UPR-Design-System.md two-click-confirm idiom)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Usage: const { isArmed, arm, cancel } = useTwoClickConfirm();
 *     onClick={() => isArmed(item.id) ? runDelete(item) : arm(item.id)}
 *     onBlur={cancel}  // cancel on blur (mobile has no hover — UPR rule #5)
 *   - Auto-disarms after `timeoutMs` (default 3500) so a stray armed button doesn't
 *     linger. Arming a different key replaces the armed one.
 *   - CLAUDE.md Rule 2: destructive actions use THIS, never a modal or window.confirm.
 * ════════════════════════════════════════════════
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export function useTwoClickConfirm(timeoutMs = 3500) {
  const [armedKey, setArmedKey] = useState(null);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    setArmedKey(null);
  }, [clearTimer]);

  const arm = useCallback((key = true) => {
    clearTimer();
    setArmedKey(key);
    if (timeoutMs > 0) {
      timerRef.current = setTimeout(() => setArmedKey(null), timeoutMs);
    }
  }, [clearTimer, timeoutMs]);

  const isArmed = useCallback((key = true) => armedKey === key, [armedKey]);

  // Tidy the pending timer if the component unmounts mid-arm.
  useEffect(() => clearTimer, [clearTimer]);

  return { armedKey, isArmed, arm, cancel };
}

export default useTwoClickConfirm;
