/**
 * ════════════════════════════════════════════════
 * FILE: techQueryPersister.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets the tech app remember what it last loaded even after the phone closes
 *   the web view, so a cold open in a no-signal basement still paints instantly
 *   from cache while fresh data loads in the background. It stores the TanStack
 *   Query cache in the browser's on-device database (IndexedDB) and hands
 *   TanStack a tiny adapter it knows how to read and write.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (library module)
 *   Rendered by:  mounted once by src/main.jsx via PersistQueryClientProvider
 *
 * DEPENDS ON:
 *   Packages:  idb, @tanstack/query-async-storage-persister
 *   Internal:  none
 *   Data:      none (IndexedDB only — no Supabase)
 *
 * NOTES / GOTCHAS:
 *   - Uses its OWN IndexedDB database ('upr-query-cache'), deliberately NOT a new
 *     store inside the existing 'upr-offline' DB — adding a store there would force
 *     a version bump and risk cross-tab blocked() upgrades on a DB the offline
 *     photo/sync queue depends on. Keep them separate.
 *   - The persister is created lazily and the whole thing degrades to a no-op if
 *     IndexedDB is unavailable (private mode, old WebView), so it can never block
 *     app boot.
 * ════════════════════════════════════════════════
 */
import { openDB } from 'idb';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

const DB_NAME = 'upr-query-cache';
const DB_VERSION = 1;
const STORE = 'keyval';

let _dbPromise = null;

// Dedicated single-store IndexedDB DB, opened once (singleton promise).
function openCacheDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
  });
  return _dbPromise;
}

// AsyncStorage-shaped adapter (getItem/setItem/removeItem → Promises) over idb.
// All methods swallow errors so a broken/unavailable IndexedDB never surfaces as
// an app crash — persistence is a nicety, not a requirement.
const idbStorage = {
  async getItem(key) {
    try {
      return (await (await openCacheDb()).get(STORE, key)) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      await (await openCacheDb()).put(STORE, value, key);
    } catch {
      /* best-effort */
    }
  },
  async removeItem(key) {
    try {
      await (await openCacheDb()).delete(STORE, key);
    } catch {
      /* best-effort */
    }
  },
};

/**
 * The persister passed to PersistQueryClientProvider. Serialization is the
 * TanStack default (JSON); the tech query payloads are plain JSON already.
 */
export const techQueryPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: 'upr-tech-query-cache',
  // Throttle disk writes so a burst of query updates doesn't thrash IndexedDB.
  throttleTime: 1000,
});
