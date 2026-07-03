/**
 * ════════════════════════════════════════════════
 * FILE: ThemeContext.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the app remember whether the person wants a light look, a dark look,
 *   or to just follow whatever their phone is set to ("System"). It saves that
 *   choice on the device and flips a single switch on the page so the tech
 *   screens repaint in the chosen colors. Nothing is sent to the server — the
 *   preference lives on this device only.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a context provider wrapped around the whole app)
 *   Rendered by:  src/App.jsx (mounted just outside AuthProvider)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/nativeAppearance (statusBarLight/statusBarDark — no-op on web)
 *   Data:      reads/writes localStorage key `upr_theme_pref` only (no DB)
 *
 * NOTES / GOTCHAS:
 *   - Sets `data-theme="dark|light"` on <html>. The tech dark palette is scoped
 *     to `[data-theme="dark"] .tech-layout` in index.css, so only the tech shell
 *     goes dark today — the desktop/office UI is unaffected until a later phase.
 *   - "System" subscribes to the OS `prefers-color-scheme` change so it follows
 *     the phone live.
 *   - Status-bar calls are Capacitor-only (no-op in the browser/PWA); the PWA's
 *     status bar follows the `theme-color` meta + the OS.
 * ════════════════════════════════════════════════
 */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { statusBarLight, statusBarDark } from '@/lib/nativeAppearance';

// ─── SECTION: Constants & pure helpers (exported for tests) ──────────────

export const THEME_STORAGE_KEY = 'upr_theme_pref';
export const THEME_MODES = ['system', 'light', 'dark'];

/** Resolve the mode + the OS preference into the concrete theme to paint. */
export function resolveEffectiveTheme(mode, systemPrefersDark) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemPrefersDark ? 'dark' : 'light'; // mode === 'system' (or anything unknown)
}

/** Read the stored mode, defaulting to 'system'. Never throws. */
export function readStoredThemeMode() {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark() {
  try {
    return typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  } catch {
    return false;
  }
}

// ─── SECTION: Context ──────────────

const ThemeContext = createContext({ mode: 'system', effective: 'light', setMode: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  // ─── State & hooks ──────────────
  const [mode, setModeState] = useState(readStoredThemeMode);
  const [sysDark, setSysDark] = useState(systemPrefersDark);

  // Track the OS preference live via one persistent subscription. `sysDark` is
  // only consulted when mode === 'system' (see resolveEffectiveTheme), so we
  // don't gate the listener on mode — that keeps it correct without a
  // synchronous setState inside the effect body.
  useEffect(() => {
    let mql;
    try { mql = window.matchMedia('(prefers-color-scheme: dark)'); } catch { return undefined; }
    const onChange = (e) => setSysDark(e.matches);
    // addEventListener is the modern API; older Safari used addListener.
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else if (mql.removeListener) mql.removeListener(onChange);
    };
  }, []);

  const effective = resolveEffectiveTheme(mode, sysDark);

  // Apply the theme to <html> + coordinate the native status bar.
  useEffect(() => {
    try { document.documentElement.setAttribute('data-theme', effective); } catch { /* SSR/none */ }
    // Native shell only (no-op on web/PWA): dark bg → light status-bar text.
    if (effective === 'dark') statusBarLight(); else statusBarDark();
  }, [effective]);

  const setMode = useCallback((next) => {
    const m = THEME_MODES.includes(next) ? next : 'system';
    setModeState(m);
    try { localStorage.setItem(THEME_STORAGE_KEY, m); } catch { /* private mode — in-memory only */ }
    if (m === 'system') setSysDark(systemPrefersDark());
  }, []);

  const value = useMemo(() => ({ mode, effective, setMode }), [mode, effective, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
