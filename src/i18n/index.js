/**
 * ════════════════════════════════════════════════
 * FILE: index.js (i18n)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Starts up the app's translation engine. English is built in and ready
 *   instantly. Portuguese and Spanish are fetched only when somebody actually
 *   uses them, so English-speaking phones never download words they will not
 *   read. After this runs, any tech screen can ask for a piece of text by name
 *   and get it back in the chosen language. If a phrase hasn't been translated
 *   yet, English is shown instead — so a half-translated screen never breaks.
 *
 * WHERE IT LIVES:
 *   Route:  n/a (imported once for its side effect — it initializes i18next)
 *
 * DEPENDS ON:
 *   Packages:  i18next, react-i18next
 *   Internal:  ./langPrefs (which language to start in),
 *              ./locales/en/index.js (bundled), ./locales/{pt,es}/index.js (on demand)
 *   Data:      none (translations are bundled JSON; no DB, no network)
 *
 * NOTES / GOTCHAS:
 *   - English is STATIC, pt/es are DYNAMIC. English init stays synchronous, so
 *     `t()` works on the very first render and `react.useSuspense: false` remains
 *     correct. Changed 2026-07-27: pt+es were statically imported, putting ~78 KB
 *     raw of locales nobody had chosen into the entry bundle. perf-budget.md §4
 *     already required them lazy; this makes the code match the rule.
 *   - `ensureLanguage(lng)` MUST resolve before `i18n.changeLanguage(lng)`, or
 *     the switch renders English until the chunk lands. LanguageContext owns that
 *     ordering — do not call `changeLanguage` for pt/es from anywhere else.
 *   - `fallbackLng: 'en'` is what makes the phased rollout safe: any missing key
 *     in pt/es renders the English source, never a crash or a blank.
 *   - ADDING A STRING: put the key in `locales/en/<ns>.json` first (source of
 *     truth), then the same key in `pt` and `es`. New namespace → add its import
 *     to all THREE `locales/<lang>/index.js` barrels + a line in `NAMESPACES`.
 * ════════════════════════════════════════════════
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGS, DEFAULT_LANG, readStoredLang } from './langPrefs.js';

import enResources from './locales/en/index.js';

/** Every translation namespace (one file per screen area). Keep in sync with the barrels. */
export const NAMESPACES = ['common', 'nav', 'more', 'settings', 'tech', 'tasks', 'dash', 'schedule', 'claims', 'appointment', 'tracker', 'job', 'claimDetail', 'apptForm', 'newCustomer', 'newEvent', 'newJob', 'hub', 'msgs', 'customer', 'contractor'];

/**
 * Bundled resources. English ONLY — pt/es arrive through ensureLanguage().
 * Still an object keyed by language so existing readers of `resources.en` work.
 */
export const resources = { en: enResources };

// ─── SECTION: On-demand locale loading ──────────────

/**
 * One dynamic import per non-default language. Each barrel is a single module,
 * so Vite emits ONE chunk per language rather than 19 loose JSON chunks.
 * A static import of these paths anywhere in app code silently undoes the split.
 */
const LOADERS = {
  pt: () => import('./locales/pt/index.js'),
  es: () => import('./locales/es/index.js'),
};

/** In-flight/settled loads, so N concurrent callers trigger ONE fetch. */
const inFlight = new Map();

/**
 * Make `lng` usable by the engine, fetching it if needed. Idempotent, safe to
 * call concurrently, and a no-op for English (already bundled) or an unknown
 * code. Resolves to true when the language is ready to display.
 *
 * On failure it resolves FALSE rather than throwing: a locale chunk that will
 * not download must degrade to English, never break the app for a field tech.
 */
export async function ensureLanguage(lng) {
  if (lng === DEFAULT_LANG || !LOADERS[lng]) return true;
  if (i18n.hasResourceBundle?.(lng, 'common')) return true;

  if (!inFlight.has(lng)) {
    inFlight.set(lng, LOADERS[lng]()
      .then((mod) => {
        const bundle = mod.default;
        for (const ns of NAMESPACES) {
          // deep=false, overwrite=false — never clobber a bundle already present.
          i18n.addResourceBundle(lng, ns, bundle[ns], false, false);
        }
        resources[lng] = bundle;
        return true;
      })
      .catch((e) => {
        // Let a later attempt retry instead of caching the failure forever.
        inFlight.delete(lng);
        console.error(`i18n: failed to load "${lng}" locale, staying on English`, e);
        return false;
      }));
  }
  return inFlight.get(lng);
}

// ─── SECTION: Engine init ──────────────

const startingLang = readStoredLang();

i18n.use(initReactI18next).init({
  resources,
  // Boot in English even when pt/es is stored: its bundle is not here yet, and
  // naming a language with no resources renders raw keys on the first paint.
  // LanguageProvider awaits initialLanguageReady, then switches — so the first
  // thing drawn is already the right language.
  lng: DEFAULT_LANG,
  fallbackLng: DEFAULT_LANG,
  supportedLngs: LANGS,
  ns: NAMESPACES,
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes — double-escaping mangles text
  returnNull: false,
  react: { useSuspense: false },
});

/**
 * Resolves once the stored language is loaded AND active. English resolves on
 * the spot (no await, no fetch), so the common path is unchanged.
 * LanguageProvider gates its first render on this to avoid showing English to
 * somebody who chose Portuguese.
 */
export const initialLanguageReady = startingLang === DEFAULT_LANG
  ? Promise.resolve(true)
  : ensureLanguage(startingLang).then(async (ok) => {
    if (ok) await i18n.changeLanguage(startingLang);
    return ok;
  });

export default i18n;
