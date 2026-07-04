/**
 * ════════════════════════════════════════════════
 * FILE: hubHelpers.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small, pure decision-makers behind the merged Job Hub screen — the
 *   parts risky enough that they get their own tests. Three jobs:
 *   (1) pick which appointment the hub opens to (the "visit picker"): honor the
 *       ?appt= in the URL when it really belongs to this job, otherwise fall
 *       back to what the tech would want to see — a visit they're actively on,
 *       else today's, else the next upcoming, else the most recent past one;
 *   (2) decide whether the red "No signed Work Authorization" banner shows,
 *       matching the exact rule both legacy pages used;
 *   (3) build the job_documents query string so older photos/notes (some tagged
 *       only to the job, some only to the appointment) all still show up.
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
