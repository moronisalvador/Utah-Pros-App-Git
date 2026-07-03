/**
 * ════════════════════════════════════════════════
 * FILE: index.js (i18n)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Starts up the app's translation engine. It loads the English, Portuguese, and
 *   Spanish word lists and tells the engine which language to show first (the one
 *   this phone last picked, or English). After this runs, any tech screen can ask
 *   for a piece of text by name and get it back in the chosen language. If a phrase
 *   hasn't been translated yet, English is shown instead — so a half-translated
 *   screen never breaks.
 *
 * WHERE IT LIVES:
 *   Route:  n/a (imported once for its side effect — it initializes i18next)
 *
 * DEPENDS ON:
 *   Packages:  i18next, react-i18next
 *   Internal:  ./langPrefs (which language to start in), ./locales/<lang>/<ns>.json
 *   Data:      none (translations are bundled JSON; no DB, no network)
 *
 * NOTES / GOTCHAS:
 *   - Resources are BUNDLED (static JSON imports), so init is synchronous and
 *     `t()` works on the very first render — hence `react.useSuspense: false`
 *     (there is nothing to wait for). Lazy-loading PT/ES is a later optimization.
 *   - `fallbackLng: 'en'` is what makes the phased rollout safe: any missing key
 *     in pt/es renders the English source, never a crash or a blank.
 *   - ADDING A STRING: put the key in `locales/en/<ns>.json` first (source of
 *     truth), then the same key in `pt` and `es`. New namespace → add its four
 *     imports + a line in each `resources.<lang>` block + `NAMESPACES`.
 * ════════════════════════════════════════════════
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LANGS, DEFAULT_LANG, readStoredLang } from './langPrefs.js';

import enCommon from './locales/en/common.json';
import enNav from './locales/en/nav.json';
import enMore from './locales/en/more.json';
import enSettings from './locales/en/settings.json';
import enTech from './locales/en/tech.json';

import ptCommon from './locales/pt/common.json';
import ptNav from './locales/pt/nav.json';
import ptMore from './locales/pt/more.json';
import ptSettings from './locales/pt/settings.json';
import ptTech from './locales/pt/tech.json';

import esCommon from './locales/es/common.json';
import esNav from './locales/es/nav.json';
import esMore from './locales/es/more.json';
import esSettings from './locales/es/settings.json';
import esTech from './locales/es/tech.json';

/** Every translation namespace (one file per screen area). Keep in sync with resources. */
export const NAMESPACES = ['common', 'nav', 'more', 'settings', 'tech'];

export const resources = {
  en: { common: enCommon, nav: enNav, more: enMore, settings: enSettings, tech: enTech },
  pt: { common: ptCommon, nav: ptNav, more: ptMore, settings: ptSettings, tech: ptTech },
  es: { common: esCommon, nav: esNav, more: esMore, settings: esSettings, tech: esTech },
};

i18n.use(initReactI18next).init({
  resources,
  lng: readStoredLang(),
  fallbackLng: DEFAULT_LANG,
  supportedLngs: LANGS,
  ns: NAMESPACES,
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes — double-escaping mangles text
  returnNull: false,
  react: { useSuspense: false },
});

export default i18n;
