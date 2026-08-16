/**
 * ════════════════════════════════════════════════
 * FILE: legacyApptResolve.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Two tiny decisions the appointment redirect needs, pulled out of the
 *   component so they can be tested on their own: given what the database said
 *   about an appointment, should we send the technician to the Job Hub — and if
 *   so, what exactly is the address we send them to?
 *
 *   Sending them to the Hub is only possible when the appointment actually
 *   belongs to a job. Some appointments do not (a private personal block, an
 *   office event), and one that has been hidden from this viewer comes back
 *   empty. In both of those cases the answer is "leave them where they are" —
 *   the old screen already knows how to handle both.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (helper module)
 *   Rendered by:  n/a — imported by LegacyAppointmentRedirect.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (pure functions — the caller supplies the RPC result)
 *
 * NOTES / GOTCHAS:
 *   - `get_appointment_detail` returns NULL for a private appointment the caller
 *     may not see, so a null detail and a job-less appointment deliberately give
 *     the same answer: don't redirect. A failed lookup must degrade to the
 *     legacy page, never to a dead end.
 *   - buildHubApptUrl PINS ?appt=. That is what satisfies resolveHero's rule 2
 *     (an appointment sent us here → show that appointment), so a deep link from
 *     a months-old push opens the visit it was about, not whatever the hub would
 *     have picked by default.
 *   - Any other query params on the incoming URL are preserved; a notification
 *     that deep-links with extra state must not lose it on the way through.
 * ════════════════════════════════════════════════
 */

/**
 * Should a /tech/appointment/:id visit be replaced by the Job Hub, and for which job?
 * @param {object|null} detail - the get_appointment_detail payload (may be null)
 * @returns {{ redirect: boolean, jobId: string|null }}
 */
export function resolveApptRedirect(detail) {
  const jobId = detail && typeof detail === 'object' ? detail.job_id : null;
  if (!jobId || typeof jobId !== 'string') return { redirect: false, jobId: null };
  return { redirect: true, jobId };
}

/**
 * The Hub address for an appointment, with ?appt= pinned.
 * @param {string} jobId
 * @param {string} appointmentId
 * @param {string} [search] - the incoming location.search ('' or '?a=b')
 * @returns {string}
 */
export function buildHubApptUrl(jobId, appointmentId, search = '') {
  const params = new URLSearchParams(search || '');
  params.set('appt', appointmentId);
  return `/tech/job/${jobId}?${params.toString()}`;
}
