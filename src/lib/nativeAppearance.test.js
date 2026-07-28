/**
 * STAT-01 — status-bar ownership behaviour.
 *
 * The static contract test pins the SURFACE -> Style mapping. This pins the
 * part that mapping cannot express: a hero screen that overrides the strip must
 * hand it back to whatever the THEME is, not to a fixed style. Restoring a
 * hardcoded light-surface style stranded dark-on-dark after leaving a hero in
 * dark mode, because the theme effect does not re-run when the theme itself
 * never changed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const isNativePlatform = vi.fn(() => true);
const setStyle = vi.fn(() => Promise.resolve());

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: (...args) => setStyle(...args) },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: () => Promise.resolve() } }));

const {
  setStatusBarBase,
  pushStatusBarSurface,
  restoreStatusBarBase,
  readStatusBarBase,
} = await import('./nativeAppearance.js');

const lastStyle = () => setStyle.mock.calls.at(-1)?.[0]?.style;

beforeEach(() => {
  setStyle.mockClear();
  isNativePlatform.mockReturnValue(true);
  setStatusBarBase('light');
  setStyle.mockClear();
});

describe('STAT-01 — surface to style', () => {
  it('paints DARK text on a light surface', () => {
    setStatusBarBase('light');
    expect(lastStyle()).toBe('LIGHT');   // Capacitor: "Dark text for light backgrounds"
  });

  it('paints LIGHT text on a dark surface', () => {
    setStatusBarBase('dark');
    expect(lastStyle()).toBe('DARK');    // Capacitor: "Light text for dark backgrounds"
  });

  it('ignores an unknown surface rather than guessing', () => {
    setStatusBarBase('chartreuse');
    expect(setStyle).not.toHaveBeenCalled();
    expect(readStatusBarBase()).toBe('light');   // base unchanged
  });
});

describe('STAT-01 — hero override and restore', () => {
  it('restores the LIGHT theme after a dark hero', () => {
    setStatusBarBase('light');
    pushStatusBarSurface('dark');
    expect(lastStyle()).toBe('DARK');
    restoreStatusBarBase();
    expect(lastStyle()).toBe('LIGHT');
  });

  it('restores the DARK theme after a dark hero — the bug this replaces', () => {
    // Previously the unmount called a hardcoded light-surface helper, so a user
    // in dark mode left the hero with dark text on a dark background and no
    // effect scheduled to fix it.
    setStatusBarBase('dark');
    pushStatusBarSurface('dark');
    restoreStatusBarBase();
    expect(lastStyle()).toBe('DARK');
  });

  it('does not let a screen override change what restore returns to', () => {
    setStatusBarBase('dark');
    pushStatusBarSurface('light');
    expect(readStatusBarBase()).toBe('dark');
    restoreStatusBarBase();
    expect(lastStyle()).toBe('DARK');
  });

  it('survives a theme change while a hero is mounted', () => {
    setStatusBarBase('light');
    pushStatusBarSurface('dark');
    setStatusBarBase('dark');            // user flips theme mid-screen
    restoreStatusBarBase();
    expect(lastStyle()).toBe('DARK');
  });
});

describe('STAT-01 — PWA isolation', () => {
  it('touches the status bar on native only', () => {
    isNativePlatform.mockReturnValue(false);
    setStyle.mockClear();
    setStatusBarBase('dark');
    pushStatusBarSurface('light');
    restoreStatusBarBase();
    expect(setStyle).not.toHaveBeenCalled();
  });
});
