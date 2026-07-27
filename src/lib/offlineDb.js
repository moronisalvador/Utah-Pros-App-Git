/**
 * ════════════════════════════════════════════════
 * FILE: offlineDb.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Preserves and inspects historical local field-work records under an opaque
 *   account owner. Automatic command admission/replay is disabled for the
 *   initial online-first release.
 *
 * DEPENDS ON:
 *   Packages:  idb
 *   Internal:  resumeRestore
 *   Data:      reads/writes → browser IndexedDB only
 *
 * NOTES / GOTCHAS:
 *   - Queue ownership is an opaque browser token, never a raw Auth or employee ID.
 *   - Legacy and foreign-owner rows are preserved but quarantined: no payload API
 *     returns or mutates them.
 *   - Automatic command admission/replay is disabled for the initial production
 *     release. Field mutations are online-only until a durable same-transaction
 *     account-transition fence is proven.
 *   - Legacy/unowned records are never adopted. A staged rollout gate and an
 *     explicit all-store discard action are the only supported v1 boundary.
 * ════════════════════════════════════════════════
 */

import { openDB } from 'idb';
import {
  isPwaOwnerLeaseCurrent,
  normalizePwaOwnerLease,
  readPwaOwnerLease,
} from './resumeRestore.js';

const DB_NAME = 'upr-offline';
export const OFFLINE_DB_VERSION = 3;

export const QUEUE_CLAIM_TTL_MS = 2 * 60 * 1000;
export const DONE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DONE_PRUNE_LIMIT = 50;
export const OFFLINE_DB_OPEN_TIMEOUT_MS = 5_000;
export const OFFLINE_DB_RECOVERY_GUIDANCE =
  'Close other UPR tabs, then reload this page and retry offline storage.';
export const OFFLINE_DATA_DISCARD_CONFIRMATION =
  'discard-all-unsynced-offline-data';
export const PHOTO_CLEANUP_LIMIT = 10;
export const PHOTO_CLEANUP_MAX_RETRIES = 5;
const PHOTO_CLEANUP_SCAN_WINDOW = 50;
const PHOTO_CLEANUP_CURSOR_MS = 30_000;
export const PHOTO_CLEANUP_BACKOFF_MS = [
  1_000,
  4_000,
  15_000,
  60_000,
  300_000,
];

// Object store names — kept as exports so tests and future owner-safe adapters
// avoid duplicating the durable schema.
export const STORES = {
  QUEUE: 'queue',
  PHOTOS: 'photos',
  ROOMS: 'rooms',
  READINGS: 'readings',
  EQUIPMENT: 'equipment',
  CACHE_META: 'cacheMeta',
  ID_SWAPS: 'idSwaps',
};

export const QUEUE_REPLAY_POLICY = {
  SAFE: 'stable-operation-id',
  MANUAL: 'manual-reconcile',
};

export const PRODUCTION_QUEUE_TYPES = Object.freeze([]);

export const OFFLINE_INDEXES = {
  OWNER: 'owner',
  QUEUE_OWNER_STATUS: 'ownerStatus',
  QUEUE_OWNER_STATUS_TYPE: 'ownerStatusType',
};

const PRODUCTION_QUEUE_TYPE_SET = new Set(PRODUCTION_QUEUE_TYPES);
const SAFE_REPLAY_TYPES = new Set(PRODUCTION_QUEUE_TYPES);

const OWNER_TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{12,}$/;
const CLAIM_TOKEN_PATTERN = /^c1\.[A-Za-z0-9_-]{8,}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUXILIARY_STORES = [
  STORES.PHOTOS,
  STORES.ROOMS,
  STORES.READINGS,
  STORES.EQUIPMENT,
  STORES.CACHE_META,
  STORES.ID_SWAPS,
];

const QUEUE_STATUSES = [
  'pending',
  'syncing',
  'error',
  'done',
];

let _dbPromise = null;
let _dbConnection = null;
let _openGeneration = 0;
let _openReject = null;
let _openState = Object.freeze({
  status: 'idle',
  code: null,
  message: null,
  guidance: null,
});
const _openStateListeners = new Set();

export class OfflineDbOpenError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OfflineDbOpenError';
    this.code = code;
    this.guidance = OFFLINE_DB_RECOVERY_GUIDANCE;
  }
}

export class OfflineLeaseStaleError extends Error {
  constructor() {
    super('The latest verified offline owner lease is required');
    this.name = 'OfflineLeaseStaleError';
    this.code = 'OFFLINE_LEASE_STALE';
  }
}

function publishOpenState(next) {
  _openState = Object.freeze({
    status: next.status,
    code: next.code || null,
    message: next.message || null,
    guidance: next.guidance || null,
  });
  for (const listener of _openStateListeners) {
    try {
      listener(_openState);
    } catch {
      // One broken observer must not prevent storage recovery for the others.
    }
  }
}

export function getOfflineDbOpenState() {
  return _openState;
}

export function subscribeOfflineDbOpenState(listener) {
  if (typeof listener !== 'function') return () => {};
  _openStateListeners.add(listener);
  return () => _openStateListeners.delete(listener);
}

export function isOpaqueQueueOwner(owner) {
  return typeof owner === 'string' && OWNER_TOKEN_PATTERN.test(owner);
}

export function queueReplayPolicy(type) {
  return SAFE_REPLAY_TYPES.has(type)
    ? QUEUE_REPLAY_POLICY.SAFE
    : QUEUE_REPLAY_POLICY.MANUAL;
}

export function isStableQueueOperationId(value) {
  return typeof value === 'string' && OPERATION_UUID_PATTERN.test(value);
}

export function isQueueItemReplaySafe(item) {
  return queueReplayPolicy(item?.type) === QUEUE_REPLAY_POLICY.SAFE
    && item?.operationId === item?.clientId
    && isStableQueueOperationId(item?.operationId);
}

function requireQueueOwner(owner) {
  if (!isOpaqueQueueOwner(owner)) {
    throw new Error('A verified opaque queue owner is required');
  }
  return owner;
}

function requireCurrentLease(
  lease = readPwaOwnerLease(),
  isLeaseCurrent = isPwaOwnerLeaseCurrent,
) {
  const verified = normalizePwaOwnerLease(lease);
  if (!verified || isLeaseCurrent(verified) !== true) {
    throw new OfflineLeaseStaleError();
  }
  return verified;
}

function assertLeaseCurrentAtBoundary(
  lease,
  isLeaseCurrent = isPwaOwnerLeaseCurrent,
  transaction = null,
) {
  let current = false;
  try {
    current = isLeaseCurrent(lease) === true;
  } catch {
    current = false;
  }
  if (current) return lease;
  try {
    transaction?.abort?.();
  } catch {
    // The typed stale-lease error remains the useful result.
  }
  throw new OfflineLeaseStaleError();
}

function requireClaimToken(claimToken) {
  if (
    typeof claimToken !== 'string'
    || !CLAIM_TOKEN_PATTERN.test(claimToken)
  ) {
    throw new Error('A stable queue claim token is required');
  }
  return claimToken;
}

function clearClaim(row) {
  return {
    ...row,
    claimToken: null,
    claimEpoch: null,
    claimExpiresAt: 0,
  };
}

async function settleTransaction(tx, operation) {
  try {
    const result = await operation();
    await tx.done;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // A request failure or completed transaction may already have aborted.
    }
    // Observe the transaction rejection too; otherwise a failed request can
    // leave a second unhandled rejection after its original error is returned.
    try {
      await tx.done;
    } catch {
      // Preserve the original request/operation error.
    }
    throw error;
  }
}

async function runQueueWriteTransaction(db, operation) {
  const tx = db.transaction(STORES.QUEUE, 'readwrite');
  return settleTransaction(tx, () => operation(tx.store, tx));
}

function storeFromTransaction(tx, storeName) {
  return typeof tx.objectStore === 'function'
    ? tx.objectStore(storeName)
    : tx.store;
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

export function upgradeOfflineDbSchema(db, oldVersion, transaction) {
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
  if (oldVersion < 2) {
    const queue = transaction.objectStore(STORES.QUEUE);
    ensureIndex(queue, OFFLINE_INDEXES.OWNER, 'owner');
    ensureIndex(
      queue,
      OFFLINE_INDEXES.QUEUE_OWNER_STATUS,
      ['owner', 'status'],
    );
    for (const storeName of AUXILIARY_STORES) {
      ensureIndex(
        transaction.objectStore(storeName),
        OFFLINE_INDEXES.OWNER,
        'owner',
      );
    }
  }
  if (oldVersion < 3) {
    ensureIndex(
      transaction.objectStore(STORES.QUEUE),
      OFFLINE_INDEXES.QUEUE_OWNER_STATUS_TYPE,
      ['owner', 'status', 'type'],
    );
  }
}

async function putOwnedRow(
  db,
  storeName,
  key,
  row,
  lease,
  isLeaseCurrent,
) {
  const tx = db.transaction(storeName, 'readwrite');
  return settleTransaction(tx, async () => {
    const existing = await tx.store.get(key);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (
      existing
      && (
        existing.owner !== lease.owner
        || existing.createdEpoch !== lease.epoch
      )
    ) {
      throw new Error('A foreign or legacy durable row is quarantined');
    }
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await tx.store.put(row);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return row;
  });
}

function closeConnection(db = _dbConnection) {
  try {
    db?.close?.();
  } catch {
    // Closing is best effort; the generation fence still rejects late use.
  }
  if (db === _dbConnection) _dbConnection = null;
}

function handleVersionChange(db, generation) {
  if (generation !== _openGeneration) return;
  closeConnection(db);
  _openReject?.(new OfflineDbOpenError(
    'OFFLINE_DB_VERSION_CHANGED',
    'Offline storage was upgraded in another UPR tab.',
  ));
  _openReject = null;
  _dbPromise = null;
  _openGeneration += 1;
  publishOpenState({
    status: 'version-changed',
    code: 'OFFLINE_DB_VERSION_CHANGED',
    message: 'Offline storage was upgraded in another UPR tab.',
    guidance: OFFLINE_DB_RECOVERY_GUIDANCE,
  });
}

/**
 * Opens (or creates) `upr-offline` with a bounded wait. An older open UPR tab
 * can block an IndexedDB upgrade; callers receive a typed recovery state
 * instead of waiting forever.
 */
export function openOfflineDb({
  timeoutMs = OFFLINE_DB_OPEN_TIMEOUT_MS,
} = {}) {
  if (_dbConnection) return Promise.resolve(_dbConnection);
  if (_dbPromise) return _dbPromise;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new OfflineDbOpenError(
      'OFFLINE_DB_OPEN_TIMEOUT',
      'Offline storage requires a positive open timeout.',
    ));
  }

  const generation = ++_openGeneration;
  let blocked = false;
  let timeoutId = null;
  let openedConnection = null;
  publishOpenState({
    status: 'opening',
    code: null,
    message: 'Opening offline storage…',
  });

  let rawOpen;
  try {
    rawOpen = openDB(DB_NAME, OFFLINE_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        upgradeOfflineDbSchema(db, oldVersion, transaction);
      },
      blocked() {
        if (generation !== _openGeneration) return;
        blocked = true;
        publishOpenState({
          status: 'blocked',
          code: 'OFFLINE_DB_OPEN_BLOCKED',
          message: 'Another UPR tab is preventing the offline storage upgrade.',
          guidance: OFFLINE_DB_RECOVERY_GUIDANCE,
        });
      },
      blocking() {
        if (generation !== _openGeneration || !openedConnection) return;
        handleVersionChange(openedConnection, generation);
      },
      terminated() {
        if (generation !== _openGeneration) return;
        _dbConnection = null;
        _dbPromise = null;
        _openGeneration += 1;
        publishOpenState({
          status: 'error',
          code: 'OFFLINE_DB_TERMINATED',
          message: 'Offline storage closed unexpectedly.',
          guidance: OFFLINE_DB_RECOVERY_GUIDANCE,
        });
      },
    });
  } catch (cause) {
    _openGeneration += 1;
    const error = new OfflineDbOpenError(
      'OFFLINE_DB_OPEN_FAILED',
      'Offline storage could not be opened.',
      { cause },
    );
    publishOpenState({
      status: 'error',
      code: error.code,
      message: error.message,
      guidance: error.guidance,
    });
    return Promise.reject(error);
  }

  _dbPromise = new Promise((resolve, reject) => {
    _openReject = reject;
    timeoutId = globalThis.setTimeout(() => {
      if (generation !== _openGeneration) return;
      _dbPromise = null;
      _openReject = null;
      _openGeneration += 1;
      const code = blocked
        ? 'OFFLINE_DB_OPEN_BLOCKED'
        : 'OFFLINE_DB_OPEN_TIMEOUT';
      const error = new OfflineDbOpenError(
        code,
        blocked
          ? 'Another UPR tab is preventing the offline storage upgrade.'
          : 'Offline storage did not open in time.',
      );
      publishOpenState({
        status: 'error',
        code,
        message: error.message,
        guidance: error.guidance,
      });
      reject(error);
    }, timeoutMs);

    Promise.resolve(rawOpen).then((db) => {
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      if (generation !== _openGeneration) {
        closeConnection(db);
        return;
      }
      openedConnection = db;
      _dbConnection = db;
      _openReject = null;
      const onVersionChange = () => handleVersionChange(db, generation);
      db?.addEventListener?.('versionchange', onVersionChange, { once: true });
      publishOpenState({
        status: 'ready',
        code: null,
        message: null,
      });
      resolve(db);
    }, (cause) => {
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      if (generation !== _openGeneration) return;
      _dbPromise = null;
      _openReject = null;
      const error = cause instanceof OfflineDbOpenError
        ? cause
        : new OfflineDbOpenError(
          'OFFLINE_DB_OPEN_FAILED',
          'Offline storage could not be opened.',
          { cause },
        );
      publishOpenState({
        status: 'error',
        code: error.code,
        message: error.message,
        guidance: error.guidance,
      });
      reject(error);
    });
  });
  return _dbPromise;
}

export function retryOfflineDbOpen(options = {}) {
  const priorConnection = _dbConnection;
  _openReject?.(new OfflineDbOpenError(
    'OFFLINE_DB_OPEN_REPLACED',
    'Offline storage open was replaced by a retry.',
  ));
  _openReject = null;
  _openGeneration += 1;
  _dbPromise = null;
  closeConnection(priorConnection);
  publishOpenState({
    status: 'idle',
    code: null,
    message: null,
  });
  return openOfflineDb(options);
}

/**
 * Fail-closed admission boundary. The initial release enables no queue type;
 * retained validation/row construction cannot be reached until a future
 * reviewed allowlist change.
 */
export async function enqueueItem(
  item,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  if (!isStableQueueOperationId(item?.clientId) || !item?.type) {
    throw new Error(
      'enqueueItem requires a UUID client operation ID, type, and ownerLease',
    );
  }
  if (!PRODUCTION_QUEUE_TYPE_SET.has(item.type)) {
    throw new Error(`Offline queue type is not enabled in production: ${item.type}`);
  }
  const lease = requireCurrentLease(item.ownerLease, isLeaseCurrent);
  const owner = requireQueueOwner(lease.owner);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const replayPolicy = queueReplayPolicy(item.type);
  const row = {
    clientId: item.clientId,
    operationId: item.clientId,
    type: item.type,
    payload: {
      ...(item.payload || {}),
      clientId: item.clientId,
    },
    owner,
    createdEpoch: lease.epoch,
    status: 'pending',
    replayPolicy,
    retryBlocked: false,
    ambiguous: false,
    createdAt: item.createdAt || Date.now(),
    updatedAt: item.createdAt || Date.now(),
    retryCount: 0,
    retryAt: 0,
    lastError: null,
    claimToken: null,
    claimEpoch: null,
    claimExpiresAt: 0,
  };

  await runQueueWriteTransaction(db, async (store, tx) => {
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await store.add(row);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
  });
  return row;
}

/** List only the latest lease's queue payloads. */
export async function listQueue(
  status,
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  if (status && !QUEUE_STATUSES.includes(status)) {
    throw new Error(`Unknown offline queue status: ${status}`);
  }
  const rows = status
    ? await db.getAllFromIndex(
      STORES.QUEUE,
      OFFLINE_INDEXES.QUEUE_OWNER_STATUS,
      [lease.owner, status],
    )
    : await db.getAllFromIndex(
      STORES.QUEUE,
      OFFLINE_INDEXES.OWNER,
      lease.owner,
    );
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  // Keep a defense after the index so a malformed implementation cannot leak
  // a foreign payload through this API.
  return rows.filter((row) => (
    row?.owner === lease.owner
    && (!status || row.status === status)
    && PRODUCTION_QUEUE_TYPE_SET.has(row.type)
    && row.operationId === row.clientId
    && isStableQueueOperationId(row.operationId)
  ));
}

/**
 * Atomically claim one pending row. The claim token and exact login epoch are
 * later required for every completion/failure transition.
 */
export async function claimQueueItem(
  clientId,
  ownerLease,
  claimToken,
  {
    now = Date.now(),
    ttlMs = QUEUE_CLAIM_TTL_MS,
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const verifiedClaim = requireClaimToken(claimToken);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('A positive queue claim TTL is required');
  }
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return runQueueWriteTransaction(db, async (store, tx) => {
    const row = await store.get(clientId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (
      !row
      || row.owner !== lease.owner
      || row.status !== 'pending'
      || row.retryBlocked === true
      || !PRODUCTION_QUEUE_TYPE_SET.has(row.type)
      || !isQueueItemReplaySafe(row)
    ) {
      return null;
    }
    const next = {
      ...row,
      status: 'syncing',
      claimToken: verifiedClaim,
      claimEpoch: lease.epoch,
      claimExpiresAt: now + ttlMs,
      claimedAt: now,
      updatedAt: now,
    };
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await store.put(next);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return next;
  });
}

/**
 * Compare-and-set a claimed row to done, pending, or error. If another tab has
 * recovered/reclaimed it, or the owner epoch is no longer latest, this returns
 * null and never overwrites the newer state.
 */
export async function settleQueueClaim(
  clientId,
  ownerLease,
  claimToken,
  status,
  extra = {},
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  if (!['done', 'pending', 'error'].includes(status)) {
    throw new Error('settleQueueClaim requires done, pending, or error');
  }
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const verifiedClaim = requireClaimToken(claimToken);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return runQueueWriteTransaction(db, async (store, tx) => {
    const row = await store.get(clientId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (
      !row
      || row.owner !== lease.owner
      || row.status !== 'syncing'
      || row.claimEpoch !== lease.epoch
      || row.claimToken !== verifiedClaim
      || !PRODUCTION_QUEUE_TYPE_SET.has(row.type)
      || !isQueueItemReplaySafe(row)
    ) {
      return null;
    }
    const settledAt = Date.now();
    const next = clearClaim({
      ...row,
      status,
      lastError: extra.error !== undefined ? extra.error : row.lastError,
      retryCount: extra.retryCount !== undefined
        ? extra.retryCount
        : row.retryCount,
      retryAt: extra.retryAt !== undefined ? extra.retryAt : row.retryAt,
      serverId: extra.serverId !== undefined ? extra.serverId : row.serverId,
      retryBlocked: extra.retryBlocked !== undefined
        ? extra.retryBlocked
        : row.retryBlocked,
      ambiguous: extra.ambiguous !== undefined
        ? extra.ambiguous
        : row.ambiguous,
      completedAt: status === 'done'
        ? settledAt
        : null,
      cleanupCompletedAt: status === 'done' && extra.cleanupCompleted === true
        ? settledAt
        : null,
      updatedAt: settledAt,
    });
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await store.put(next);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return next;
  });
}

/**
 * Recover expired/legacy `syncing` rows without assuming exactly-once delivery.
 * Proven idempotent rows return to pending with the same operation ID. Every
 * other row becomes a blocked manual-reconciliation error and is not replayed.
 */
export async function recoverStaleQueueClaims(
  ownerLease,
  {
    now = Date.now(),
    maxRecoveries = 5,
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return runQueueWriteTransaction(db, async (store, tx) => {
    const rows = await store
      .index(OFFLINE_INDEXES.QUEUE_OWNER_STATUS)
      .getAll([lease.owner, 'syncing']);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    const recovered = [];
    for (const row of rows) {
      if (
        row?.owner !== lease.owner
        || row.status !== 'syncing'
        || !PRODUCTION_QUEUE_TYPE_SET.has(row.type)
        || !isQueueItemReplaySafe(row)
        || (
          Number.isFinite(row.claimExpiresAt)
          && row.claimExpiresAt > now
        )
      ) {
        continue;
      }

      const recoveryCount = (row.recoveryCount || 0) + 1;
      const replaySafe = isQueueItemReplaySafe(row)
        && recoveryCount <= maxRecoveries;
      const next = clearClaim({
        ...row,
        status: replaySafe ? 'pending' : 'error',
        retryAt: 0,
        retryBlocked: !replaySafe,
        ambiguous: true,
        recoveryCount,
        lastError: replaySafe
          ? 'Interrupted sync will retry with the same operation ID'
          : 'Sync outcome is unknown; reconcile manually before another attempt',
        updatedAt: now,
      });
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
      await store.put(next);
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
      recovered.push({
        clientId: row.clientId,
        status: next.status,
        replaySafe,
      });
    }
    return recovered;
  });
}

/** Dormant retry boundary; returns null while the production allowlist is empty. */
export async function retryQueueItem(
  clientId,
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return runQueueWriteTransaction(db, async (store, tx) => {
    const row = await store.get(clientId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (
      !row
      || row.owner !== lease.owner
      || row.status !== 'error'
      || row.retryBlocked === true
      || !isQueueItemReplaySafe(row)
    ) {
      return null;
    }
    const next = clearClaim({
      ...row,
      status: 'pending',
      retryCount: 0,
      retryAt: 0,
      retryBlocked: false,
      ambiguous: false,
      lastError: null,
      updatedAt: Date.now(),
    });
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await store.put(next);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return next;
  });
}

function safeContextValue(value, maxLength = 120) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const printable = [...value].filter((character) => {
    const code = character.codePointAt(0);
    return code > 31 && code !== 127;
  }).join('');
  return printable.trim().slice(0, maxLength) || null;
}

function queueItemContext(row) {
  const payload = row?.payload || {};
  switch (row?.type) {
    case 'reading.insert':
      return {
        jobId: safeContextValue(payload.jobId, 64),
        roomId: safeContextValue(payload.roomId, 64),
        material: safeContextValue(payload.material, 80),
        location: safeContextValue(payload.location, 120),
        takenAt: safeContextValue(payload.takenAt, 40),
      };
    case 'equipment.place':
      return {
        jobId: safeContextValue(payload.jobId, 64),
        roomId: safeContextValue(payload.roomId, 64),
        equipmentType: safeContextValue(payload.equipmentType, 80),
        nickname: safeContextValue(payload.nickname, 80),
        serialNumber: safeContextValue(payload.serialNumber, 80),
      };
    default:
      return {};
  }
}

function sanitizeBlockedQueueItem(row) {
  return {
    operationId: row.operationId,
    type: row.type,
    createdAt: Number.isFinite(row.createdAt) ? row.createdAt : null,
    updatedAt: Number.isFinite(row.updatedAt) ? row.updatedAt : null,
    state: row.ambiguous
      ? 'server-outcome-unknown'
      : 'server-rejected',
    canConfirmAccepted: row.ambiguous === true,
    context: queueItemContext(row),
  };
}

/**
 * Return only owner-scoped, sanitized reminders that cannot be retried safely.
 * Raw payloads and upstream error bodies never cross this inspection boundary.
 */
export async function listBlockedQueueItems(
  ownerLease,
  {
    limit = 25,
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const rows = await db.getAllFromIndex(
    STORES.QUEUE,
    OFFLINE_INDEXES.QUEUE_OWNER_STATUS,
    [lease.owner, 'error'],
  );
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return rows
    .filter((row) => (
      row?.owner === lease.owner
      && row.status === 'error'
      && row.retryBlocked === true
      && PRODUCTION_QUEUE_TYPE_SET.has(row.type)
      && row.operationId === row.clientId
      && isStableQueueOperationId(row.operationId)
    ))
    .sort((left, right) => (
      (right.updatedAt || right.createdAt || 0)
      - (left.updatedAt || left.createdAt || 0)
    ))
    .slice(0, safeLimit)
    .map(sanitizeBlockedQueueItem);
}

/**
 * Resolve a blocked local reminder without sending it again.
 *
 * `accepted` is allowed only for an ambiguous response after the user has
 * independently confirmed the server record. `cancelled` removes the local
 * reminder. Neither path sends, retries, or reads an auxiliary blob.
 */
export async function resolveBlockedQueueItem(
  operationId,
  ownerLease,
  {
    resolution,
    evidence = null,
    now = Date.now(),
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  if (!['accepted', 'cancelled'].includes(resolution)) {
    throw new Error('Blocked queue resolution must be accepted or cancelled');
  }
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const tx = db.transaction(STORES.QUEUE, 'readwrite');
  return settleTransaction(tx, async () => {
    const queueStore = tx.store;
    const row = await queueStore.get(operationId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (
      !row
      || row.owner !== lease.owner
      || row.status !== 'error'
      || row.retryBlocked !== true
      || !PRODUCTION_QUEUE_TYPE_SET.has(row.type)
      || row.operationId !== row.clientId
      || !isStableQueueOperationId(row.operationId)
    ) {
      return null;
    }
    if (
      resolution === 'accepted'
      && (
        row.ambiguous !== true
        || evidence !== 'confirmed-visible-on-server'
      )
    ) {
      throw new Error(
        'Confirm the matching server record before accepting this reminder',
      );
    }

    if (resolution === 'cancelled') {
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
      await queueStore.delete(row.clientId);
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
      return {
        operationId: row.operationId,
        resolution,
        resolvedAt: now,
      };
    }

    const next = clearClaim({
      ...row,
      status: 'done',
      retryBlocked: false,
      ambiguous: false,
      lastError: null,
      resolution: 'user-confirmed-server-record',
      resolvedAt: now,
      completedAt: now,
      cleanupCompletedAt: now,
      updatedAt: now,
    });
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await queueStore.put(next);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return {
      ...sanitizeBlockedQueueItem(next),
      resolution,
      resolvedAt: now,
    };
  });
}

/** Mark local cleanup durable after a completed send; never changes send state. */
export async function markQueueCleanupComplete(
  clientId,
  ownerLease,
  {
    now = Date.now(),
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return runQueueWriteTransaction(db, async (store, tx) => {
    const row = await store.get(clientId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (
      !row
      || row.owner !== lease.owner
      || row.status !== 'done'
      || !PRODUCTION_QUEUE_TYPE_SET.has(row.type)
    ) return null;
    const next = {
      ...row,
      cleanupCompletedAt: now,
      updatedAt: now,
    };
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await store.put(next);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return next;
  });
}

/**
 * Automatically remove a bounded number of this owner's old, fully-cleaned
 * success rows. Failed/ambiguous rows and failed-cleanup rows are preserved.
 */
export async function pruneCompletedQueue(
  ownerLease,
  {
    now = Date.now(),
    retentionMs = DONE_RETENTION_MS,
    limit = DONE_PRUNE_LIMIT,
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  if (!Number.isFinite(retentionMs) || retentionMs < 0) {
    throw new Error('Completed queue retention must be non-negative');
  }
  const safeLimit = Math.max(1, Math.min(
    DONE_PRUNE_LIMIT,
    Number(limit) || DONE_PRUNE_LIMIT,
  ));
  const cutoff = now - retentionMs;
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const tx = db.transaction(STORES.QUEUE, 'readwrite');
  return settleTransaction(tx, async () => {
    const queueStore = tx.store;
    const rows = await queueStore
      .index(OFFLINE_INDEXES.QUEUE_OWNER_STATUS)
      .getAll([lease.owner, 'done']);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    const eligible = rows
      .filter((row) => (
        row?.owner === lease.owner
        && row.status === 'done'
        && PRODUCTION_QUEUE_TYPE_SET.has(row.type)
        && Number.isFinite(row.cleanupCompletedAt)
        && row.cleanupCompletedAt <= cutoff
      ))
      .sort((left, right) => (
        left.cleanupCompletedAt - right.cleanupCompletedAt
      ))
      .slice(0, safeLimit);
    for (const row of eligible) {
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
      await queueStore.delete(row.clientId);
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    }
    return eligible.length;
  });
}

async function recordPhotoCleanupFailure(
  db,
  clientId,
  lease,
  {
    now,
    maxRetries,
    isLeaseCurrent,
  },
) {
  const tx = db.transaction(STORES.QUEUE, 'readwrite');
  return settleTransaction(tx, async () => {
    const row = await tx.store.get(clientId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (
      !row
      || row.owner !== lease.owner
      || row.status !== 'done'
      || row.type !== 'photo.upload'
    ) return null;
    const retryCount = (row.photoCleanupRetryCount || 0) + 1;
    const exhausted = retryCount >= maxRetries;
    const backoff = PHOTO_CLEANUP_BACKOFF_MS[
      Math.min(retryCount - 1, PHOTO_CLEANUP_BACKOFF_MS.length - 1)
    ];
    const next = {
      ...row,
      photoCleanupRetryCount: retryCount,
      photoCleanupRetryAt: exhausted ? 0 : now + backoff,
      photoCleanupExhausted: exhausted,
      photoCleanupError: 'Owned local photo cleanup failed',
      updatedAt: now,
    };
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await tx.store.put(next);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return next;
  });
}

/**
 * Remove leftovers from the earlier non-idempotent photo queue without ever
 * dispatching them. Work is owner-scoped, attempt-bounded, backoff-limited,
 * and leaves an explicit quarantined row after exhaustion for secure cleanup.
 */
export async function retryFailedPhotoCleanup(
  ownerLease,
  {
    now = Date.now(),
    limit = PHOTO_CLEANUP_LIMIT,
    maxRetries = PHOTO_CLEANUP_MAX_RETRIES,
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const safeLimit = Math.max(1, Math.min(
    PHOTO_CLEANUP_LIMIT,
    Number(limit) || PHOTO_CLEANUP_LIMIT,
  ));
  const safeMaxRetries = Math.max(1, Math.min(
    PHOTO_CLEANUP_MAX_RETRIES,
    Number(maxRetries) || PHOTO_CLEANUP_MAX_RETRIES,
  ));
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const keys = await db.getAllKeysFromIndex(
    STORES.QUEUE,
    OFFLINE_INDEXES.QUEUE_OWNER_STATUS_TYPE,
    [lease.owner, 'done', 'photo.upload'],
  );
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const scanCount = Math.min(PHOTO_CLEANUP_SCAN_WINDOW, keys.length);
  const start = keys.length > 0
    ? Math.floor(Math.max(0, now) / PHOTO_CLEANUP_CURSOR_MS) % keys.length
    : 0;
  const scanKeys = Array.from(
    { length: scanCount },
    (_unused, offset) => keys[(start + offset) % keys.length],
  );
  const rows = await Promise.all(
    scanKeys.map((clientId) => db.get(STORES.QUEUE, clientId)),
  );
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const candidates = rows.filter((row) => (
    row?.owner === lease.owner
    && row.status === 'done'
    && row.type === 'photo.upload'
    && row.photoCleanupExhausted !== true
    && (!row.photoCleanupRetryAt || row.photoCleanupRetryAt <= now)
  )).slice(0, safeLimit);

  const result = {
    attempted: 0,
    cleaned: 0,
    failed: 0,
    exhausted: 0,
  };
  for (const candidate of candidates) {
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
    result.attempted += 1;
    try {
      const tx = db.transaction(
        [STORES.QUEUE, STORES.PHOTOS],
        'readwrite',
      );
      const cleaned = await settleTransaction(tx, async () => {
        const queueStore = storeFromTransaction(tx, STORES.QUEUE);
        const photoStore = storeFromTransaction(tx, STORES.PHOTOS);
        const [queueRow, photoRow] = await Promise.all([
          queueStore.get(candidate.clientId),
          photoStore.get(candidate.clientId),
        ]);
        assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
        if (
          !queueRow
          || queueRow.owner !== lease.owner
          || queueRow.status !== 'done'
          || queueRow.type !== 'photo.upload'
        ) return false;
        if (photoRow && photoRow.owner !== lease.owner) {
          throw new Error('Photo cleanup encountered a quarantined row');
        }
        if (photoRow) {
          assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
          await photoStore.delete(candidate.clientId);
          assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
        }
        assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
        await queueStore.delete(candidate.clientId);
        assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
        return true;
      });
      if (cleaned) result.cleaned += 1;
    } catch (error) {
      if (error instanceof OfflineLeaseStaleError) throw error;
      const failure = await recordPhotoCleanupFailure(
        db,
        candidate.clientId,
        lease,
        {
          now,
          maxRetries: safeMaxRetries,
          isLeaseCurrent,
        },
      );
      if (failure) {
        result.failed += 1;
        if (failure.photoCleanupExhausted) result.exhausted += 1;
      }
    }
  }
  return result;
}

/**
 * Store a photo under the current owner. Existing callers may omit the lease;
 * the exact latest device lease is then read and verified at write time.
 */
export async function savePhotoBlob(
  clientId,
  data,
  ownerLease = readPwaOwnerLease(),
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  if (!isStableQueueOperationId(clientId) || !data?.blob) {
    throw new Error('savePhotoBlob requires a UUID clientId + blob');
  }
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  await putOwnedRow(db, STORES.PHOTOS, clientId, {
    ...data,
    clientId,
    owner: lease.owner,
    createdEpoch: lease.epoch,
  }, lease, isLeaseCurrent);
}

/** Read a photo only for the exact latest owner lease. */
export async function getPhotoBlob(
  clientId,
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const row = await db.get(STORES.PHOTOS, clientId);
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return row?.owner === lease.owner ? row : undefined;
}

/** Delete a photo only after an owner check in the same write transaction. */
export async function deletePhoto(
  clientId,
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const tx = db.transaction(STORES.PHOTOS, 'readwrite');
  return settleTransaction(tx, async () => {
    const store = tx.store;
    const row = await store.get(clientId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    if (!row || row.owner !== lease.owner) return false;
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    await store.delete(clientId);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return true;
  });
}

export async function saveRoom(
  clientId,
  data,
  ownerLease = readPwaOwnerLease(),
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  if (!isStableQueueOperationId(clientId)) {
    throw new Error('saveRoom requires a UUID clientId');
  }
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  await putOwnedRow(db, STORES.ROOMS, clientId, {
    ...data,
    clientId,
    owner: lease.owner,
    createdEpoch: lease.epoch,
  }, lease, isLeaseCurrent);
}

export async function getRoom(
  clientId,
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const row = await db.get(STORES.ROOMS, clientId);
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return row?.owner === lease.owner ? row : undefined;
}

export async function recordIdSwap(
  tempId,
  serverId,
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  if (
    !isStableQueueOperationId(tempId)
    || typeof serverId !== 'string'
    || !UUID_PATTERN.test(serverId)
  ) return false;
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  await putOwnedRow(db, STORES.ID_SWAPS, tempId, {
    tempId,
    serverId,
    owner: lease.owner,
    createdEpoch: lease.epoch,
    resolvedAt: Date.now(),
  }, lease, isLeaseCurrent);
  return true;
}

export async function resolveIdSwap(
  maybeTempId,
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  if (!maybeTempId) return maybeTempId;
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const hit = await db.get(STORES.ID_SWAPS, maybeTempId);
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return hit?.owner === lease.owner ? hit.serverId : maybeTempId;
}

/** Dormant completion cleanup; removes none while the allowlist is empty. */
export async function clearDone(
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const tx = db.transaction(STORES.QUEUE, 'readwrite');
  return settleTransaction(tx, async () => {
    const queueStore = tx.store;
    const rows = await queueStore
      .index(OFFLINE_INDEXES.QUEUE_OWNER_STATUS)
      .getAll([lease.owner, 'done']);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    const done = rows.filter((row) => (
      row?.owner === lease.owner
      && row.status === 'done'
      && PRODUCTION_QUEUE_TYPE_SET.has(row.type)
    ));
    for (const row of done) {
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
      await queueStore.delete(row.clientId);
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    }
    return done.length;
  });
}

/**
 * Payload-free destructive recovery for a legacy/unsupported local database.
 * The user-facing layer must require the standard two-click confirmation and
 * warn that every account's unsynced local work on this device is discarded.
 */
export async function discardAllOfflineData(
  ownerLease,
  {
    confirmation,
    isLeaseCurrent = isPwaOwnerLeaseCurrent,
  } = {},
) {
  if (confirmation !== OFFLINE_DATA_DISCARD_CONFIRMATION) {
    throw new Error('Explicit offline data discard confirmation is required');
  }
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const storeNames = Object.values(STORES);
  const tx = db.transaction(storeNames, 'readwrite');
  return settleTransaction(tx, async () => {
    const clears = [];
    for (const storeName of storeNames) {
      assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
      clears.push(storeFromTransaction(tx, storeName).clear());
    }
    await Promise.all(clears);
    assertLeaseCurrentAtBoundary(lease, isLeaseCurrent, tx);
    return { cleared: true };
  });
}

export async function queueCounts(
  ownerLease,
  { isLeaseCurrent = isPwaOwnerLeaseCurrent } = {},
) {
  const lease = requireCurrentLease(ownerLease, isLeaseCurrent);
  const db = await openOfflineDb();
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  const rows = await db.getAllFromIndex(
    STORES.QUEUE,
    OFFLINE_INDEXES.OWNER,
    lease.owner,
  );
  assertLeaseCurrentAtBoundary(lease, isLeaseCurrent);
  return rows.reduce((counts, row) => {
    if (
      row?.owner !== lease.owner
      || !PRODUCTION_QUEUE_TYPE_SET.has(row.type)
      || row.operationId !== row.clientId
      || !isStableQueueOperationId(row.operationId)
    ) return counts;
    if (row.status === 'pending') counts.pending += 1;
    if (row.status === 'syncing') counts.syncing += 1;
    if (row.status === 'error') {
      counts.error += 1;
      if (row.retryBlocked || !isQueueItemReplaySafe(row)) counts.blocked += 1;
      else counts.retryableError += 1;
    }
    if (row.status === 'done') counts.done += 1;
    return counts;
  }, {
    pending: 0,
    syncing: 0,
    error: 0,
    retryableError: 0,
    blocked: 0,
    done: 0,
  });
}

/**
 * Inspect every durable store without returning payloads. Unowned and foreign
 * rows remain preserved, and the owner-safe APIs above make them unreadable.
 */
export async function inspectOfflineOwnership(owner = null) {
  if (owner !== null) requireQueueOwner(owner);
  const db = await openOfflineDb();
  const stores = {};
  let owned = 0;
  let otherOwner = 0;
  let legacy = 0;
  let unsupportedOwned = 0;
  let orphanPhotoOwned = 0;
  let total = 0;

  for (const storeName of [STORES.QUEUE, ...AUXILIARY_STORES]) {
    const [
      storeTotal,
      indexedOwnerTotal,
      ownerTotal,
    ] = await Promise.all([
      db.count(storeName),
      db.countFromIndex(storeName, OFFLINE_INDEXES.OWNER),
      owner
        ? db.countFromIndex(
          storeName,
          OFFLINE_INDEXES.OWNER,
          owner,
        )
        : 0,
    ]);
    const counts = {
      owned: ownerTotal,
      otherOwner: indexedOwnerTotal - ownerTotal,
      legacy: storeTotal - indexedOwnerTotal,
      // Automatic command admission/replay is disabled. Every pre-existing
      // owner row is therefore quarantined until explicit recovery/discard.
      unsupportedOwned: ownerTotal,
      orphanedOwned: storeName === STORES.PHOTOS ? ownerTotal : 0,
      total: storeTotal,
    };
    stores[storeName] = counts;
    owned += counts.owned;
    otherOwner += counts.otherOwner;
    legacy += counts.legacy;
    unsupportedOwned += counts.unsupportedOwned;
    orphanPhotoOwned += counts.orphanedOwned;
    total += counts.total;
  }

  const legacyRecoveryRequired = legacy > 0;
  const unsupportedRecoveryRequired = unsupportedOwned > 0;
  const rolloutReady = !legacyRecoveryRequired
    && !unsupportedRecoveryRequired;
  const rolloutGate = rolloutReady
    ? null
    : {
      code: 'OFFLINE_LEGACY_BRIDGE_REQUIRED',
      blocking: true,
      preservationProven: false,
      destructiveCleanupAvailable: true,
      guidance:
        'Stop here to preserve unsynced legacy work. Close other UPR tabs and complete the staged recovery rollout, or explicitly discard all local offline data.',
    };

  return {
    ready: true,
    // `quarantined` is a capability/transition contract consumed by
    // pwaAccountState, not an assertion that records currently exist.
    quarantined: true,
    hasQuarantinedRecords: otherOwner + legacy + unsupportedOwned > 0,
    owned,
    otherOwner,
    legacy,
    unsupportedOwned,
    orphanPhotoOwned,
    rolloutReady,
    legacyRecoveryRequired,
    unsupportedRecoveryRequired,
    rolloutGate,
    quarantinedTotal: otherOwner + legacy + unsupportedOwned,
    total,
    stores,
  };
}

// Backward-compatible name for current account-transition callers.
export const inspectQueueOwnership = inspectOfflineOwnership;
