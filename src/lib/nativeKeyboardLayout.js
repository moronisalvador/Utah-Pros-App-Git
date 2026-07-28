/**
 * ════════════════════════════════════════════════
 * FILE: nativeKeyboardLayout.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Works out how much of the screen the on-screen keyboard is covering, and
 *   publishes that number so any screen can lift its buttons above it. Before
 *   this, several screens — the Request Signature sheet and the appointment,
 *   job and customer forms — had no idea the keyboard existed, so a technician
 *   typing a note could not see the note or reach Save, and scrolling did not
 *   bring them back.
 *
 * Exports:
 *   KB_INSET_VAR              the CSS custom property name
 *   observeKeyboardInset()    start observing; returns an unsubscribe function
 *   readKeyboardInset()       current inset in px (for tests / imperative use)
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @capacitor/keyboard (native path only, lazy)
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Two adapters, one contract. NATIVE uses the Capacitor keyboard events,
 *     which report an exact keyboardHeight — more reliable than measuring. WEB
 *     uses visualViewport with the baseline algorithm proven on-device in
 *     ThreadView (2026-07-10: iH479 vv479 oT415). That algorithm exists because
 *     on iOS 26 `window.innerHeight` tracks the VISUAL viewport, so the older
 *     `innerHeight - vv.height` formula computes 0 and silently does nothing.
 *   - iOS pans the page up by `vv.offsetTop` to reveal the focused field, which
 *     already covers part of the occlusion. The web adapter lifts only the
 *     RESIDUAL, or a docked control would float too high.
 *   - Reference-counted: several screens may observe at once without fighting,
 *     and the last one to leave clears the variable.
 *   - Fails closed to 0. A keyboard-measurement failure must never leave a
 *     stale inset wedged on the document — that would push content off-screen
 *     with the keyboard already gone. Hidden->visible also re-zeroes, because
 *     iOS can resume with the keyboard dismissed and no event delivered.
 *   - This does NOT touch ThreadView's pane-scoped --tv2-msgs-kb. That surface
 *     is on-device-verified and lives in a reserved marker owned by another
 *     initiative; consolidating it is a follow-up, not a prerequisite.
 * ════════════════════════════════════════════════
 */
import { Capacitor } from '@capacitor/core';

export const KB_INSET_VAR = '--upr-kb-inset';

/** Below this, a viewport change is URL-bar jitter rather than a keyboard. */
const KEYBOARD_MIN_PX = 60;
/** Below this, the residual lift is not worth a layout change. */
const RESIDUAL_MIN_PX = 4;

let inset = 0;
let subscribers = 0;
let detach = null;

function root() {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

function publish(next) {
  const value = Number.isFinite(next) && next > 0 ? Math.round(next) : 0;
  inset = value;
  const el = root();
  if (!el) return;
  if (value > 0) el.style.setProperty(KB_INSET_VAR, `${value}px`);
  else el.style.removeProperty(KB_INSET_VAR);
}

export function readKeyboardInset() {
  return inset;
}

/** Native adapter — the plugin reports an exact height, so do not measure. */
async function attachNative() {
  const { Keyboard } = await import('@capacitor/keyboard');
  const handles = await Promise.all([
    Keyboard.addListener('keyboardWillShow', (info) => publish(info?.keyboardHeight)),
    Keyboard.addListener('keyboardDidShow', (info) => publish(info?.keyboardHeight)),
    // Both hide events zero it. willHide starts the visual change; didHide is
    // the backstop for a dismissal that never animated (interactive dismiss).
    Keyboard.addListener('keyboardWillHide', () => publish(0)),
    Keyboard.addListener('keyboardDidHide', () => publish(0)),
  ]);
  return () => { handles.forEach((h) => { try { h?.remove?.(); } catch { /* detaching */ } }); };
}

/** Web/PWA adapter — the baseline algorithm proven on-device in ThreadView. */
function attachWeb() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return () => {};

  // Tallest height seen IS the keyboard-closed height. Measuring it directly is
  // what fails on iOS 26.
  let baseline = 0;
  const onChange = () => {
    const height = vv.height;
    if (height > baseline) baseline = height;
    const occlusion = baseline - height;
    if (occlusion < KEYBOARD_MIN_PX) { publish(0); return; }
    const residual = Math.max(0, occlusion - vv.offsetTop);
    publish(residual > RESIDUAL_MIN_PX ? residual : 0);
  };

  vv.addEventListener('resize', onChange);
  vv.addEventListener('scroll', onChange);
  onChange();
  return () => {
    vv.removeEventListener('resize', onChange);
    vv.removeEventListener('scroll', onChange);
  };
}

function onVisibility() {
  // Resuming from background with the keyboard already dismissed delivers no
  // event on iOS; a stale inset would push the CTA off-screen.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') publish(0);
}

/**
 * Start observing. Returns an unsubscribe. Safe to call from several screens.
 */
export function observeKeyboardInset() {
  subscribers += 1;
  if (subscribers === 1) {
    if (Capacitor.isNativePlatform()) {
      // Only this path is async, because the plugin is imported lazily. Hold the
      // resolved teardown so release is synchronous once attach has landed —
      // tearing down inside a .then() leaves listeners alive past unmount, and a
      // fast remount then double-attaches with a stale adapter still publishing.
      let cancelled = false;
      let teardown = null;
      const pending = Promise.resolve()
        .then(attachNative)
        .catch(() => () => {}); // a keyboard failure must never break a screen
      pending.then((fn) => {
        teardown = fn;
        if (cancelled) { try { fn?.(); } catch { /* detaching */ } teardown = null; }
      });
      detach = () => {
        cancelled = true;
        if (teardown) {
          try { teardown(); } catch { /* detaching */ } finally { teardown = null; }
          return;
        }
        pending.then((fn) => { try { fn?.(); } catch { /* detaching */ } });
      };
    } else {
      // Web needs no import, so observe/unobserve stay fully synchronous — which
      // is what a React effect cleanup expects.
      let teardown;
      try { teardown = attachWeb(); } catch { teardown = () => {}; }
      detach = () => { try { teardown?.(); } catch { /* detaching */ } finally { teardown = null; } };
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
  }

  let released = false;
  return function unobserve() {
    if (released) return;          // idempotent — double-unmount must not underflow
    released = true;
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers === 0) {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      try { detach?.(); } finally { detach = null; publish(0); }
    }
  };
}
