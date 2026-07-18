// Native haptics wrapper. On iOS (Capacitor) uses Taptic Engine via @capacitor/haptics.
// On web / Android Chrome, falls back to navigator.vibrate() with a matching duration.
// All exported functions are fire-and-forget — never throw, never await in a hot path.

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const isNative = () => Capacitor.isNativePlatform();

// motion-standard.md §4: haptics respect prefers-reduced-motion.
function reducedMotion() {
  try {
    return typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function webVibrate(ms) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try { navigator.vibrate(ms); } catch { /* ignore */ }
  }
}

// Sharp tactile bump. Styles: 'light' | 'medium' | 'heavy'.
export function impact(style = 'medium') {
  if (reducedMotion()) return;
  if (isNative()) {
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    Haptics.impact({ style: map[style] || ImpactStyle.Medium })
      .catch((err) => console.warn('Haptics.impact failed:', err?.message || err));
  } else {
    webVibrate(style === 'light' ? 20 : style === 'heavy' ? 80 : 40);
  }
}

// Success/warning/error pattern — useful for meaningful state changes.
// Types: 'success' | 'warning' | 'error'.
export function notify(type = 'success') {
  if (reducedMotion()) return;
  if (isNative()) {
    const map = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    Haptics.notification({ type: map[type] || NotificationType.Success })
      .catch((err) => console.warn('Haptics.notification failed:', err?.message || err));
  } else {
    const ms = type === 'success' ? [30, 60, 30] : type === 'error' ? [80, 40, 80] : 60;
    webVibrate(ms);
  }
}

// Selection-change pill — lighter than 'light' impact, for scroll wheels / pickers.
export function selection() {
  if (reducedMotion()) return;
  if (isNative()) {
    Haptics.selectionStart().catch((err) => console.warn('Haptics.selectionStart failed:', err?.message || err));
    Haptics.selectionEnd().catch((err) => console.warn('Haptics.selectionEnd failed:', err?.message || err));
  } else {
    webVibrate(10);
  }
}
