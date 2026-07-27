/**
 * ════════════════════════════════════════════════
 * FILE: techQueryPersister.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Remembers eligible tech-screen data for one verified account at a time.
 *   The saved key and payload both carry that opaque account lease, so another
 *   account—or an old tab finishing late—cannot restore or overwrite it.
 *
 * DEPENDS ON:
 *   Packages:  idb, @tanstack/query-async-storage-persister,
 *              @tanstack/react-query-persist-client
 *   Internal:  resumeRestore (opaque owner-lease checks)
 *   Data:      reads/writes → browser IndexedDB only
 *
 * NOTES / GOTCHAS:
 *   - The module-level persister is intentionally locked until authentication
 *     activates a verified owner. This is safe with PersistQueryClientProvider:
 *     pre-auth restore/persist are no-ops rather than cross-account hydration.
 *   - A caller that wants warm boot hydration must activate and restore the
 *     owner before publishing authenticated routes.
 * ════════════════════════════════════════════════
 */

import { openDB } from 'idb';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClientRestore } from '@tanstack/react-query-persist-client';
import {
  isPwaOwnerLeaseCurrent,
  normalizePwaOwnerLease,
} from './resumeRestore.js';

const DB_NAME = 'upr-query-cache';
const DB_VERSION = 1;
const STORE = 'keyval';
const ENVELOPE_VERSION = 1;
export const TECH_QUERY_PERSIST_KEY = 'upr-tech-query-cache';
export const TECH_QUERY_PERSIST_KEY_PREFIX = 'upr-tech-query-cache:v2:';

let dbPromise = null;
let activeLease = null;
let activePersister = null;
let restoreGeneration = 0;

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function openCacheDb() {
  if (dbPromise) return dbPromise;
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    },
    terminated() {
      dbPromise = null;
    },
  });
  return dbPromise;
}

const idbStorage = {
  async getItem(key) {
    return (await (await openCacheDb()).get(STORE, key)) ?? null;
  },
  async setItem(key, value) {
    await (await openCacheDb()).put(STORE, value, key);
  },
  async removeItem(key) {
    await (await openCacheDb()).delete(STORE, key);
  },
};

export function techQueryPersistKey(ownerLease) {
  const lease = normalizePwaOwnerLease(ownerLease);
  if (!lease) return null;
  return `${TECH_QUERY_PERSIST_KEY_PREFIX}${encodeURIComponent(lease.owner)}:${encodeURIComponent(lease.epoch)}`;
}

/**
 * Create a TanStack-compatible persister permanently bound to one owner lease.
 * Storage is injectable for deterministic cross-tab/late-write tests.
 */
export function createTechQueryPersister(
  ownerLease,
  {
    storage = idbStorage,
    ownerStorage = browserStorage(),
    throttleTime = 1_000,
  } = {},
) {
  const lease = normalizePwaOwnerLease(ownerLease);
  const key = techQueryPersistKey(lease);
  if (!lease || !key) {
    throw new Error('createTechQueryPersister requires a verified owner lease');
  }

  const guardedStorage = {
    async getItem(storageKey) {
      if (!isPwaOwnerLeaseCurrent(lease, ownerStorage)) return null;
      try {
        const value = await storage.getItem(storageKey);
        // IndexedDB can resolve after another tab has started an account
        // transition. Never hand that late prior-owner payload to TanStack.
        return isPwaOwnerLeaseCurrent(lease, ownerStorage) ? value : null;
      } catch {
        return null;
      }
    },
    async setItem(storageKey, value) {
      if (!isPwaOwnerLeaseCurrent(lease, ownerStorage)) return;
      await storage.setItem(storageKey, value);
      // A marker can change in another tab while IndexedDB is awaiting. Remove
      // only this epoch-specific key if that happened; a later session has a
      // different key and cannot be erased by this stale completion.
      if (!isPwaOwnerLeaseCurrent(lease, ownerStorage)) {
        await storage.removeItem(storageKey);
      }
    },
    async removeItem(storageKey) {
      await storage.removeItem(storageKey);
    },
  };

  const base = createAsyncStoragePersister({
    storage: guardedStorage,
    key,
    throttleTime,
    serialize: (client) => JSON.stringify({
      version: ENVELOPE_VERSION,
      owner: lease.owner,
      epoch: lease.epoch,
      client,
    }),
    deserialize: (raw) => {
      const envelope = JSON.parse(raw);
      if (
        envelope?.version !== ENVELOPE_VERSION
        || envelope.owner !== lease.owner
        || envelope.epoch !== lease.epoch
        || !envelope.client
      ) {
        throw new Error('Persisted query owner mismatch');
      }
      return envelope.client;
    },
  });

  return {
    persistClient(client) {
      if (!isPwaOwnerLeaseCurrent(lease, ownerStorage)) {
        return Promise.resolve();
      }
      return base.persistClient(client);
    },
    async restoreClient() {
      if (!isPwaOwnerLeaseCurrent(lease, ownerStorage)) return undefined;
      try {
        const restored = await base.restoreClient();
        return isPwaOwnerLeaseCurrent(lease, ownerStorage)
          ? restored
          : undefined;
      } catch {
        await guardedStorage.removeItem(key).catch(() => {});
        return undefined;
      }
    },
    removeClient() {
      return base.removeClient();
    },
    ownerLease: { ...lease },
    key,
  };
}

/** Enable future provider writes only for this already-published owner lease. */
export function activateTechQueryPersistence(ownerLease, options) {
  const lease = normalizePwaOwnerLease(ownerLease);
  if (!lease || !isPwaOwnerLeaseCurrent(lease, options?.ownerStorage)) {
    activeLease = null;
    activePersister = null;
    return false;
  }
  activeLease = { ...lease };
  activePersister = createTechQueryPersister(activeLease, options);
  return true;
}

/** Synchronously block pre-auth or prior-owner persistence. */
export function suspendTechQueryPersistence() {
  const previousOwner = activeLease?.owner || null;
  restoreGeneration += 1;
  activeLease = null;
  activePersister = null;
  return { suspended: true, previousOwner };
}

/**
 * Static adapter used by the existing provider. Before authentication its
 * methods are fail-closed no-ops; after activation they delegate to the exact
 * owner/epoch persister.
 */
export const techQueryPersister = {
  persistClient(client) {
    return activePersister?.persistClient(client) ?? Promise.resolve();
  },
  restoreClient() {
    return activePersister?.restoreClient() ?? Promise.resolve(undefined);
  },
  removeClient() {
    return activePersister?.removeClient() ?? Promise.resolve();
  },
};

/**
 * Hydrate one verified owner after auth and before protected routes publish.
 * This mirrors PersistQueryClientProvider's supported restore operation.
 */
export async function restorePersistedTechQueries(
  queryClient,
  ownerLease,
  {
    buster = '',
    maxAge = 24 * 60 * 60 * 1_000,
    ...persisterOptions
  } = {},
) {
  const lease = normalizePwaOwnerLease(ownerLease);
  const ownerStorage = persisterOptions.ownerStorage ?? browserStorage();
  if (!lease || !isPwaOwnerLeaseCurrent(lease, ownerStorage)) return false;

  const generation = ++restoreGeneration;
  const persister = createTechQueryPersister(ownerLease, persisterOptions);
  let hydrationAuthorized = false;
  const guardedPersister = {
    ...persister,
    async restoreClient() {
      const persistedClient = await persister.restoreClient();
      if (
        generation !== restoreGeneration
        || !isPwaOwnerLeaseCurrent(lease, ownerStorage)
      ) {
        return undefined;
      }
      if (persistedClient) hydrationAuthorized = true;
      return persistedClient;
    },
  };

  await persistQueryClientRestore({
    queryClient,
    persister: guardedPersister,
    buster,
    maxAge,
  });

  // Hydration itself is synchronous, but cache subscribers can run during it
  // and a different tab can change the device lease while the read is pending.
  // Recheck after the official restore call; clear only when this invocation
  // actually supplied a payload, so an older no-op restore cannot erase a
  // newer account's cache.
  if (
    generation !== restoreGeneration
    || !isPwaOwnerLeaseCurrent(lease, ownerStorage)
  ) {
    if (hydrationAuthorized) queryClient.clear();
    return false;
  }
  return true;
}

/**
 * Remove the exact prior owner/epoch payload plus the old device-global key.
 * Failures propagate so account cleanup cannot claim readiness incorrectly.
 */
export async function clearPersistedTechQueries(
  ownerLease = null,
  { storage = idbStorage } = {},
) {
  const key = techQueryPersistKey(ownerLease);
  const keys = new Set([TECH_QUERY_PERSIST_KEY]);
  if (key) keys.add(key);
  await Promise.all([...keys].map((storageKey) => storage.removeItem(storageKey)));
  return true;
}
