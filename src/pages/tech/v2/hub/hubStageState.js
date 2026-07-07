/**
 * ════════════════════════════════════════════════
 * FILE: hubStageState.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pure decisions behind the Job Hub stage: is the viewing tech on this
 *   visit's crew (if not, the stage is read-only), which of the three shapes the
 *   stage takes (arriving / working / wrapped), and whether to show the "you're
 *   clocked into another job" banner. Kept separate so they can be unit-tested
 *   without a browser.
 *
 * WHERE IT LIVES:
 *   Exports: isOnCrew, stageBucket, shouldShowElsewhere
 *   Used by: src/pages/tech/v2/hub/HubStage.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (pure functions)
 * ════════════════════════════════════════════════
 */

/** Is the viewer on the visit's crew? Non-crew → read-only stage (no clock). */
export function isOnCrew(crew, employeeId) {
  return (crew || []).some((c) => c.employee_id === employeeId);
}

/**
 * Which shape the stage takes, from the viewer's OWN clock status. A cancelled
 * visit is always wrapped-gray (no clock actions), regardless of any entries.
 * @param {'scheduled'|'omw'|'on_site'|'paused'|'completed'} clockStatus
 * @param {boolean} isCancelled
 * @returns {'arriving'|'working'|'wrapped'}
 */
export function stageBucket(clockStatus, isCancelled) {
  if (isCancelled) return 'wrapped';
  if (clockStatus === 'on_site' || clockStatus === 'paused') return 'working';
  if (clockStatus === 'completed') return 'wrapped';
  return 'arriving';
}

/**
 * Show the "clocked into another job" banner only when there's an open entry on
 * a DIFFERENT appointment than the one being viewed (the precheck already scopes
 * to other appointments; this is the belt-and-suspenders guard).
 * @param {{appointment_id?:string}|null} openEntry
 * @param {string|null} selectedApptId
 * @returns {boolean}
 */
export function shouldShowElsewhere(openEntry, selectedApptId) {
  return !!(openEntry && openEntry.appointment_id && openEntry.appointment_id !== selectedApptId);
}
