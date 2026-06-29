/**
 * ════════════════════════════════════════════════
 * FILE: staleChunkReload.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The app is split into many small JavaScript files ("chunks") that load on
 *   demand as you move between pages. When a new version is deployed, those
 *   files get new names. An app that was already open can try to load an old
 *   file name that no longer exists, which makes the page crash with a generic
 *   error. This helper notices that specific failure and quietly reloads the
 *   app ONE time so it grabs the new files — instead of showing an error.
 *
 * WHERE IT LIVES:
 *   Exports: isChunkLoadError(error), reloadOnceForStaleChunk(reason)
 *   Used by: src/main.jsx (Vite preload-error hook) and
 *            src/components/ErrorBoundary.jsx (render-error backstop)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none (uses sessionStorage only, as a reload loop-guard)
 *
 * NOTES / GOTCHAS:
 *   - Loop-guarded: it will not reload more than once per ~12s, so a chunk that
 *     is genuinely gone (not just a stale deploy) can't spin the page forever —
 *     after one attempt the normal error UI shows.
 *   - sessionStorage (not localStorage) so the guard resets when the tab/app is
 *     fully closed, letting a future deploy reload again.
 * ════════════════════════════════════════════════
 */

const RELOAD_KEY = 'upr-chunk-reload-at';
const COOLDOWN_MS = 12000;

// Matches the various browser/Vite phrasings for "a lazy-loaded module failed".
const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|module script failed|dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed|Unable to preload CSS/i;

export function isChunkLoadError(error) {
  if (!error) return false;
  const msg = String(error.message || error.toString?.() || error || '');
  const name = String(error.name || '');
  return name === 'ChunkLoadError' || CHUNK_ERROR_RE.test(msg);
}

// Reload once to fetch the fresh bundle. Returns true if a reload was triggered.
export function reloadOnceForStaleChunk(reason) {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < COOLDOWN_MS) return false; // already reloaded — don't loop
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    console.warn('[stale-chunk] reloading for fresh bundle:', reason);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}
