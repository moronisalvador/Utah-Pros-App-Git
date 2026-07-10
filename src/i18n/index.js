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
import enTasks from './locales/en/tasks.json';
import enDash from './locales/en/dash.json';
import enSchedule from './locales/en/schedule.json';
import enClaims from './locales/en/claims.json';
import enAppointment from './locales/en/appointment.json';
import enTracker from './locales/en/tracker.json';
import enJob from './locales/en/job.json';
import enClaimDetail from './locales/en/claimDetail.json';
import enApptForm from './locales/en/apptForm.json';
import enNewCustomer from './locales/en/newCustomer.json';
import enNewEvent from './locales/en/newEvent.json';
import enNewJob from './locales/en/newJob.json';
import enHub from './locales/en/hub.json'; // Job Hub v2 (Phase H1)
import enMsgs from './locales/en/msgs.json'; // Tech Messages v2 (Phase F-M)

import ptCommon from './locales/pt/common.json';
import ptNav from './locales/pt/nav.json';
import ptMore from './locales/pt/more.json';
import ptSettings from './locales/pt/settings.json';
import ptTech from './locales/pt/tech.json';
import ptTasks from './locales/pt/tasks.json';
import ptDash from './locales/pt/dash.json';
import ptSchedule from './locales/pt/schedule.json';
import ptClaims from './locales/pt/claims.json';
import ptAppointment from './locales/pt/appointment.json';
import ptTracker from './locales/pt/tracker.json';
import ptJob from './locales/pt/job.json';
import ptClaimDetail from './locales/pt/claimDetail.json';
import ptApptForm from './locales/pt/apptForm.json';
import ptNewCustomer from './locales/pt/newCustomer.json';
import ptNewEvent from './locales/pt/newEvent.json';
import ptNewJob from './locales/pt/newJob.json';
import ptHub from './locales/pt/hub.json'; // Job Hub v2 (Phase H1)
import ptMsgs from './locales/pt/msgs.json'; // Tech Messages v2 (Phase F-M)

import esCommon from './locales/es/common.json';
import esNav from './locales/es/nav.json';
import esMore from './locales/es/more.json';
import esSettings from './locales/es/settings.json';
import esTech from './locales/es/tech.json';
import esTasks from './locales/es/tasks.json';
import esDash from './locales/es/dash.json';
import esSchedule from './locales/es/schedule.json';
import esClaims from './locales/es/claims.json';
import esAppointment from './locales/es/appointment.json';
import esTracker from './locales/es/tracker.json';
import esJob from './locales/es/job.json';
import esClaimDetail from './locales/es/claimDetail.json';
import esApptForm from './locales/es/apptForm.json';
import esNewCustomer from './locales/es/newCustomer.json';
import esNewEvent from './locales/es/newEvent.json';
import esNewJob from './locales/es/newJob.json';
import esHub from './locales/es/hub.json'; // Job Hub v2 (Phase H1)
import esMsgs from './locales/es/msgs.json'; // Tech Messages v2 (Phase F-M)

/** Every translation namespace (one file per screen area). Keep in sync with resources. */
export const NAMESPACES = ['common', 'nav', 'more', 'settings', 'tech', 'tasks', 'dash', 'schedule', 'claims', 'appointment', 'tracker', 'job', 'claimDetail', 'apptForm', 'newCustomer', 'newEvent', 'newJob', 'hub', 'msgs'];

export const resources = {
  en: { common: enCommon, nav: enNav, more: enMore, settings: enSettings, tech: enTech, tasks: enTasks, dash: enDash, schedule: enSchedule, claims: enClaims, appointment: enAppointment, tracker: enTracker, job: enJob, claimDetail: enClaimDetail, apptForm: enApptForm, newCustomer: enNewCustomer, newEvent: enNewEvent, newJob: enNewJob, hub: enHub, msgs: enMsgs },
  pt: { common: ptCommon, nav: ptNav, more: ptMore, settings: ptSettings, tech: ptTech, tasks: ptTasks, dash: ptDash, schedule: ptSchedule, claims: ptClaims, appointment: ptAppointment, tracker: ptTracker, job: ptJob, claimDetail: ptClaimDetail, apptForm: ptApptForm, newCustomer: ptNewCustomer, newEvent: ptNewEvent, newJob: ptNewJob, hub: ptHub, msgs: ptMsgs },
  es: { common: esCommon, nav: esNav, more: esMore, settings: esSettings, tech: esTech, tasks: esTasks, dash: esDash, schedule: esSchedule, claims: esClaims, appointment: esAppointment, tracker: esTracker, job: esJob, claimDetail: esClaimDetail, apptForm: esApptForm, newCustomer: esNewCustomer, newEvent: esNewEvent, newJob: esNewJob, hub: esHub, msgs: esMsgs },
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
