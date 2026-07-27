/**
 * ════════════════════════════════════════════════
 * FILE: techQueryPersister.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves cached screen data is saved and restored only for one verified
 *   account/login epoch. It also reproduces a late cross-tab write and proves
 *   that stale completion removes only its own old key.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  techQueryPersister, resumeRestore
 *   Data:      none (in-memory fakes only)
 * ════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  PWA_ACCOUNT_EPOCH_KEY,
  PWA_ACCOUNT_OWNER_KEY,
} from './resumeRestore.js';
import {
  TECH_QUERY_PERSIST_KEY,
  activateTechQueryPersistence,
  clearPersistedTechQueries,
  createTechQueryPersister,
  restorePersistedTechQueries,
  suspendTechQueryPersistence,
  techQueryPersistKey,
  techQueryPersister,
} from './techQueryPersister.js';

const OWNER_A = 'v1.aaaaaaaaaaaa';
const OWNER_B = 'v1.bbbbbbbbbbbb';
const LEASE_A = { owner: OWNER_A, epoch: 'e1.session-a' };
const LEASE_B = { owner: OWNER_B, epoch: 'e1.session-b' };

function localStore(lease = null) {
  const values = new Map();
  if (lease) {
    values.set(PWA_ACCOUNT_OWNER_KEY, lease.owner);
    values.set(PWA_ACCOUNT_EPOCH_KEY, lease.epoch);
  }
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function asyncStore() {
  const values = new Map();
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async (key) => { values.delete(key); },
  };
}

const CLIENT = {
  timestamp: 123,
  buster: 'compat-a',
  clientState: { mutations: [], queries: [{ queryKey: ['tech', 'jobs'] }] },
};

afterEach(() => {
  suspendTechQueryPersistence();
});

describe('owner-bound tech query persistence', () => {
  it('binds both the storage key and serialized envelope to one lease', async () => {
    const ownerStorage = localStore(LEASE_A);
    const storage = asyncStore();
    const persister = createTechQueryPersister(LEASE_A, {
      storage,
      ownerStorage,
      throttleTime: 0,
    });

    await persister.persistClient(CLIENT);
    expect(persister.key).toBe(techQueryPersistKey(LEASE_A));
    expect(persister.key).not.toBe(techQueryPersistKey(LEASE_B));
    const raw = JSON.parse(storage.values.get(persister.key));
    expect(raw).toMatchObject({
      owner: OWNER_A,
      epoch: LEASE_A.epoch,
      client: CLIENT,
    });
    expect(await persister.restoreClient()).toEqual(CLIENT);
  });

  it('refuses a mismatched envelope even under the expected key', async () => {
    const ownerStorage = localStore(LEASE_A);
    const storage = asyncStore();
    const key = techQueryPersistKey(LEASE_A);
    storage.values.set(key, JSON.stringify({
      version: 1,
      owner: OWNER_B,
      epoch: LEASE_B.epoch,
      client: CLIENT,
    }));
    const persister = createTechQueryPersister(LEASE_A, {
      storage,
      ownerStorage,
      throttleTime: 0,
    });

    expect(await persister.restoreClient()).toBeUndefined();
    expect(storage.values.has(key)).toBe(false);
  });

  it('removes a stale A write that completes after tab B becomes current', async () => {
    const ownerStorage = localStore(LEASE_A);
    const values = new Map();
    let releaseWrite;
    let announceWrite;
    const writeStarted = new Promise((resolve) => { announceWrite = resolve; });
    const writeReleased = new Promise((resolve) => { releaseWrite = resolve; });
    const storage = {
      values,
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        announceWrite();
        await writeReleased;
        values.set(key, value);
      },
      removeItem: async (key) => { values.delete(key); },
    };
    const persister = createTechQueryPersister(LEASE_A, {
      storage,
      ownerStorage,
      throttleTime: 0,
    });

    const pending = persister.persistClient(CLIENT);
    await writeStarted;
    ownerStorage.setItem(PWA_ACCOUNT_EPOCH_KEY, LEASE_B.epoch);
    ownerStorage.setItem(PWA_ACCOUNT_OWNER_KEY, LEASE_B.owner);
    releaseWrite();
    await pending;

    expect(values.has(techQueryPersistKey(LEASE_A))).toBe(false);
    expect(values.has(techQueryPersistKey(LEASE_B))).toBe(false);
  });

  it('refuses a slow A restore whose IndexedDB read finishes after B takes ownership', async () => {
    const ownerStorage = localStore(LEASE_A);
    const values = new Map();
    let releaseRead;
    let announceRead;
    const readStarted = new Promise((resolve) => { announceRead = resolve; });
    const readReleased = new Promise((resolve) => { releaseRead = resolve; });
    const storage = {
      values,
      getItem: async (key) => {
        announceRead();
        await readReleased;
        return values.get(key) ?? null;
      },
      setItem: async (key, value) => { values.set(key, value); },
      removeItem: async (key) => { values.delete(key); },
    };
    const persister = createTechQueryPersister(LEASE_A, {
      storage,
      ownerStorage,
      throttleTime: 0,
    });
    await persister.persistClient(CLIENT);

    const pending = persister.restoreClient();
    await readStarted;
    ownerStorage.setItem(PWA_ACCOUNT_EPOCH_KEY, LEASE_B.epoch);
    ownerStorage.setItem(PWA_ACCOUNT_OWNER_KEY, LEASE_B.owner);
    releaseRead();

    expect(await pending).toBeUndefined();
  });

  it('removes hydrated A data when ownership changes during hydration', async () => {
    const ownerStorage = localStore(LEASE_A);
    const storage = asyncStore();
    const key = techQueryPersistKey(LEASE_A);
    const now = Date.now();
    storage.values.set(key, JSON.stringify({
      version: 1,
      owner: LEASE_A.owner,
      epoch: LEASE_A.epoch,
      client: {
        timestamp: now,
        buster: 'compat-a',
        clientState: {
          mutations: [],
          queries: [{
            queryHash: 'tech-jobs',
            queryKey: ['tech', 'jobs'],
            state: {
              data: [{ id: 'job-a' }],
              dataUpdatedAt: now,
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              fetchStatus: 'idle',
              isInvalidated: false,
              status: 'success',
            },
          }],
        },
      },
    }));
    const queryClient = new QueryClient();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'added') return;
      ownerStorage.setItem(PWA_ACCOUNT_EPOCH_KEY, LEASE_B.epoch);
      ownerStorage.setItem(PWA_ACCOUNT_OWNER_KEY, LEASE_B.owner);
    });

    const restored = await restorePersistedTechQueries(
      queryClient,
      LEASE_A,
      {
        storage,
        ownerStorage,
        throttleTime: 0,
        buster: 'compat-a',
      },
    );
    unsubscribe();

    expect(restored).toBe(false);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('keeps the static provider adapter locked until an owner is activated', async () => {
    const ownerStorage = localStore(LEASE_A);
    const storage = asyncStore();
    suspendTechQueryPersistence();
    await techQueryPersister.persistClient(CLIENT);
    expect(storage.values.size).toBe(0);

    expect(activateTechQueryPersistence(LEASE_A, {
      storage,
      ownerStorage,
      throttleTime: 0,
    })).toBe(true);
    await techQueryPersister.persistClient(CLIENT);
    expect(storage.values.has(techQueryPersistKey(LEASE_A))).toBe(true);
  });

  it('clears only the exact prior epoch and the legacy device-global key', async () => {
    const storage = asyncStore();
    storage.values.set(TECH_QUERY_PERSIST_KEY, 'legacy');
    storage.values.set(techQueryPersistKey(LEASE_A), 'a');
    storage.values.set(techQueryPersistKey(LEASE_B), 'b');

    await clearPersistedTechQueries(LEASE_A, { storage });

    expect(storage.values.has(TECH_QUERY_PERSIST_KEY)).toBe(false);
    expect(storage.values.has(techQueryPersistKey(LEASE_A))).toBe(false);
    expect(storage.values.get(techQueryPersistKey(LEASE_B))).toBe('b');
  });
});
