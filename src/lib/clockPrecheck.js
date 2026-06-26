/**
 * ════════════════════════════════════════════════
 * FILE: clockPrecheck.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Before a field tech taps "On My Way" on a new appointment, this asks the
 *   database whether the tech is still clocked in somewhere else. If so, the app
 *   shows a confirmation sheet (or a hard-block message). It also has tiny helpers
 *   to format the other job's name and how long they've been on it.
 *
 * WHERE IT LIVES:
 *   Exports: runOmwPrecheck, jobLabel, fmtElapsed
 *   Used by: src/components/tech/TimeTracker.jsx, src/pages/tech/TechDash.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  the `db` client passed in from useAuth()
 *   Data:      reads → clock_omw_precheck RPC (job_time_entries, appointments, jobs,
 *                       feature_flags). writes → none.
 *
 * NOTES / GOTCHAS:
 *   - FAIL-OPEN by design: if the RPC errors (e.g. the DB migration isn't applied
 *     yet, or the device is offline), this returns "no confirmation needed" so the
 *     caller proceeds with the normal On-My-Way flow exactly as before. PR-2 must
 *     never make the clock harder to use than it was pre-PR-2.
 * ════════════════════════════════════════════════
 */

const NO_PROMPT = { requires_confirmation: false, enforce_explicit: false, open_entry: null };

// ─── SECTION: Helpers ──────────────
// Ask the DB whether starting `appointmentId` would supersede another open clock.
export async function runOmwPrecheck(db, appointmentId, employeeId) {
  try {
    const res = await db.rpc('clock_omw_precheck', {
      p_appointment_id: appointmentId,
      p_employee_id: employeeId,
    });
    if (!res || typeof res !== 'object') return NO_PROMPT;
    return {
      requires_confirmation: !!res.requires_confirmation,
      enforce_explicit: !!res.enforce_explicit,
      open_entry: res.open_entry || null,
    };
  } catch {
    return NO_PROMPT; // fail-open — never block the clock on a precheck failure
  }
}

// Human label for the other open job, e.g. "1042 — Smith" or the appointment title.
export function jobLabel(openEntry) {
  if (!openEntry) return 'another job';
  const name = openEntry.insured_name || openEntry.title;
  if (openEntry.job_number && name) return `${openEntry.job_number} — ${name}`;
  return openEntry.job_number || name || 'another job';
}

// "45m" / "1h 5m" from a minutes number (rounded on the server).
export function fmtElapsed(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}
