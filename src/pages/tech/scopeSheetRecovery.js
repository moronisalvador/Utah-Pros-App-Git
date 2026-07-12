/**
 * ════════════════════════════════════════════════
 * FILE: scopeSheetRecovery.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One small rule used by the scope sheet: after the phone kills the app and
 *   reloads it from scratch (which loses the draft id from the web address),
 *   should we automatically reopen the tech's in-progress draft, or start a
 *   blank sheet? This file holds only that decision — no screen, no storage —
 *   so its rules can be tested on their own.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none (imported by TechDemoSheet.jsx)
 *
 * NOTES / GOTCHAS:
 *   - Pure function: no localStorage / DOM access. The caller reads the durable
 *     'scopesheet:active' pointer and the mirror, then passes them in.
 * ════════════════════════════════════════════════
 */

// Decide which draft (if any) to auto-resume after a cold relaunch dropped the
// ?id param. Returns the draft id to resume, or null to start fresh.
//   active     — the durable pointer { id, ts, jobId, jobNumber } | null
//   hasMirror  — whether an unsynced localStorage mirror exists for active.id
//   appt       — { jobId, jobNumber } from prefill params ('' when absent)
//   now, ttlMs — recency guard so stale abandoned drafts aren't force-resumed
export function pickResumeDraftId(active, hasMirror, appt, now, ttlMs) {
  // Need a saved-row id AND unsynced edits — the pending-mirror path handles
  // the never-saved case, and a synced draft belongs in the "Resume" banner.
  if (!active || !active.id || !hasMirror) return null;
  if (now - (active.ts || 0) > ttlMs) return null;
  const fromAppt = !!(appt && (appt.jobId || appt.jobNumber));
  // Plain tool entry: resume the last active draft outright.
  if (!fromAppt) return active.id;
  // Opened from an appointment: only resume if the active draft is for THIS
  // job, so re-opening a DIFFERENT appointment's sheet doesn't cross drafts.
  if (appt.jobId && active.jobId && appt.jobId === active.jobId) return active.id;
  if (appt.jobNumber && active.jobNumber && appt.jobNumber === active.jobNumber) return active.id;
  return null;
}
