// IndexedDB wrapper for the UPR offline-first foundation.
// Backs the sync queue + blob storage that photos, readings, equipment and room mutations
// all flow through. Uses `idb` (v8) for a small promise-based wrapper around the native API.

import { openDB } from 'idb';

const DB_NAME = 'upr-offline';
const DB_VERSION = 1;

// Object store names — kept as exports so callers avoid magic strings.
export const STORES = {
  QUEUE: 'queue',
  PHOTOS: 'photos',
  ROOMS: 'rooms',
  READINGS: 'readings',
  EQUIPMENT: 'equipment',
  CACHE_META: 'cacheMeta',
  ID_SWAPS: 'idSwaps',
};

let _dbPromise = null;

/**
 * Opens (or creates) the `upr-offline` IndexedDB database.
 * Returns a singleton promise — repeat calls reuse the same connection.
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export function openOfflineDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Incremental upgrades — each block applies only if the DB is below that version.
      // v1 establishes the baseline; Phase 2 bumps will add indexes for readings/equipment.
      if (oldVersion < 1) {
        const queue = db.createObjectStore(STORES.QUEUE, { keyPath: 'clientId' });
        queue.createIndex('status', 'status', { unique: false });
        queue.createIndex('createdAt', 'createdAt', { unique: false });

        db.createObjectStore(STORES.PHOTOS, { keyPath: 'clientId' });
        db.createObjectStore(STORES.ROOMS, { keyPath: 'clientId' });
        db.createObjectStore(STORES.READINGS, { keyPath: 'clientId' });
        db.createObjectStore(STORES.EQUIPMENT, { keyPath: 'clientId' });
        db.createObjectStore(STORES.CACHE_META, { keyPath: 'key' });
        db.createObjectStore(STORES.ID_SWAPS, { keyPath: 'tempId' });
      }
    },
    blocked() {
      // Another tab is holding an old version open — user will see stale data until refresh.
      // Eventually surface a toast but for now just warn.
      console.warn('[offlineDb] upgrade blocked by another tab');
    },
    terminated() {
      // Connection died unexpectedly (OS eviction, disk full). Reset so next call reopens.
      _dbPromise = null;
    },
  });
  return _dbPromise;
}

/**
 * Add a new item to the outbound sync queue.
 * Caller supplies `clientId` (UUID), `type`, `payload`. We stamp the rest.
 * @param {{clientId:string, type:string, payload:object, status?:string}} item
 */
export async function enqueueItem(item) {
  if (!item || !item.clientId || !item.type) {
    throw new Error('enqueueItem requires { clientId, type }');
  }
  const db = await openOfflineDb();
  const row = {
    clientId: item.clientId,
    type: item.type,
    payload: item.payload || {},
    status: item.status || 'pending',
    createdAt: item.createdAt || Date.now(),
    retryCount: 0,
    retryAt: 0,
    lastError: null,
  };
  await db.put(STORES.QUEUE, row);
  return row;
}

/**
 * List queue rows, optionally filtered by status.
 * @param {'pending'|'syncing'|'done'|'error'|undefined} status
 */
export async function listQueue(status) {
  const db = await openOfflineDb();
  if (!status) return db.getAll(STORES.QUEUE);
  return db.getAllFromIndex(STORES.QUEUE, 'status', status);
}

/**
 * Update the status of a queued item (and optional error/retry metadata).
 * @param {string} clientId
 * @param {'pending'|'syncing'|'done'|'error'} status
 * @param {{error?:string|null, retryCount?:number, retryAt?:number, serverId?:string}} [extra]
 */
export async function updateQueueStatus(clientId, status, extra = {}) {
  const db = await openOfflineDb();
  const row = await db.get(STORES.QUEUE, clientId);
  if (!row) return null;
  const next = {
    ...row,
    status,
    lastError: extra.error !== undefined ? extra.error : row.lastError,
    retryCount: extra.retryCount !== undefined ? extra.retryCount : row.retryCount,
    retryAt: extra.retryAt !== undefined ? extra.retryAt : row.retryAt,
    serverId: extra.serverId !== undefined ? extra.serverId : row.serverId,
    updatedAt: Date.now(),
  };
  await db.put(STORES.QUEUE, next);
  return next;
}

/**
 * Persist a photo blob + metadata keyed by the queue item's clientId.
 * @param {string} clientId
 * @param {{blob:Blob, mimeType:string, jobId:string, roomId?:string, appointmentId?:string, description?:string, name:string, uploadedBy:string}} data
 */
export async function savePhotoBlob(clientId, data) {
  if (!clientId || !data?.blob) throw new Error('savePhotoBlob requires clientId + blob');
  const db = await openOfflineDb();
  await db.put(STORES.PHOTOS, { clientId, ...data });
}

/**
 * Read a photo blob entry by clientId.
 * @param {string} clientId
 */
export async function getPhotoBlob(clientId) {
  const db = await openOfflineDb();
  return db.get(STORES.PHOTOS, clientId);
}

/** Delete a photo blob after successful upload. */
export async function deletePhoto(clientId) {
  const db = await openOfflineDb();
  await db.delete(STORES.PHOTOS, clientId);
}

/**
 * Save a pending room-create payload (used for optimistic UI before server confirms).
 * @param {string} clientId
 * @param {{jobId:string, name:string, areaSqft?:number, ceilingHeightFt?:number, sortOrder?:number, createdBy:string}} data
 */
export async function saveRoom(clientId, data) {
  if (!clientId) throw new Error('saveRoom requires clientId');
  const db = await openOfflineDb();
  await db.put(STORES.ROOMS, { clientId, ...data });
}

/** Read a pending room entry by clientId. */
export async function getRoom(clientId) {
  const db = await openOfflineDb();
  return db.get(STORES.ROOMS, clientId);
}

/**
 * Record a temp→server id swap. Photo uploads reference rooms by temp UUID when queued
 * offline; when the room create syncs we record the real UUID here and photo dispatch
 * resolves it before calling the server.
 * @param {string} tempId
 * @param {string} serverId
 */
export async function recordIdSwap(tempId, serverId) {
  if (!tempId || !serverId) return;
  const db = await openOfflineDb();
  await db.put(STORES.ID_SWAPS, { tempId, serverId, resolvedAt: Date.now() });
}

/**
 * Resolve an id that might be a temp UUID. Returns the server id if we've recorded
 * a swap, otherwise returns the input unchanged (most common path: id is already real).
 * @param {string|null|undefined} maybeTempId
 * @returns {Promise<string|null|undefined>}
 */
export async function resolveIdSwap(maybeTempId) {
  if (!maybeTempId) return maybeTempId;
  const db = await openOfflineDb();
  const hit = await db.get(STORES.ID_SWAPS, maybeTempId);
  return hit?.serverId || maybeTempId;
}

/** Remove all items that have already synced successfully. */
export async function clearDone() {
  const db = await openOfflineDb();
  const tx = db.transaction(STORES.QUEUE, 'readwrite');
  const done = await tx.store.index('status').getAllKeys('done');
  await Promise.all(done.map(k => tx.store.delete(k)));
  await tx.done;
  return done.length;
}

/**
 * Lightweight counts for the OfflineStatusPill.
 * @returns {Promise<{pending:number, syncing:number, error:number, done:number}>}
 */
export async function queueCounts() {
  const db = await openOfflineDb();
  const idx = db.transaction(STORES.QUEUE).store.index('status');
  const [pending, syncing, errorCount, done] = await Promise.all([
    idx.count('pending'),
    idx.count('syncing'),
    idx.count('error'),
    idx.count('done'),
  ]);
  return { pending, syncing, error: errorCount, done };
}
