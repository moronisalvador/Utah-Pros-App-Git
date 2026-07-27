/**
 * ════════════════════════════════════════════════
 * FILE: lazyRetry.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Loads a screen only when the app needs it. If an open app asks for an old
 *   screen file after a deployment, it sends the browser through the existing
 *   one-time cache reset instead of leaving a broken screen or reloading forever.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  src/lib/staleChunkReload.js
 *   Data:      reads  → sessionStorage stale-chunk timestamp
 *              writes → sessionStorage stale-chunk timestamp
 *
 * NOTES / GOTCHAS:
 *   - A successful sibling chunk never clears the timestamp.
 *   - Recovery remains limited by shouldReloadForStaleChunk's cooldown.
 * ════════════════════════════════════════════════
 */
import { lazy } from 'react';

import {
  buildResetUrl,
  shouldReloadForStaleChunk,
} from '@/lib/staleChunkReload';

export const CHUNK_RELOAD_KEY = 'chunkReloadAt';

export async function loadLazyModule(factory, runtime = {}) {
  try {
    return await factory();
  } catch (error) {
    const storage = runtime.storage ?? globalThis.sessionStorage;
    const location = runtime.location ?? globalThis.window.location;
    const now = runtime.now ?? Date.now;
    const shouldReload = runtime.shouldReload ?? shouldReloadForStaleChunk;
    const resetUrl = runtime.resetUrl ?? buildResetUrl;
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY) || 0);

    if (shouldReload(now(), last)) {
      storage.setItem(CHUNK_RELOAD_KEY, String(now()));
      location.replace(resetUrl(location.pathname + location.search));
      return new Promise(() => {});
    }
    throw error;
  }
}

export function lazyRetry(factory) {
  return lazy(() => loadLazyModule(factory));
}
