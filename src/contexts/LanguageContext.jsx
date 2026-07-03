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
 *   - i18next is already initialized to the stored language in @/i18n, so first
 *     paint is already correct — this provider just keeps React state, the saved
 *     choice, and <html lang> in sync when the person switches.
 *   - Components read translations with react-i18next's `useTranslation(ns)`;
 *     they only need `useLanguage()` when they must know/set the raw code (the
 *     Settings language picker).
 * ════════════════════════════════════════════════
 */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import i18n from '@/i18n';
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

  // Keep the engine and <html lang> aligned with the current choice.
  useEffect(() => {
    if (i18n.language !== lang) i18n.changeLanguage(lang);
    try { document.documentElement.setAttribute('lang', lang); } catch { /* SSR/none */ }
  }, [lang]);

  const setLang = useCallback((next) => {
    const l = resolveLang(next);
    setLangState(l);
    writeStoredLang(l);
    i18n.changeLanguage(l);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
