/**
 * ════════════════════════════════════════════════
 * FILE: nativeAppearance.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Sets the colour of the iPhone's own top strip — the clock, Wi-Fi, battery —
 *   so it stays readable against whatever the screen behind it looks like, and
 *   hides the launch splash once the app is up. Does nothing in a web browser.
 *
 * Exports:
 *   setStatusBarBase(surface)   the theme's status colour (theme owner only)
 *   pushStatusBarSurface(s)     a screen temporarily overriding it
 *   restoreStatusBarBase()      that screen giving it back on unmount
 *   hideSplash()
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @capacitor/status-bar, @capacitor/splash-screen
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - `surface` describes the BACKGROUND behind the strip ('light' | 'dark'),
 *     never the text colour. That is deliberate: Capacitor's enum names the
 *     STYLE, not the text, and the previous helpers named the text — so
 *     statusBarDark() ("dark text") called Style.Dark, which Capacitor
 *     documents as "Light text for dark backgrounds". Both helpers were
 *     inverted, so light theme painted white-on-white and dark theme painted
 *     dark-on-dark. Naming the surface removes the ambiguity that caused it.
 *   - Capacitor's contract, verified in
 *     @capacitor/status-bar/dist/esm/definitions.d.ts:
 *       Style.Dark  = "Light text for dark backgrounds"
 *       Style.Light = "Dark text for light backgrounds"
 *   - The theme is the OWNER; a screen may override for its own hero and must
 *     restore. restoreStatusBarBase() returns to whatever the theme last set,
 *     not to a hardcoded value — restoring a fixed style stranded dark-on-dark
 *     after leaving a hero screen in dark mode, because the theme effect does
 *     not re-run when the theme itself has not changed.
 * ════════════════════════════════════════════════
 */
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

const isNative = () => Capacitor.isNativePlatform();

/** Background behind the status strip -> the Capacitor style that stays legible. */
export const STATUS_STYLE_FOR_SURFACE = Object.freeze({
  light: Style.Light,   // light background -> DARK text
  dark: Style.Dark,     // dark background  -> LIGHT text
});

/** What the theme owner last requested, so an override can hand it back. */
let baseSurface = 'light';

function apply(surface) {
  if (!isNative()) return;
  const style = STATUS_STYLE_FOR_SURFACE[surface];
  if (!style) return;
  StatusBar.setStyle({ style }).catch(() => {});
}

/** Theme owner only (ThemeContext). Records the base AND applies it. */
export function setStatusBarBase(surface) {
  if (!STATUS_STYLE_FOR_SURFACE[surface]) return;
  baseSurface = surface;
  apply(surface);
}

/** A screen whose own hero differs from the theme (e.g. a dark gradient). */
export function pushStatusBarSurface(surface) {
  apply(surface);
}

/** Hand it back to the theme — NOT to a hardcoded style. */
export function restoreStatusBarBase() {
  apply(baseSurface);
}

/** Test seam: current base, so a test can prove the restore is theme-aware. */
export function readStatusBarBase() {
  return baseSurface;
}

// Hide the splash screen with a short fade. Call once after app shell has
// mounted — Capacitor shows the storyboard/Splash image before this is reached.
export function hideSplash() {
  if (!isNative()) return;
  SplashScreen.hide({ fadeOutDuration: 180 }).catch((err) => {
    console.warn('SplashScreen.hide failed — splash may stay stuck:', err?.message || err);
  });
}
