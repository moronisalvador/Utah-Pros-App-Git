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
 *   - Usage: const { isArmed, isPending, arm, cancel } = useTwoClickConfirm();
 *     onClick={() => isArmed(item.id) ? runDelete(item) : arm(item.id)}
 *     label={isPending(item.id) ? 'Confirm' : 'Delete'}
 *     onBlur={cancel}  // cancel on blur (mobile has no hover — UPR rule #5)
 *   - Auto-disarms after `timeoutMs` (default 3500) so a stray armed button doesn't
 *     linger. Arming a different key replaces the armed one.
 *
 *   - ⚠ A DOUBLE-TAP USED TO DELETE. Until 2026-08-19 there was no minimum delay
 *     between arming and confirming, so two taps in one gesture — an entirely
 *     ordinary accident on a phone, and how iOS delivers a double-tap — ran the
 *     destructive action. MEASURED, not theorised: a probe rendering this hook
 *     and firing two consecutive clicks called the delete handler once, with the
 *     label going "Delete" → "Confirm" in between. The pattern's whole safety
 *     claim was false, across all of its callers.
 *
 *     `armDelayMs` closes it — pass ~350ms. iOS treats taps within ~300ms as a
 *     double-tap; a human who reads "Confirm" first takes far longer, so the
 *     guard is invisible to deliberate use and fatal to accidents. A too-early
 *     second tap RE-ARMS rather than confirming, so a machine-gun tapper never
 *     fires the action.
 *
 *   - ⚠ IT DEFAULTS TO 0 — OFF — AND THAT IS A KNOWN, DELIBERATE GAP.
 *     Turning it on requires the caller to split two things it currently does
 *     with one function: `isPending` must drive the LABEL and `isArmed` the
 *     ACTION. Every one of the 13 call sites uses `isArmed` for both, often on
 *     the same line, so flipping the default without migrating them makes each
 *     button sit silent for 350ms after the first tap — measurably worse than
 *     the bug, and on destructive controls. The migration is real work with real
 *     regression risk on delete paths and is tracked as its own change; it was
 *     NOT bundled into the 2026-08-19 rules update that exposed the defect.
 *     New code passes armDelayMs and uses the split. See
 *     .claude/rules/confirmation-controls.md.
 *
 *   - THE SPLIT: `isPending` is for the LABEL (flips instantly, so the button
 *     still feels responsive) and `isArmed` is for the ACTION (false until the
 *     delay elapses; identical to isPending while armDelayMs is 0). Using
 *     `isPending` to gate the action reopens the hole.
 *
 *   - When to use this hook at all: AGENTS.md Rule 2. Short version — a single,
 *     obvious, reversible-in-practice destructive action stays inline; anything
 *     irreversible, multi-item, needing explanation, or needing INPUT is a
 *     dialog. A form is not a confirmation.
 * ════════════════════════════════════════════════
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export function useTwoClickConfirm(timeoutMs = 3500, armDelayMs = 0) {
  const [armedKey, setArmedKey] = useState(null);
  // Separate from armedKey so the LABEL can flip immediately while the ACTION
  // stays closed for armDelayMs. One flag cannot do both jobs.
  const [confirmReady, setConfirmReady] = useState(false);
  const timerRef = useRef(null);
  const readyRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (readyRef.current) { clearTimeout(readyRef.current); readyRef.current = null; }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    setArmedKey(null);
    setConfirmReady(false);
  }, [clearTimer]);

  const arm = useCallback((key = true) => {
    clearTimer();
    setArmedKey(key);
    // Re-arming restarts the window, so repeated fast taps can never accumulate
    // into a confirm.
    setConfirmReady(armDelayMs <= 0);
    if (armDelayMs > 0) {
      readyRef.current = setTimeout(() => setConfirmReady(true), armDelayMs);
    }
    if (timeoutMs > 0) {
      timerRef.current = setTimeout(() => { setArmedKey(null); setConfirmReady(false); }, timeoutMs);
    }
  }, [clearTimer, timeoutMs, armDelayMs]);

  /** ACTION gate — armed AND past the double-tap window. */
  const isArmed = useCallback(
    (key = true) => armedKey === key && confirmReady,
    [armedKey, confirmReady],
  );

  /** LABEL gate — armed, regardless of the window. Never gate the action on this. */
  const isPending = useCallback((key = true) => armedKey === key, [armedKey]);

  // Tidy the pending timers if the component unmounts mid-arm.
  useEffect(() => clearTimer, [clearTimer]);

  return { armedKey, isArmed, isPending, arm, cancel };
}

export default useTwoClickConfirm;
