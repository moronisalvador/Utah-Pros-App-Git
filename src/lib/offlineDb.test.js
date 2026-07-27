/**
 * ════════════════════════════════════════════════
 * FILE: offlineDb.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves saved offline work stays attached to its account, two tabs cannot
 *   claim the same action, expired work recovers according to its real server
 *   idempotency, and auxiliary blobs/IDs never cross accounts.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  offlineDb
 *   Data:      none (serialized in-memory IndexedDB fake only)
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';

const leaseState = vi.hoisted(() => ({
  current: null,
}));

vi.mock('./resumeRestore.js', () => ({
  normalizePwaOwnerLease: (lease) => (
    lease?.owner?.startsWith('v1.') && lease?.epoch?.startsWith('e1.')
      ? { owner: lease.owner, epoch: lease.epoch }
      : null
  ),
  readPwaOwnerLease: () => leaseState.current,
  isPwaOwnerLeaseCurrent: (lease) => (
    lease?.owner === leaseState.current?.owner
    && lease?.epoch === leaseState.current?.epoch
  ),
}));

const fake = vi.hoisted(() => {
  const keyPaths = {
    queue: 'clientId',
    photos: 'clientId',
    rooms: 'clientId',
    readings: 'clientId',
    equipment: 'clientId',
    cacheMeta: 'key',
    idSwaps: 'tempId',
  };
  const stores = new Map(
    Object.keys(keyPaths).map((name) => [name, new Map()]),
  );
  const reads = {
    full: new Map(),
    index: new Map(),
  };
  let afterGet = null;
  let afterMutation = null;
  let transactionTail = Promise.resolve();

  const mapFor = (name) => stores.get(name);
  const clone = (value) => (
    value === undefined ? undefined : structuredClone(value)
  );
  const indexedValue = (row, indexName) => {
    if (indexName === 'owner') return row?.owner;
    if (indexName === 'ownerStatus') return [row?.owner, row?.status];
    if (indexName === 'ownerStatusType') {
      return [row?.owner, row?.status, row?.type];
    }
    throw new Error(`Unknown fake index: ${indexName}`);
  };
  const validIndexKey = (value) => (
    Array.isArray(value)
      ? value.every((part) => part !== undefined && part !== null)
      : value !== undefined && value !== null
  );
  const sameKey = (left, right) => (
    JSON.stringify(left) === JSON.stringify(right)
  );
  const indexRows = (name, indexName, query) => (
    [...mapFor(name).values()].filter((row) => {
      const value = indexedValue(row, indexName);
      return validIndexKey(value)
        && (query === undefined || sameKey(value, query));
    })
  );
  const recordRead = (bucket, name) => {
    const key = `${name}`;
    bucket.set(key, (bucket.get(key) || 0) + 1);
  };
  const indexApi = (name, indexName, started) => ({
    async getAll(query, count) {
      await started;
      recordRead(reads.index, `${name}:${indexName}`);
      const rows = indexRows(name, indexName, query);
      return (count === undefined ? rows : rows.slice(0, count)).map(clone);
    },
    async count(query) {
      await started;
      recordRead(reads.index, `${name}:${indexName}`);
      return indexRows(name, indexName, query).length;
    },
  });
  const storeApi = (name, started) => ({
    async add(row) {
      await started;
      const key = row[keyPaths[name]];
      if (mapFor(name).has(key)) throw new Error('ConstraintError');
      mapFor(name).set(key, clone(row));
      afterMutation?.({ action: 'add', store: name, key, row: clone(row) });
    },
    async put(row) {
      await started;
      const key = row[keyPaths[name]];
      mapFor(name).set(key, clone(row));
      afterMutation?.({ action: 'put', store: name, key, row: clone(row) });
    },
    async get(key) {
      await started;
      const value = clone(mapFor(name).get(key));
      afterGet?.({ store: name, key, value });
      return value;
    },
    async getAll() {
      await started;
      recordRead(reads.full, name);
      return [...mapFor(name).values()].map(clone);
    },
    async delete(key) {
      await started;
      mapFor(name).delete(key);
      afterMutation?.({ action: 'delete', store: name, key });
    },
    async clear() {
      await started;
      mapFor(name).clear();
      afterMutation?.({ action: 'clear', store: name });
    },
    index(indexName) {
      return indexApi(name, indexName, started);
    },
  });

  const dbListeners = new Map();
  const db = {
    close: vi.fn(),
    addEventListener: vi.fn((event, callback) => {
      if (!dbListeners.has(event)) dbListeners.set(event, new Set());
      dbListeners.get(event).add(callback);
    }),
    async put(name, row) {
      mapFor(name).set(row[keyPaths[name]], clone(row));
    },
    async getAll(name) {
      recordRead(reads.full, name);
      return [...mapFor(name).values()].map(clone);
    },
    async getAllFromIndex(name, indexName, query, count) {
      recordRead(reads.index, `${name}:${indexName}`);
      const rows = indexRows(name, indexName, query);
      return (count === undefined ? rows : rows.slice(0, count)).map(clone);
    },
    async getAllKeysFromIndex(name, indexName, query, count) {
      recordRead(reads.index, `${name}:${indexName}:keys`);
      const rows = indexRows(name, indexName, query);
      return (count === undefined ? rows : rows.slice(0, count))
        .map((row) => clone(row[keyPaths[name]]));
    },
    async count(name) {
      return mapFor(name).size;
    },
    async countFromIndex(name, indexName, query) {
      recordRead(reads.index, `${name}:${indexName}`);
      return indexRows(name, indexName, query).length;
    },
    async get(name, key) {
      return clone(mapFor(name).get(key));
    },
    async delete(name, key) {
      mapFor(name).delete(key);
    },
    transaction(names) {
      const storeNames = Array.isArray(names) ? names : [names];
      const snapshots = new Map(storeNames.map((name) => [
        name,
        new Map(
          [...mapFor(name).entries()]
            .map(([key, value]) => [key, clone(value)]),
        ),
      ]));
      const started = transactionTail;
      let release;
      const released = new Promise((resolve) => {
        release = resolve;
      });
      transactionTail = started.then(() => released);
      let finished = false;
      let aborted = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          release();
        }
      };
      const apis = new Map(
        storeNames.map((name) => [name, storeApi(name, started)]),
      );
      const abort = vi.fn(() => {
        if (aborted) return;
        aborted = true;
        for (const [name, snapshot] of snapshots) {
          const store = mapFor(name);
          store.clear();
          for (const [key, value] of snapshot) store.set(key, clone(value));
        }
        finish();
      });
      return {
        store: apis.get(storeNames[0]),
        objectStore: (name) => apis.get(name),
        abort,
        done: {
          then(onFulfilled, onRejected) {
            finish();
            return started.then(onFulfilled, onRejected);
          },
        },
      };
    },
  };

  return {
    db,
    stores,
    reads,
    setAfterGet(callback) {
      afterGet = callback;
    },
    setAfterMutation(callback) {
      afterMutation = callback;
    },
    emitDbEvent(event) {
      for (const callback of dbListeners.get(event) || []) callback();
    },
    reset() {
      for (const store of stores.values()) store.clear();
      reads.full.clear();
      reads.index.clear();
      db.close.mockClear();
      db.addEventListener.mockClear();
      dbListeners.clear();
      afterGet = null;
      afterMutation = null;
      transactionTail = Promise.resolve();
    },
  };
});

vi.mock('idb', () => ({
  openDB: vi.fn(async () => fake.db),
}));

import {
  OFFLINE_DATA_DISCARD_CONFIRMATION,
  OFFLINE_DB_VERSION,
  PRODUCTION_QUEUE_TYPES,
  STORES,
  claimQueueItem,
  clearDone,
  deletePhoto,
  discardAllOfflineData,
  enqueueItem,
  getOfflineDbOpenState,
  getPhotoBlob,
  inspectOfflineOwnership,
  listBlockedQueueItems,
  listQueue,
  markQueueCleanupComplete,
  pruneCompletedQueue,
  queueCounts,
  recoverStaleQueueClaims,
  resolveBlockedQueueItem,
  retryFailedPhotoCleanup,
  retryOfflineDbOpen,
  retryQueueItem,
  savePhotoBlob,
  saveRoom,
  settleQueueClaim,
  upgradeOfflineDbSchema,
} from './offlineDb.js';

const OWNER_A = 'v1.aaaaaaaaaaaa';
const OWNER_B = 'v1.bbbbbbbbbbbb';
const LEASE_A = { owner: OWNER_A, epoch: 'e1.session-a' };
const LEASE_A_NEW = { owner: OWNER_A, epoch: 'e1.session-a-new' };
const LEASE_B = { owner: OWNER_B, epoch: 'e1.session-b' };
const ID_1 = '00000000-0000-4000-8000-000000000001';
const ID_2 = '00000000-0000-4000-8000-000000000002';
const ID_3 = '00000000-0000-4000-8000-000000000003';
const ID_4 = '00000000-0000-4000-8000-000000000004';
const ID_5 = '00000000-0000-4000-8000-000000000005';
const ID_6 = '00000000-0000-4000-8000-000000000006';
const ID_7 = '00000000-0000-4000-8000-000000000007';

function fixtureId(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}

function seed(store, row) {
  const key = store === STORES.ID_SWAPS
    ? row.tempId
    : store === STORES.CACHE_META
      ? row.key
      : row.clientId;
  fake.stores.get(store).set(key, structuredClone(row));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('offline durable ownership and queue claims', () => {
  beforeEach(() => {
    fake.reset();
    leaseState.current = LEASE_A;
  });

  it('upgrades v1 with owner, status, and cleanup indexes', () => {
    const created = new Map();
    for (const storeName of Object.values(STORES)) {
      const indexes = new Map();
      created.set(storeName, {
        indexNames: {
          contains: (name) => indexes.has(name),
        },
        createIndex: vi.fn((name, keyPath) => {
          indexes.set(name, keyPath);
        }),
        indexes,
      });
    }
    const transaction = {
      objectStore: (name) => created.get(name),
    };

    upgradeOfflineDbSchema({}, 1, transaction);

    expect(OFFLINE_DB_VERSION).toBe(3);
    expect(created.get(STORES.QUEUE).indexes).toEqual(new Map([
      ['owner', 'owner'],
      ['ownerStatus', ['owner', 'status']],
      ['ownerStatusType', ['owner', 'status', 'type']],
    ]));
    for (const storeName of Object.values(STORES).filter(
      (name) => name !== STORES.QUEUE,
    )) {
      expect(created.get(storeName).indexes)
        .toEqual(new Map([['owner', 'owner']]));
    }
  });

  it('refuses every automatic command admission in the online-first release', async () => {
    await expect(enqueueItem({
      clientId: '1785000000000-0.123',
      type: 'reading.insert',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/UUID client operation ID/i);
    await expect(enqueueItem({
      clientId: '00000000-0000-1000-8000-000000000001',
      type: 'reading.insert',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/UUID client operation ID/i);
    await expect(savePhotoBlob(
      '1785000000000-0.123',
      { blob: new Blob(['invalid']) },
      LEASE_A,
    )).rejects.toThrow(/UUID clientId/i);
    await expect(enqueueItem({
      clientId: ID_2,
      type: 'room.create',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/not enabled in production/i);
    await expect(enqueueItem({
      clientId: ID_2,
      type: 'note.insert',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/not enabled in production/i);
    await expect(enqueueItem({
      clientId: ID_2,
      type: 'task.toggle',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/not enabled in production/i);
    await expect(enqueueItem({
      clientId: ID_2,
      type: 'photo.upload',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/not enabled in production/i);
    await expect(enqueueItem({
      clientId: ID_2,
      type: 'equipment.remove',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/not enabled in production/i);
    await expect(enqueueItem({
      clientId: ID_2,
      type: 'reading.insert',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/not enabled in production/i);
    await expect(enqueueItem({
      clientId: ID_2,
      type: 'equipment.place',
      ownerLease: LEASE_A,
    })).rejects.toThrow(/not enabled in production/i);
    expect(PRODUCTION_QUEUE_TYPES).toEqual([]);
    expect(fake.stores.get(STORES.QUEUE).size).toBe(0);

    leaseState.current = LEASE_B;
    await expect(listQueue(undefined, LEASE_A))
      .rejects.toThrow(/latest verified offline owner lease/i);
    await expect(listQueue(undefined, LEASE_B)).resolves.toEqual([]);
  });

  it('cannot claim, settle, recover, or retry a historical command row', async () => {
    seed(STORES.QUEUE, {
      clientId: ID_3,
      operationId: ID_3,
      type: 'equipment.place',
      owner: OWNER_A,
      status: 'pending',
      retryBlocked: false,
    });
    await expect(claimQueueItem(
      ID_3,
      LEASE_A,
      'c1.disabled-claim',
    )).resolves.toBe(null);
    const row = fake.stores.get(STORES.QUEUE).get(ID_3);
    row.status = 'syncing';
    row.claimEpoch = LEASE_A.epoch;
    row.claimToken = 'c1.historical-claim';
    fake.stores.get(STORES.QUEUE).set(ID_3, row);
    await expect(settleQueueClaim(
      ID_3,
      LEASE_A,
      'c1.historical-claim',
      'done',
    )).resolves.toBe(null);
    await expect(recoverStaleQueueClaims(LEASE_A, { now: 1_000 }))
      .resolves.toEqual([]);
    row.status = 'error';
    fake.stores.get(STORES.QUEUE).set(ID_3, row);
    await expect(retryQueueItem(ID_3, LEASE_A)).resolves.toBe(null);
  });

  it('leaves every historical syncing command quarantined and untouched', async () => {
    seed(STORES.QUEUE, {
      clientId: ID_4,
      operationId: ID_4,
      owner: OWNER_A,
      type: 'reading.insert',
      status: 'syncing',
      claimToken: 'c1.dead-safe',
      claimEpoch: 'e1.dead',
      claimExpiresAt: 99,
      retryCount: 0,
    });
    seed(STORES.QUEUE, {
      clientId: ID_5,
      operationId: ID_5,
      owner: OWNER_A,
      type: 'equipment.remove',
      status: 'syncing',
      claimToken: 'c1.dead-unsafe',
      claimEpoch: 'e1.dead',
      claimExpiresAt: 99,
      retryCount: 0,
    });
    seed(STORES.QUEUE, {
      clientId: ID_6,
      operationId: ID_6,
      owner: OWNER_A,
      type: 'equipment.place',
      status: 'syncing',
      claimToken: 'c1.active',
      claimEpoch: LEASE_A.epoch,
      claimExpiresAt: 200,
    });

    await expect(recoverStaleQueueClaims(LEASE_A, { now: 100 }))
      .resolves.toEqual([]);
    expect(fake.stores.get(STORES.QUEUE).get(ID_4)).toMatchObject({
      status: 'syncing',
      operationId: ID_4,
      claimToken: 'c1.dead-safe',
    });
    expect(fake.stores.get(STORES.QUEUE).get(ID_5)).toMatchObject({
      status: 'syncing',
      claimToken: 'c1.dead-unsafe',
      claimEpoch: 'e1.dead',
    });
    expect(fake.stores.get(STORES.QUEUE).get(ID_6)?.status)
      .toBe('syncing');
    expect(await queueCounts(LEASE_A)).toMatchObject({
      pending: 0,
      syncing: 0,
      error: 0,
      retryableError: 0,
      blocked: 0,
    });

    await expect(retryQueueItem(ID_5, LEASE_A)).resolves.toBe(null);
    await expect(retryQueueItem(ID_4, LEASE_A)).resolves.toBe(null);
  });

  it('owner-binds photo writes/reads and refuses foreign key collisions', async () => {
    const blob = new Blob(['account-a'], { type: 'image/jpeg' });
    await savePhotoBlob(
      ID_7,
      { blob, name: 'a.jpg' },
      LEASE_A,
    );
    await expect(getPhotoBlob(ID_7, LEASE_A))
      .resolves.toMatchObject({ owner: OWNER_A, name: 'a.jpg' });

    leaseState.current = LEASE_B;
    await expect(getPhotoBlob(ID_7, LEASE_B))
      .resolves.toBeUndefined();
    await expect(savePhotoBlob(
      ID_7,
      { blob: new Blob(['account-b']), name: 'b.jpg' },
      LEASE_B,
    )).rejects.toThrow(/quarantined/i);
    expect(fake.stores.get(STORES.PHOTOS).get(ID_7))
      .toMatchObject({ owner: OWNER_A, name: 'a.jpg' });
  });

  it('inspects every durable store without exposing preserved payloads', async () => {
    seed(STORES.QUEUE, {
      clientId: 'owned-queue',
      owner: OWNER_A,
      payload: { secret: 'owned' },
    });
    seed(STORES.PHOTOS, {
      clientId: 'foreign-photo',
      owner: OWNER_B,
      blob: new Blob(['foreign']),
    });
    seed(STORES.ROOMS, {
      clientId: 'legacy-room',
      payload: { secret: 'legacy' },
    });

    const result = await inspectOfflineOwnership(OWNER_A);
    expect(result).toMatchObject({
      ready: true,
      quarantined: true,
      owned: 1,
      otherOwner: 1,
      legacy: 1,
      unsupportedOwned: 1,
      rolloutReady: false,
      legacyRecoveryRequired: true,
      unsupportedRecoveryRequired: true,
      total: 3,
      stores: {
        queue: { owned: 1, total: 1 },
        photos: { otherOwner: 1, total: 1 },
        rooms: { legacy: 1, total: 1 },
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('foreign-photo');
    expect(fake.reads.full.size).toBe(0);
  });

  it('uses owner indexes at scale without materializing foreign photo blobs', async () => {
    for (let index = 100; index < 600; index += 1) {
      seed(STORES.QUEUE, {
        clientId: fixtureId(index),
        operationId: fixtureId(index),
        owner: OWNER_B,
        status: index % 2 ? 'pending' : 'syncing',
        type: 'reading.insert',
        claimExpiresAt: 0,
        payload: { secret: `foreign-${index}` },
      });
    }
    for (let index = 600; index < 700; index += 1) {
      seed(STORES.PHOTOS, {
        clientId: fixtureId(index),
        owner: OWNER_B,
        blob: new Blob([`foreign-blob-${index}`]),
      });
    }
    for (let index = 700; index < 750; index += 1) {
      seed(STORES.PHOTOS, {
        clientId: fixtureId(index),
        blob: new Blob([`legacy-blob-${index}`]),
      });
    }
    seed(STORES.QUEUE, {
      clientId: ID_1,
      operationId: ID_1,
      owner: OWNER_A,
      status: 'pending',
      type: 'reading.insert',
      payload: { material: 'drywall' },
    });

    expect(await listQueue('pending', LEASE_A)).toHaveLength(0);
    expect(await queueCounts(LEASE_A)).toMatchObject({ pending: 0 });
    expect(await recoverStaleQueueClaims(LEASE_A, { now: 10 })).toEqual([]);
    const ownership = await inspectOfflineOwnership(OWNER_A);
    expect(ownership).toMatchObject({
      owned: 1,
      otherOwner: 600,
      legacy: 50,
      unsupportedOwned: 1,
      total: 651,
    });
    expect(fake.reads.full.size).toBe(0);
    expect(fake.reads.index.get('photos:owner')).toBeGreaterThan(0);
  });

  it('exposes sanitized owner-only reconciliation and never blindly retries', async () => {
    seed(STORES.QUEUE, {
      clientId: ID_1,
      operationId: ID_1,
      owner: OWNER_A,
      status: 'error',
      type: 'reading.insert',
      retryBlocked: true,
      ambiguous: true,
      createdAt: 100,
      updatedAt: 200,
      lastError: 'upstream secret error body',
      payload: {
        jobId: 'job-1',
        material: 'drywall',
        description: 'private customer note',
      },
    });
    seed(STORES.QUEUE, {
      clientId: ID_2,
      operationId: ID_2,
      owner: OWNER_A,
      status: 'error',
      type: 'equipment.place',
      retryBlocked: true,
      ambiguous: false,
      createdAt: 300,
      payload: {
        jobId: 'job-2',
        equipmentType: 'air-mover',
        secret: 'never expose',
      },
    });
    seed(STORES.QUEUE, {
      clientId: ID_3,
      operationId: ID_3,
      owner: OWNER_A,
      status: 'error',
      type: 'reading.insert',
      retryBlocked: false,
      ambiguous: true,
      payload: { jobId: 'job-3', material: 'wood' },
    });
    seed(STORES.QUEUE, {
      clientId: ID_4,
      operationId: ID_4,
      owner: OWNER_B,
      status: 'error',
      type: 'photo.upload',
      retryBlocked: true,
      ambiguous: true,
      payload: { secret: 'foreign' },
    });

    const blocked = await listBlockedQueueItems(LEASE_A);
    expect(blocked).toEqual([]);
    expect(JSON.stringify(blocked)).not.toContain('upstream secret');
    expect(JSON.stringify(blocked)).not.toContain('private customer note');
    expect(JSON.stringify(blocked)).not.toContain('never expose');
    expect(JSON.stringify(blocked)).not.toContain('foreign');
    await expect(retryQueueItem(ID_1, LEASE_A)).resolves.toBe(null);
    await expect(retryQueueItem(ID_2, LEASE_A)).resolves.toBe(null);
    await expect(retryQueueItem(ID_3, LEASE_A)).resolves.toBe(null);

    await expect(resolveBlockedQueueItem(
      ID_1,
      LEASE_A,
      { resolution: 'accepted' },
    )).resolves.toBe(null);
    await expect(resolveBlockedQueueItem(
      ID_2,
      LEASE_A,
      {
        resolution: 'accepted',
        evidence: 'confirmed-visible-on-server',
      },
    )).resolves.toBe(null);
    await expect(resolveBlockedQueueItem(
      ID_4,
      LEASE_A,
      { resolution: 'cancelled' },
    )).resolves.toBe(null);

    await expect(resolveBlockedQueueItem(
      ID_1,
      LEASE_A,
      {
        resolution: 'accepted',
        evidence: 'confirmed-visible-on-server',
        now: 500,
      },
    )).resolves.toBe(null);
    expect(fake.stores.get(STORES.QUEUE).get(ID_1)).toMatchObject({
      status: 'error',
      retryBlocked: true,
    });

    await expect(resolveBlockedQueueItem(
      ID_2,
      LEASE_A,
      { resolution: 'cancelled', now: 600 },
    )).resolves.toBe(null);
    expect(fake.stores.get(STORES.QUEUE).has(ID_2)).toBe(true);
    expect(fake.stores.get(STORES.QUEUE).has(ID_4)).toBe(true);
  });

  it('prunes only a bounded set of old successes after local cleanup', async () => {
    for (let index = 10; index < 75; index += 1) {
      seed(STORES.QUEUE, {
        clientId: fixtureId(index),
        operationId: fixtureId(index),
        owner: OWNER_A,
        status: 'done',
        type: 'reading.insert',
        cleanupCompletedAt: 100,
      });
    }
    seed(STORES.QUEUE, {
      clientId: ID_1,
      operationId: ID_1,
      owner: OWNER_A,
      status: 'done',
      type: 'photo.upload',
      cleanupCompletedAt: null,
    });
    seed(STORES.PHOTOS, {
      clientId: ID_1,
      owner: OWNER_A,
      blob: new Blob(['cleanup-failed']),
    });
    seed(STORES.QUEUE, {
      clientId: ID_2,
      operationId: ID_2,
      owner: OWNER_A,
      status: 'error',
      type: 'equipment.remove',
      retryBlocked: true,
      ambiguous: true,
    });
    seed(STORES.QUEUE, {
      clientId: ID_3,
      operationId: ID_3,
      owner: OWNER_B,
      status: 'done',
      type: 'reading.insert',
      cleanupCompletedAt: 100,
    });

    expect(await pruneCompletedQueue(LEASE_A, {
      now: 1_000,
      retentionMs: 500,
      limit: 10,
    })).toBe(0);
    expect([...fake.stores.get(STORES.QUEUE).values()]
      .filter((row) => row.owner === OWNER_A && row.status === 'done'))
      .toHaveLength(66);
    expect(fake.stores.get(STORES.QUEUE).has(ID_1)).toBe(true);
    expect(fake.stores.get(STORES.PHOTOS).has(ID_1)).toBe(true);
    expect(fake.stores.get(STORES.QUEUE).has(ID_2)).toBe(true);
    expect(fake.stores.get(STORES.QUEUE).has(ID_3)).toBe(true);

    expect(await markQueueCleanupComplete(ID_1, LEASE_A, { now: 1_100 }))
      .toBe(null);
  });

  it('lists/counts/clears only current owned rows and owned photo remnants', async () => {
    for (const row of [
      {
        clientId: ID_1,
        operationId: ID_1,
        owner: OWNER_A,
        status: 'done',
        type: 'reading.insert',
      },
      {
        clientId: ID_2,
        operationId: ID_2,
        owner: OWNER_A,
        status: 'pending',
        type: 'reading.insert',
      },
      {
        clientId: ID_3,
        operationId: ID_3,
        owner: OWNER_B,
        status: 'done',
        type: 'reading.insert',
      },
      { clientId: ID_4, operationId: ID_4, status: 'done' },
      {
        clientId: ID_5,
        operationId: ID_5,
        owner: OWNER_A,
        status: 'done',
        type: 'photo.upload',
      },
    ]) seed(STORES.QUEUE, row);
    seed(STORES.PHOTOS, {
      clientId: ID_5,
      owner: OWNER_A,
      blob: new Blob(['owned']),
    });

    expect(await queueCounts(LEASE_A)).toEqual({
      pending: 0,
      syncing: 0,
      error: 0,
      retryableError: 0,
      blocked: 0,
      done: 0,
    });
    expect(await clearDone(LEASE_A)).toBe(0);
    expect(fake.stores.get(STORES.QUEUE).has(ID_1)).toBe(true);
    expect(fake.stores.get(STORES.QUEUE).has(ID_5)).toBe(true);
    expect(fake.stores.get(STORES.PHOTOS).has(ID_5)).toBe(true);
    expect(fake.stores.get(STORES.QUEUE).has(ID_3)).toBe(true);
    expect(fake.stores.get(STORES.QUEUE).has(ID_4)).toBe(true);
  });

  it('times out a blocked upgrade, closes a late connection, and retries', async () => {
    vi.useFakeTimers();
    try {
      const lateOpen = deferred();
      let openOptions = null;
      vi.mocked(openDB).mockImplementationOnce((
        _name,
        _version,
        options,
      ) => {
        openOptions = options;
        return lateOpen.promise;
      });
      const opening = retryOfflineDbOpen({ timeoutMs: 25 });
      openOptions.blocked();
      expect(getOfflineDbOpenState()).toMatchObject({
        status: 'blocked',
        code: 'OFFLINE_DB_OPEN_BLOCKED',
      });
      const rejected = expect(opening).rejects.toMatchObject({
        code: 'OFFLINE_DB_OPEN_BLOCKED',
        guidance: expect.stringMatching(/close other UPR tabs/i),
      });
      await vi.advanceTimersByTimeAsync(25);
      await rejected;
      expect(getOfflineDbOpenState()).toMatchObject({
        status: 'error',
        code: 'OFFLINE_DB_OPEN_BLOCKED',
      });

      lateOpen.resolve(fake.db);
      await Promise.resolve();
      await Promise.resolve();
      expect(fake.db.close).toHaveBeenCalled();

      await expect(retryOfflineDbOpen({ timeoutMs: 25 }))
        .resolves.toBe(fake.db);
      expect(getOfflineDbOpenState()).toMatchObject({
        status: 'ready',
        code: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes on versionchange and exposes actionable retry state', async () => {
    await retryOfflineDbOpen({ timeoutMs: 100 });
    fake.emitDbEvent('versionchange');
    expect(fake.db.close).toHaveBeenCalled();
    expect(getOfflineDbOpenState()).toMatchObject({
      status: 'version-changed',
      code: 'OFFLINE_DB_VERSION_CHANGED',
      guidance: expect.stringMatching(/close other UPR tabs/i),
    });
    await expect(retryOfflineDbOpen({ timeoutMs: 100 }))
      .resolves.toBe(fake.db);
  });

  it('types synchronous open failures and ignores stale blocking callbacks', async () => {
    vi.mocked(openDB).mockImplementationOnce(() => {
      throw new DOMException('IndexedDB denied', 'SecurityError');
    });
    await expect(retryOfflineDbOpen({ timeoutMs: 100 }))
      .rejects.toMatchObject({
        code: 'OFFLINE_DB_OPEN_FAILED',
        guidance: expect.stringMatching(/close other UPR tabs/i),
      });
    expect(getOfflineDbOpenState()).toMatchObject({
      status: 'error',
      code: 'OFFLINE_DB_OPEN_FAILED',
    });

    let oldOptions;
    const oldDb = {
      close: vi.fn(),
      addEventListener: vi.fn(),
    };
    vi.mocked(openDB).mockImplementationOnce((_name, _version, options) => {
      oldOptions = options;
      return Promise.resolve(oldDb);
    });
    await retryOfflineDbOpen({ timeoutMs: 100 });

    const newDb = {
      close: vi.fn(),
      addEventListener: vi.fn(),
    };
    vi.mocked(openDB).mockImplementationOnce(() => Promise.resolve(newDb));
    await retryOfflineDbOpen({ timeoutMs: 100 });
    newDb.close.mockClear();

    oldOptions.blocking();
    expect(newDb.close).not.toHaveBeenCalled();
    expect(getOfflineDbOpenState()).toMatchObject({
      status: 'ready',
      code: null,
    });
  });

  it('rejects an auxiliary write whose lease expires while the database opens', async () => {
    const delayedOpen = deferred();
    vi.mocked(openDB).mockImplementationOnce(() => delayedOpen.promise);
    const opening = retryOfflineDbOpen({ timeoutMs: 1_000 });
    const write = saveRoom(ID_1, { name: 'Delayed room' }, LEASE_A);
    leaseState.current = LEASE_A_NEW;
    delayedOpen.resolve(fake.db);
    await expect(opening).resolves.toBe(fake.db);
    await expect(write).rejects.toMatchObject({
      code: 'OFFLINE_LEASE_STALE',
    });
    expect(fake.stores.get(STORES.ROOMS).has(ID_1)).toBe(false);
  });

  it('revalidates blob, manual-resolution, and delete transactions at mutation time', async () => {
    leaseState.current = LEASE_A;
    fake.setAfterGet(() => {
      leaseState.current = LEASE_A_NEW;
    });
    await expect(savePhotoBlob(
      ID_1,
      { blob: new Blob(['late']) },
      LEASE_A,
    )).rejects.toMatchObject({ code: 'OFFLINE_LEASE_STALE' });
    expect(fake.stores.get(STORES.PHOTOS).has(ID_1)).toBe(false);

    leaseState.current = LEASE_A;
    seed(STORES.QUEUE, {
      clientId: ID_2,
      operationId: ID_2,
      owner: OWNER_A,
      status: 'error',
      type: 'reading.insert',
      retryBlocked: true,
      ambiguous: true,
    });
    await expect(resolveBlockedQueueItem(
      ID_2,
      LEASE_A,
      {
        resolution: 'accepted',
        evidence: 'confirmed-visible-on-server',
      },
    )).rejects.toMatchObject({ code: 'OFFLINE_LEASE_STALE' });
    expect(fake.stores.get(STORES.QUEUE).get(ID_2)?.status).toBe('error');

    leaseState.current = LEASE_A;
    fake.setAfterGet(() => {
      leaseState.current = LEASE_A_NEW;
    });
    seed(STORES.QUEUE, {
      clientId: ID_3,
      operationId: ID_3,
      owner: OWNER_A,
      status: 'error',
      type: 'equipment.place',
      retryBlocked: true,
      ambiguous: false,
    });
    await expect(resolveBlockedQueueItem(
      ID_3,
      LEASE_A,
      { resolution: 'cancelled' },
    )).rejects.toMatchObject({ code: 'OFFLINE_LEASE_STALE' });
    expect(fake.stores.get(STORES.QUEUE).has(ID_3)).toBe(true);

    leaseState.current = LEASE_A;
    fake.setAfterGet(() => {
      leaseState.current = LEASE_A_NEW;
    });
    seed(STORES.PHOTOS, {
      clientId: ID_4,
      owner: OWNER_A,
      createdEpoch: LEASE_A.epoch,
      blob: new Blob(['keep']),
    });
    await expect(deletePhoto(ID_4, LEASE_A))
      .rejects.toMatchObject({ code: 'OFFLINE_LEASE_STALE' });
    expect(fake.stores.get(STORES.PHOTOS).has(ID_4)).toBe(true);
    fake.setAfterGet(null);
  });

  it('aborts writes when the lease changes after a request but before commit', async () => {
    fake.setAfterMutation(() => {
      leaseState.current = LEASE_A_NEW;
    });
    await expect(savePhotoBlob(
      ID_1,
      { blob: new Blob(['rollback']) },
      LEASE_A,
    )).rejects.toMatchObject({ code: 'OFFLINE_LEASE_STALE' });
    expect(fake.stores.get(STORES.PHOTOS).has(ID_1)).toBe(false);

    fake.setAfterMutation(null);
    for (const clientId of [ID_3, ID_4]) {
      seed(STORES.QUEUE, {
        clientId,
        operationId: clientId,
        owner: OWNER_A,
        status: 'done',
        type: 'reading.insert',
      });
    }
    leaseState.current = LEASE_A;
    fake.setAfterMutation(({ action }) => {
      if (action === 'clear') leaseState.current = LEASE_A_NEW;
    });
    await expect(discardAllOfflineData(LEASE_A, {
      confirmation: OFFLINE_DATA_DISCARD_CONFIRMATION,
    })).rejects.toMatchObject({ code: 'OFFLINE_LEASE_STALE' });
    expect(fake.stores.get(STORES.QUEUE).has(ID_3)).toBe(true);
    expect(fake.stores.get(STORES.QUEUE).has(ID_4)).toBe(true);
    fake.setAfterMutation(null);
  });

  it('keeps historical A work quarantined after A logs in again', async () => {
    seed(STORES.QUEUE, {
      clientId: ID_5,
      operationId: ID_5,
      owner: OWNER_A,
      createdEpoch: LEASE_A.epoch,
      status: 'pending',
      type: 'equipment.place',
      retryBlocked: false,
    });
    leaseState.current = LEASE_A_NEW;
    await expect(claimQueueItem(
      ID_5,
      LEASE_A,
      'c1.old-epoch',
    )).rejects.toMatchObject({ code: 'OFFLINE_LEASE_STALE' });
    await expect(claimQueueItem(
      ID_5,
      LEASE_A_NEW,
      'c1.new-epoch',
      { now: 10, ttlMs: 100 },
    )).resolves.toBe(null);
    expect(fake.stores.get(STORES.QUEUE).get(ID_5)).toMatchObject({
      owner: OWNER_A,
      status: 'pending',
      createdEpoch: LEASE_A.epoch,
    });
  });

  it('quarantines v1 work until an explicit payload-free all-store discard', async () => {
    leaseState.current = LEASE_A;
    seed(STORES.QUEUE, {
      clientId: 'legacy-v1',
      status: 'pending',
      payload: { private: 'never inspected' },
    });
    seed(STORES.PHOTOS, {
      clientId: ID_1,
      owner: OWNER_B,
      blob: new Blob(['foreign']),
    });
    seed(STORES.ROOMS, {
      clientId: ID_2,
      owner: OWNER_A,
      createdEpoch: LEASE_A.epoch,
    });
    seed(STORES.PHOTOS, {
      clientId: ID_3,
      owner: OWNER_A,
      createdEpoch: LEASE_A.epoch,
      blob: new Blob(['orphan-before-enqueue']),
    });
    const ownership = await inspectOfflineOwnership(OWNER_A);
    expect(ownership).toMatchObject({
      ready: true,
      quarantined: true,
      rolloutReady: false,
      legacyRecoveryRequired: true,
      unsupportedRecoveryRequired: true,
      orphanPhotoOwned: 1,
      stores: {
        photos: {
          orphanedOwned: 1,
          unsupportedOwned: 1,
        },
      },
      rolloutGate: {
        code: 'OFFLINE_LEGACY_BRIDGE_REQUIRED',
        blocking: true,
        preservationProven: false,
        destructiveCleanupAvailable: true,
      },
    });
    expect(JSON.stringify(ownership)).not.toContain('never inspected');
    await expect(discardAllOfflineData(LEASE_A))
      .rejects.toThrow(/explicit offline data discard confirmation/i);
    expect(fake.stores.get(STORES.QUEUE).has('legacy-v1')).toBe(true);

    await expect(discardAllOfflineData(LEASE_A, {
      confirmation: OFFLINE_DATA_DISCARD_CONFIRMATION,
    })).resolves.toEqual({ cleared: true });
    for (const store of fake.stores.values()) expect(store.size).toBe(0);
    expect(fake.reads.full.size).toBe(0);
  });

  it('cleans earlier completed photos without dispatch and bounds failed retries', async () => {
    leaseState.current = LEASE_A;
    seed(STORES.QUEUE, {
      clientId: ID_1,
      operationId: ID_1,
      owner: OWNER_A,
      status: 'done',
      type: 'photo.upload',
      cleanupCompletedAt: null,
    });
    seed(STORES.PHOTOS, {
      clientId: ID_1,
      owner: OWNER_A,
      createdEpoch: LEASE_A.epoch,
      blob: new Blob(['owned']),
    });
    seed(STORES.QUEUE, {
      clientId: ID_2,
      operationId: ID_2,
      owner: OWNER_A,
      status: 'done',
      type: 'photo.upload',
      cleanupCompletedAt: null,
    });
    seed(STORES.PHOTOS, {
      clientId: ID_2,
      owner: OWNER_B,
      createdEpoch: LEASE_B.epoch,
      blob: new Blob(['foreign']),
    });
    seed(STORES.QUEUE, {
      clientId: ID_3,
      operationId: ID_3,
      owner: OWNER_A,
      status: 'done',
      type: 'photo.upload',
      cleanupCompletedAt: 500,
    });

    await expect(retryFailedPhotoCleanup(LEASE_A, {
      now: 1_000,
      limit: 3,
      maxRetries: 2,
    })).resolves.toEqual({
      attempted: 3,
      cleaned: 2,
      failed: 1,
      exhausted: 0,
    });
    expect(fake.stores.get(STORES.QUEUE).has(ID_1)).toBe(false);
    expect(fake.stores.get(STORES.PHOTOS).has(ID_1)).toBe(false);
    expect(fake.stores.get(STORES.QUEUE).has(ID_3)).toBe(false);
    expect(fake.stores.get(STORES.PHOTOS).get(ID_2)?.owner).toBe(OWNER_B);
    expect(fake.stores.get(STORES.QUEUE).get(ID_2)).toMatchObject({
      photoCleanupRetryCount: 1,
      photoCleanupExhausted: false,
      photoCleanupError: 'Owned local photo cleanup failed',
    });

    await expect(retryFailedPhotoCleanup(LEASE_A, {
      now: 10_000,
      limit: 2,
      maxRetries: 2,
    })).resolves.toMatchObject({
      attempted: 1,
      failed: 1,
      exhausted: 1,
    });
    expect(fake.stores.get(STORES.QUEUE).get(ID_2)).toMatchObject({
      photoCleanupRetryCount: 2,
      photoCleanupExhausted: true,
    });

    for (let index = 100; index < 150; index += 1) {
      seed(STORES.QUEUE, {
        clientId: fixtureId(index),
        operationId: fixtureId(index),
        owner: OWNER_A,
        status: 'done',
        type: 'photo.upload',
        photoCleanupExhausted: true,
      });
    }
    const beyondFirstWindow = fixtureId(150);
    seed(STORES.QUEUE, {
      clientId: beyondFirstWindow,
      operationId: beyondFirstWindow,
      owner: OWNER_A,
      status: 'done',
      type: 'photo.upload',
    });
    seed(STORES.PHOTOS, {
      clientId: beyondFirstWindow,
      owner: OWNER_A,
      blob: new Blob(['eligible-after-exhausted-window']),
    });
    await expect(retryFailedPhotoCleanup(LEASE_A, {
      now: 51 * 30_000,
      limit: 1,
    })).resolves.toMatchObject({
      attempted: 1,
      cleaned: 1,
    });
    expect(fake.stores.get(STORES.QUEUE).has(beyondFirstWindow)).toBe(false);
    expect(fake.stores.get(STORES.PHOTOS).has(beyondFirstWindow)).toBe(false);
  });
});
