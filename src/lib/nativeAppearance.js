// Status bar + splash screen helpers. No-op on web.
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

const isNative = () => Capacitor.isNativePlatform();

// Dark text on light background — use on list/dashboard screens.
export function statusBarDark() {
  if (!isNative()) return;
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
}

// Light text on dark background — use on division-colored hero screens.
export function statusBarLight() {
  if (!isNative()) return;
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
}

// Hide the splash screen with a short fade. Call once after app shell has
// mounted — Capacitor shows the storyboard/Splash image before this is reached.
export function hideSplash() {
  if (!isNative()) return;
  SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {});
}
