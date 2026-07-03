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
 *     hardcode '/tech/appointment/' or '/tech/jobs/'. M2 flips HUB_ENABLED (and
 *     the two builders) to point at /tech/job/:jobId?appt=<id>.
 * ════════════════════════════════════════════════
 */

// M2 flips this to true (and the hub route lands). Until then, v2 navigation
// points at the existing legacy detail pages so nothing 404s mid-wave.
export const HUB_ENABLED = false;

/**
 * URL for an appointment's detail surface.
 * @param {string} appointmentId
 * @param {string} [jobId] - required once HUB_ENABLED (hub is job-rooted)
 * @returns {string}
 */
export function apptHref(appointmentId, jobId) {
  if (HUB_ENABLED && jobId) return `/tech/job/${jobId}?appt=${appointmentId}`;
  return `/tech/appointment/${appointmentId}`;
}

/**
 * URL for a job's detail surface.
 * @param {string} jobId
 * @returns {string}
 */
export function jobHref(jobId) {
  if (HUB_ENABLED) return `/tech/job/${jobId}`;
  return `/tech/jobs/${jobId}`;
}
