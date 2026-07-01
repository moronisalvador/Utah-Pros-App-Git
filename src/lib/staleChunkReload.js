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
 *
 * NOTES / GOTCHAS:
 *   - Time-based on purpose. The previous guard used a boolean flag that was
 *     CLEARED on any successful chunk load, so a sibling chunk loading fine
 *     re-armed the reload and a persistently-missing chunk looped forever.
 *     A timestamp can't be cleared by unrelated successes.
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
