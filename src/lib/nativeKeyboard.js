// Native keyboard config — no-op on web (guarded by isNativePlatform, like the
// other src/lib/native*.js helpers).
//
// WHY: in a Home-Screen PWA iOS renders a keyboard "accessory bar" (the ‹ › Done
// strip with prev/next field arrows) above the keyboard, and Apple exposes no web
// API to hide it (verified iOS 26.1, 2026-07). In the NATIVE Capacitor app — the
// build field techs actually run — the @capacitor/keyboard plugin CAN remove it, so
// the tech Messages composer sits flush on the keyboard like iMessage.
//
// CONTEXTUAL EXCEPTION (owner-directed 2026-08-06): iOS number/decimal/phone pads
// have no return key, so with the bar hidden there is NO way to dismiss the
// keyboard from a numeric field (hit entering check numbers and payment amounts
// in Receive Payment). The bar now shows only while a numeric-style input is
// focused — Done appears exactly where it is needed — and stays hidden for text
// fields, so the chat composer still sits flush like iMessage.
//
// resize:None keeps the WKWebView from auto-resizing on keyboard open, preserving the
// pre-plugin native behavior (the app's own visualViewport lift in ThreadView stays
// the single source of truth) — so no other tech screen's keyboard handling regresses.
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';

const isNative = () => Capacitor.isNativePlatform();

// Keyboards with no return key: the OS accessory bar is the only Done button.
// (Date/time inputs present pickers, not keyboards, so they are not listed.)
const needsAccessoryBar = (element) => {
  if (!element || element.tagName !== 'INPUT') return false;
  const mode = String(element.getAttribute('inputmode') || '').toLowerCase();
  const type = String(element.getAttribute('type') || '').toLowerCase();
  return mode === 'numeric' || mode === 'decimal' || mode === 'tel'
    || type === 'number' || type === 'tel';
};

// Call once at launch (from main.jsx). All calls swallow errors — a keyboard-config
// failure must never blank the app.
export function configureNativeKeyboard() {
  if (!isNative()) return;
  // iPhone-only: a one-time WKWebView instruction applied to every later keyboard.
  Keyboard.setAccessoryBarVisible({ isVisible: false })
    .catch((err) => console.warn('Keyboard.setAccessoryBarVisible failed:', err?.message || err));
  // Re-decide per focused field: numeric-style inputs get the bar (Done), text
  // fields keep the flush iMessage look. Applied on focus, so it takes effect
  // with each keyboard presentation.
  document.addEventListener('focusin', (event) => {
    Keyboard.setAccessoryBarVisible({ isVisible: needsAccessoryBar(event.target) })
      .catch(() => {});
  });
  // Belt-and-suspenders alongside the capacitor.config "resize":"none" — pins it even
  // if an older native shell missed the config key. Behavior-preserving (no resize).
  Keyboard.setResizeMode({ mode: KeyboardResize.None })
    .catch((err) => console.warn('Keyboard.setResizeMode failed:', err?.message || err));
}
