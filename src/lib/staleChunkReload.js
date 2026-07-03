/**
 * ════════════════════════════════════════════════
 * FILE: staleChunkReload.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether the app should reload the page after a JavaScript chunk
 *   fails to load. That failure almost always means a new version was deployed
 *   while this tab was open, so the file names it remembers no longer exist —
 *   one reload fetches the current file map. The important rule here: reload at
 *   most once per cooldown window, so a chunk that keeps failing can never
 *   reload the page forever (the bug that caused the /crm refresh loop).
 *
 * WHERE IT LIVES:
 *   Pure helper — no DOM, no storage. Called by App.jsx's lazyRetry() wrapper,
 *   which owns reading/writing the timestamp in sessionStorage. Kept pure so it
 *   is unit-testable (see staleChunkReload.test.js).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Exports:   shouldReloadForStaleChunk(nowMs, lastMs, windowMs?) → boolean
 *              buildResetUrl(pathname) → string
 *
 * NOTES / GOTCHAS:
 *   - Time-based on purpose. The previous guard used a boolean flag that was
 *     CLEARED on any successful chunk load, so a sibling chunk loading fine
 *     re-armed the reload and a persistently-missing chunk looped forever.
 *     A timestamp can't be cleared by unrelated successes.
 *   - buildResetUrl points at the static /reset page, which is served with a
 *     `Clear-Site-Data: "cache"` header (see public/_headers). Bouncing a failed
 *     chunk load through /reset evicts the browser's HTTP cache of a poisoned
 *     immutable /assets/*.js — which a plain reload can't do — then returns to
 *     the original path. "cache" only, so it never logs the user out.
 * ════════════════════════════════════════════════
 */

/**
 * @param {number} nowMs    - current time (Date.now()).
 * @param {number} lastMs   - timestamp of the last stale-chunk reload (0 if none).
 * @param {number} windowMs - cooldown window; default 20s.
 * @returns {boolean} true if enough time has passed to reload again.
 */
export function shouldReloadForStaleChunk(nowMs, lastMs, windowMs = 20000) {
  return nowMs - lastMs > windowMs;
}

/**
 * Build the URL to the /reset recovery page, carrying the path to return to
 * after the cache is cleared. Encoded so a path with its own query/hash survives.
 * @param {string} pathname - where to send the user back (defaults to '/').
 * @returns {string} e.g. '/reset?to=%2Fcrm%2Fcall-log'
 */
export function buildResetUrl(pathname) {
  return `/reset?to=${encodeURIComponent(pathname || '/')}`;
}
