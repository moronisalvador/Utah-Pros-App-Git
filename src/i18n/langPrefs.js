/**
 * ════════════════════════════════════════════════
 * FILE: langPrefs.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The tiny, rule-only helper that remembers which language a person picked for
 *   the field-tech app (English, Portuguese, or Spanish) on THIS phone. It reads
 *   and writes that one saved choice and always hands back a language the app
 *   actually supports — falling back to English if nothing valid is saved. It has
 *   no React and no translation engine inside it on purpose, so it can be tested
 *   on its own.
 *
 * WHERE IT LIVES:
 *   Route:  n/a (a plain helper module)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (imported by src/i18n/index.js and LanguageContext.jsx)
 *   Data:      reads/writes localStorage key `upr_lang_pref` only (no DB, no server)
 *
 * NOTES / GOTCHAS:
 *   - Mirrors the theme-preference pattern (see src/contexts/ThemeContext.jsx):
 *     an allow-list validates the stored value, everything is wrapped in try/catch
 *     for private-mode / no-localStorage environments, and the default is an
 *     explicit product choice ('en'), never a guess from the phone's OS language.
 *   - Language button labels are ENDONYMS (each language shown in its own name),
 *     so LANG_LABELS reads the same regardless of the current UI language.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Constants ──────────────

export const LANG_STORAGE_KEY = 'upr_lang_pref';

/** The supported UI languages, in display order. English is first + the default. */
export const LANGS = ['en', 'pt', 'es'];

/** Shown in each language's own name (endonyms) — identical in every locale. */
export const LANG_LABELS = { en: 'English', pt: 'Português', es: 'Español' };

/**
 * Default when the person hasn't chosen. English — the app has always been in
 * English, so a phone set to another OS language shouldn't silently switch it.
 */
export const DEFAULT_LANG = 'en';

// ─── SECTION: Pure helpers (exported for tests) ──────────────

/** Coerce any value to a supported language code, else the default. Never throws. */
export function resolveLang(value) {
  return LANGS.includes(value) ? value : DEFAULT_LANG;
}

/**
 * Read the stored language. Returns a supported code, defaulting to English when
 * nothing valid is stored or localStorage is unavailable. Never throws.
 */
export function readStoredLang() {
  try {
    return resolveLang(localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return DEFAULT_LANG;
  }
}

/** Persist the chosen language on this device. Silently no-ops if storage is unavailable. */
export function writeStoredLang(value) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, resolveLang(value));
  } catch {
    /* private mode — the in-memory choice still applies for this session */
  }
}
