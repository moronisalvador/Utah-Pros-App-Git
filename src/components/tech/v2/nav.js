/**
 * ════════════════════════════════════════════════
 * FILE: nav.js  (tech v2 nav helpers)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place that decides which URL a tap on an appointment or a job opens
 *   to, across the whole v2 tech app. Every v2 screen links through these two
 *   helpers instead of hardcoding a path. That way the later "Job Hub" merge (M2)
 *   flips a single constant here and every link retargets at once — no hunt across
 *   files.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — imported by v2 pages/components
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - FROZEN contract for the wave: S/D/M1 import apptHref/jobHref and must NOT
 *     hardcode '/tech/appointment/' or '/tech/jobs/'.
 *   - The hub switch is now RUNTIME + PER-USER (not a build constant):
 *     AuthContext calls setHubNav() with the viewer's page:tech_job_hub result,
 *     so ONLY users the flag is on for get hub links — everyone else keeps the
 *     legacy pages, which makes the repoint prod-safe (no fallback route needed)
 *     and EASY TO REVERT: turn the page:tech_job_hub flag off in DevTools → Flags
 *     and reload — nav falls back to legacy instantly, no deploy.
 *   - M2 (later) opens the flag to all techs, adds a /tech/appointment resolver
 *     for old links, and deletes the legacy pages.
 * ════════════════════════════════════════════════
 */

// Per-user Job Hub nav switch, mirrored here by AuthContext from the viewer's
// page:tech_job_hub flag (module-level so the pure helpers below can read it
// without an auth hook). Defaults false → legacy pages until the flag says
// otherwise for this user.
let _hubNav = false;

/** Set by AuthContext when feature flags load. `enabled` = this viewer's page:tech_job_hub. */
export function setHubNav(enabled) { _hubNav = !!enabled; }

/** Current per-user hub-nav state (mainly for tests / diagnostics). */
export function isHubNav() { return _hubNav; }

/**
 * URL for an appointment's detail surface.
 * @param {string} appointmentId
 * @param {string} [jobId] - required for the hub (it is job-rooted); without it
 *   the appointment still opens on the legacy page.
 * @returns {string}
 */
export function apptHref(appointmentId, jobId) {
  if (_hubNav && jobId) return `/tech/job/${jobId}?appt=${appointmentId}`;
  return `/tech/appointment/${appointmentId}`;
}

/**
 * URL for a job's detail surface.
 * @param {string} jobId
 * @returns {string}
 */
export function jobHref(jobId) {
  if (_hubNav) return `/tech/job/${jobId}`;
  return `/tech/jobs/${jobId}`;
}
