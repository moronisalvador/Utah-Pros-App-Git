/**
 * ════════════════════════════════════════════════
 * FILE: index.js (English locale bundle)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gathers every English word list into one object the translation engine
 *   can load in a single step.
 *
 *   English is the default and the fallback, so it is always included in the
 *   initial download — unlike Portuguese and Spanish, which load on demand.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./<namespace>.json (one file per screen area)
 *   Data:      none (bundled JSON; no DB, no network)
 *
 * NOTES / GOTCHAS:
 *   - Keep the keys here in sync with NAMESPACES in src/i18n/index.js. The
 *     locale-parity test fails if a namespace is missing from any language.
 * ════════════════════════════════════════════════
 */
import common from './common.json';
import nav from './nav.json';
import more from './more.json';
import settings from './settings.json';
import tech from './tech.json';
import tasks from './tasks.json';
import dash from './dash.json';
import schedule from './schedule.json';
import claims from './claims.json';
import appointment from './appointment.json';
import tracker from './tracker.json';
import job from './job.json';
import claimDetail from './claimDetail.json';
import apptForm from './apptForm.json';
import newCustomer from './newCustomer.json';
import newEvent from './newEvent.json';
import newJob from './newJob.json';
import hub from './hub.json';
import msgs from './msgs.json';
import customer from './customer.json';

export default { common, nav, more, settings, tech, tasks, dash, schedule, claims, appointment, tracker, job, claimDetail, apptForm, newCustomer, newEvent, newJob, hub, msgs, customer };
