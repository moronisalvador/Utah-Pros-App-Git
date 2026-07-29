/**
 * ════════════════════════════════════════════════
 * FILE: LanguageContext.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the app remember whether the person wants the field-tech screens in
 *   English, Portuguese, or Spanish, and flips the whole app to that language when
 *   they change it. It saves the choice on this device only — nothing is sent to
 *   the server. This is the language twin of the light/dark ThemeContext.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a context provider wrapped around the whole app)
 *   Rendered by:  src/App.jsx (mounted alongside ThemeProvider)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/i18n (the translation engine instance), @/i18n/langPrefs (pure
 *              storage helpers)
 *   Data:      reads/writes localStorage key `upr_lang_pref` only (no DB)
 *
 * NOTES / GOTCHAS:
 *   - English is bundled; Portuguese and Spanish are fetched on demand (see
 *     @/i18n). So this provider now OWNS THE ORDERING: load the locale, then
 *     switch. Calling i18n.changeLanguage('pt') directly from anywhere else
 *     renders English until the chunk happens to land.
 *   - On a cold boot in pt/es, children are held back until that one chunk
 *     arrives, so the first paint is already in the right language instead of
 *     flashing English and swapping. English boots with no wait at all.
 *   - A locale that fails to download resolves to English rather than throwing.
 *     A tech in a basement gets a readable app, not a broken one.
 *   - Components read translations with react-i18next's `useTranslation(ns)`;
 *     they only need `useLanguage()` when they must know/set the raw code (the
 *     Settings language picker).
 * ════════════════════════════════════════════════
 */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import i18n, { ensureLanguage, initialLanguageReady } from '@/i18n';
import {
  LANGS, LANG_LABELS, DEFAULT_LANG, readStoredLang, writeStoredLang, resolveLang,
} from '@/i18n/langPrefs';

// Re-export the constant prefs so consumers (e.g. the settings picker) can pull
// them from the context alongside the hook. Pure helpers stay in @/i18n/langPrefs.
export { LANGS, LANG_LABELS, DEFAULT_LANG };

const LanguageContext = createContext({ lang: DEFAULT_LANG, setLang: () => {} });

// The hook must co-locate with its provider (standard context-module shape).
// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  return useContext(LanguageContext);
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang);
  // English needs no fetch, so it is ready on the first render and this gate is
  // a no-op. Only a stored pt/es pays a wait, and only on a cold boot.
  const [ready, setReady] = useState(() => readStoredLang() === DEFAULT_LANG);

  useEffect(() => {
    if (ready) return undefined;
    let cancelled = false;
    // Resolves false if the chunk failed; either way we render — English is the
    // fallback, and a blocked boot would be far worse than untranslated text.
    initialLanguageReady.then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [ready]);

  // Keep the engine and <html lang> aligned with the current choice. The engine
  // switch is ordered behind the locale load; <html lang> is set immediately
  // because it is metadata, not visible text.
  useEffect(() => {
    let cancelled = false;
    if (i18n.language !== lang) {
      ensureLanguage(lang).then(() => {
        if (!cancelled && i18n.language !== lang) i18n.changeLanguage(lang);
      });
    }
    try { document.documentElement.setAttribute('lang', lang); } catch { /* SSR/none */ }
    return () => { cancelled = true; };
  }, [lang]);

  const setLang = useCallback(async (next) => {
    const l = resolveLang(next);
    writeStoredLang(l);
    // Fetch BEFORE switching, so the picker never flips the UI to raw keys or a
    // half-translated screen. Awaiting a cached/bundled locale is a microtask.
    await ensureLanguage(l);
    setLangState(l);
    await i18n.changeLanguage(l);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);

  // Holding children back avoids an English flash for a pt/es tech. This is the
  // app-boot path, where a brief blank is already the norm.
  if (!ready) return null;

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
