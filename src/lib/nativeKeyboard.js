// Native keyboard config — no-op on web (guarded by isNativePlatform, like the
// other src/lib/native*.js helpers).
//
// WHY: in a Home-Screen PWA iOS renders a keyboard "accessory bar" (the ‹ › Done
// strip with prev/next field arrows) above the keyboard, and Apple exposes no web
// API to hide it (verified iOS 26.1, 2026-07). In the NATIVE Capacitor app — the
// build field techs actually run — the @capacitor/keyboard plugin CAN remove it, so
// the tech Messages composer sits flush on the keyboard like iMessage.
//
// resize:None keeps the WKWebView from auto-resizing on keyboard open, preserving the
// pre-plugin native behavior (the app's own visualViewport lift in ThreadView stays
// the single source of truth) — so no other tech screen's keyboard handling regresses.
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';

const isNative = () => Capacitor.isNativePlatform();

// Call once at launch (from main.jsx). All calls swallow errors — a keyboard-config
// failure must never blank the app.
export function configureNativeKeyboard() {
  if (!isNative()) return;
  // iPhone-only: a one-time WKWebView instruction applied to every later keyboard.
  Keyboard.setAccessoryBarVisible({ isVisible: false })
    .catch((err) => console.warn('Keyboard.setAccessoryBarVisible failed:', err?.message || err));
  // Belt-and-suspenders alongside the capacitor.config "resize":"none" — pins it even
  // if an older native shell missed the config key. Behavior-preserving (no resize).
  Keyboard.setResizeMode({ mode: KeyboardResize.None })
    .catch((err) => console.warn('Keyboard.setResizeMode failed:', err?.message || err));
}
