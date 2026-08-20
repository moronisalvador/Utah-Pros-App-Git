/**
 * ════════════════════════════════════════════════
 * FILE: hubHelpers.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small, pure decision-makers behind the merged Job Hub screen — the
 *   parts risky enough that they get their own tests. Four jobs:
 *   (1) pick which appointment the hub opens to (the "visit picker"): honor the
 *       ?appt= in the URL when it really belongs to this job, otherwise fall
 *       back to what the tech would want to see — a visit they're actively on,
 *       else today's, else the next upcoming, else the most recent past one;
 *   (2) decide whether the screen leads with a VISIT or with the JOB — a tech
 *       who is on the clock sees their clock, a tech who tapped through from
 *       the schedule sees that appointment, and anyone who just opened the job
 *       from Claims sees the job itself with no clock buttons to press by
 *       mistake;
 *   (3) decide whether the red "No signed Work Authorization" banner shows,
 *       matching the exact rule both legacy pages used;
 *   (4) build the job_documents query string so older photos/notes (some tagged
 *       only to the job, some only to the appointment) all still show up;
 *   (5) work out the one-line drying summary the collapsed "Dry Logs" row shows
 *       — what drying day this is, and how many measured spots are dry.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module for /tech/job/:jobId)
 *   Rendered by:  n/a — imported by TechJobHub.jsx + hub/* components
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (pure functions — the caller supplies the data)
 *
 * NOTES / GOTCHAS:
 *   - selectVisitId takes `todayStr` ('YYYY-MM-DD') explicitly so it is
 *     deterministic and testable; the page passes the server/local Denver day.
 *   - showWorkAuthBanner treats a missing hub payload as "don't show" so the
 *     banner never flashes before the job loads (parity with the legacy
 *     "assume signed until checked" default).
 *   - buildDocsQuery reproduces TechAppointment's OR-fallback byte-for-byte so
 *     the doc gallery keeps its historical coverage.
 * ════════════════════════════════════════════════
 */

const LIVE_STATUSES = ['en_route', 'in_progress', 'paused'];
const DONE_STATUSES = ['completed', 'cancelled'];

const crewHas = (appt, employeeId) =>
  (appt.crew || []).some((c) => c.employee_id === employeeId);

// Ascending by date then time — soonest first.
const byDateTimeAsc = (a, b) =>
  (a.date || '').localeCompare(b.date || '') ||
  (a.time_start || '').localeCompare(b.time_start || '');

// Descending by date then time — most recent first.
const byDateTimeDesc = (a, b) =>
  (b.date || '').localeCompare(a.date || '') ||
  (b.time_start || '').localeCompare(a.time_start || '');

/**
 * The default visit when the URL doesn't pin one (or pins a stale one).
 * Priority mirrors pickNowNext, plus a most-recent-past fallback so a job with
 * only finished visits still opens to something.
 * @returns {string|null} appointment id
 */
function defaultVisitId(appointments, employeeId, todayStr) {
  const live = appointments.find(
    (a) => LIVE_STATUSES.includes(a.status) && crewHas(a, employeeId),
  );
  if (live) return live.id;

  const todayMine = appointments.find(
    (a) => a.date === todayStr && crewHas(a, employeeId) && !DONE_STATUSES.includes(a.status),
  );
  if (todayMine) return todayMine.id;

  const upcoming = appointments
    .filter((a) => a.date >= todayStr && !DONE_STATUSES.includes(a.status))
    .sort(byDateTimeAsc);
  if (upcoming.length) return upcoming[0].id;

  const mostRecent = [...appointments].sort(byDateTimeDesc)[0];
  return mostRecent ? mostRecent.id : null;
}

/**
 * Choose the appointment the hub should show.
 * @param {Array<object>} appointments - the job's appointments (get_job_hub shape)
 * @param {string|null} apptParam - the URL ?appt= value (may be missing/stale)
 * @param {string} employeeId - the viewing tech
 * @param {string} todayStr - 'YYYY-MM-DD' for "today"
 * @returns {string|null} the selected appointment id, or null if the job has none
 */
export function selectVisitId(appointments, apptParam, employeeId, todayStr) {
  if (!appointments || appointments.length === 0) return null;
  if (apptParam && appointments.some((a) => a.id === apptParam)) return apptParam;
  return defaultVisitId(appointments, employeeId, todayStr);
}

/** The soonest visit that hasn't happened yet, ignoring one id (the current visit). */
function nextUpcomingId(appointments, todayStr, excludeId) {
  const next = appointments
    .filter((a) => a.id !== excludeId && a.date >= todayStr && !DONE_STATUSES.includes(a.status))
    .sort(byDateTimeAsc)[0];
  return next ? next.id : null;
}

/**
 * Which hero the Job Hub leads with, and for which visit.
 *
 * The rule is deterministic and reads two facts, never a guess (spec §12.5):
 *   1. Is a visit on this job actually RUNNING for this tech (en route, working,
 *      paused)? Then that visit's clock wins — you can't be "reviewing a job"
 *      while you're on the clock for it.
 *   2. Otherwise, did an appointment send us here (the URL names one that really
 *      belongs to this job)? Then show that appointment.
 *   3. Otherwise the tech opened the job itself — show the JOB, with no clock.
 *
 * Rule 3 is why this exists: today the hub always manufactures a visit, so a job
 * opened from Claims shows a Finish button for a visit nobody started.
 *
 * @param {{ appointments?: Array<object>, apptParam?: string|null,
 *           employeeId?: string, todayStr: string }} input
 * @returns {{ mode: 'appointment'|'job', visitId: string|null,
 *             nextVisitId: string|null, reason: string }}
 *   `visitId` is the visit the hero is about — always null in job mode, which is
 *   what keeps the clock, the crew strip and the "Viewing" badge off that screen.
 *   `nextVisitId` is the visit the "Next visit" row offers to jump into.
 */
export function resolveHero({ appointments, apptParam, employeeId, todayStr }) {
  const list = Array.isArray(appointments) ? appointments : [];
  if (list.length === 0) {
    return { mode: 'job', visitId: null, nextVisitId: null, reason: 'no-visits' };
  }

  const live = list.find(
    (a) => LIVE_STATUSES.includes(a.status) && crewHas(a, employeeId),
  );
  if (live) {
    return {
      mode: 'appointment',
      visitId: live.id,
      nextVisitId: nextUpcomingId(list, todayStr, live.id),
      reason: 'clock-running',
    };
  }

  if (apptParam && list.some((a) => a.id === apptParam)) {
    return {
      mode: 'appointment',
      visitId: apptParam,
      nextVisitId: nextUpcomingId(list, todayStr, apptParam),
      reason: 'from-appointment',
    };
  }

  return {
    mode: 'job',
    visitId: null,
    nextVisitId: nextUpcomingId(list, todayStr, null),
    reason: 'job-nav',
  };
}

/**
 * Whether the "No signed Work Authorization" banner should show.
 * Parity: TechAppointment.jsx:788 (`job && !workAuthSigned`) and
 * TechJobDetail.jsx:377 (`!workAuthSigned`, job always present). A missing hub
 * payload → false, so the banner never flashes before load.
 * @param {{ job?: object|null, work_auth_signed?: boolean }|null} hub
 * @returns {boolean}
 */
export function showWorkAuthBanner(hub) {
  if (!hub || !hub.job) return false;
  return hub.work_auth_signed === false;
}

/**
 * Whether the drying tools — the moisture log, the equipment list, the More
 * sheet's "Take a reading" row and the water-loss report — belong on this job.
 *
 * WRITTEN AS HIDE-FOR-RECONSTRUCTION, NOT ALLOW-THE-MITIGATION-DIVISIONS, and
 * that is deliberate rather than lazy: the two MITIGATION_DIVS constants in this
 * repository DISAGREE about `fire`, so an allowlist would silently change what a
 * fire job shows depending on which one this file happened to copy. Naming the
 * one division the owner asked to change keeps every other division exactly as
 * it is today.
 *
 * A reconstruction-specific Hub — what a reconstruction visit SHOULD show
 * (phases, sub-trades, material selections, punch list) — is a later wave. This
 * only stops mitigation-only UI appearing on a reconstruction job, where it
 * rendered as permanent empty states with live "+ Add reading" buttons.
 *
 * @param {string|null|undefined} division - jobs.division
 * @returns {boolean}
 */
export function showsDryingTools(division) {
  return division !== 'reconstruction';
}

/**
 * Build the job_documents PostgREST query string for the hub.
 * - both ids  → OR-fallback (parity with TechAppointment.jsx:156) so a doc tagged
 *   to the appointment OR to the job is caught (older docs predate appt tagging).
 * - appt only → appointment-scoped (parity with TechAppointment.jsx:157).
 * - job only  → job-wide (the hub's default gallery scope).
 * - neither   → null (nothing to query).
 * @param {{ appointmentId?: string|null, jobId?: string|null }} scope
 * @returns {string|null}
 */
export function buildDocsQuery({ appointmentId, jobId }) {
  const tail = 'select=*&order=created_at.desc';
  if (appointmentId && jobId) {
    return `or=(appointment_id.eq.${appointmentId},job_id.eq.${jobId})&${tail}`;
  }
  if (appointmentId) return `appointment_id=eq.${appointmentId}&${tail}`;
  if (jobId) return `job_id=eq.${jobId}&${tail}`;
  return null;
}
