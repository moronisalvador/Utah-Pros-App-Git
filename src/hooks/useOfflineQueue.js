// React hook — lets any component enqueue offline work and read live sync counts.
// Uses `useSyncExternalStore` so multiple components stay in sync without props drilling.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  enqueueItem,
  queueCounts,
  clearDone as clearDoneDb,
  listQueue,
  updateQueueStatus,
} from '@/lib/offlineDb';
import { initSyncRunner, getSyncRunner } from '@/lib/syncRunnerSingleton';

// Module-level state shared across all hook callers. Keeps us from thrashing IDB on every
// render — we only refresh counts when the runner tells us something changed.
const state = {
  pendingCount: 0,
  syncingCount: 0,
  errorCount: 0,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
};

const subscribers = new Set();

function notify() {
  subscribers.forEach(cb => { try { cb(); } catch { /* ignore */ } });
}

async function refreshCounts() {
  try {
    const c = await queueCounts();
    state.pendingCount = c.pending + c.syncing; // "not yet done" from the user's perspective
    state.syncingCount = c.syncing;
    state.errorCount = c.error;
    notify();
  } catch (err) {
    console.error('[useOfflineQueue] refresh failed', err);
  }
}

function updateOnline() {
  const next = typeof navigator !== 'undefined' ? navigator.onLine : true;
  if (next !== state.isOnline) {
    state.isOnline = next;
    notify();
  }
}

// Wire up the runner event bridge once. `wireRunner` is idempotent — safe to call many times.
let wired = false;
function wireRunner(runner) {
  if (wired || !runner) return;
  wired = true;
  runner.on('queue:changed', refreshCounts);
  runner.on('sync:item-done', refreshCounts);
  runner.on('sync:item-error', refreshCounts);
  runner.on('sync:idle', refreshCounts);
  refreshCounts();
}

// Browser online/offline listeners — set up exactly once at module load.
if (typeof window !== 'undefined') {
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
}

function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function getSnapshot() {
  // Return the stable state object. React's `useSyncExternalStore` will only re-render
  // when `notify()` is called AND a shallow compare of any derived value changes.
  return stateSnapshot();
}

// Snapshot the state into a new object reference only when counts actually change.
// Otherwise return the same reference so React bails out of re-renders.
let _lastSnapshot = { ...state };
function stateSnapshot() {
  if (
    _lastSnapshot.pendingCount !== state.pendingCount ||
    _lastSnapshot.syncingCount !== state.syncingCount ||
    _lastSnapshot.errorCount !== state.errorCount ||
    _lastSnapshot.isOnline !== state.isOnline
  ) {
    _lastSnapshot = { ...state };
  }
  return _lastSnapshot;
}

/**
 * Subscribe to the offline queue and get an enqueue helper.
 * @returns {{
 *   enqueue: (item: {type:string, payload:object, clientId?:string}) => Promise<{clientId:string}>,
 *   pendingCount: number,
 *   syncingCount: number,
 *   errorCount: number,
 *   isOnline: boolean,
 *   retryAll: () => Promise<void>,
 *   clearDone: () => Promise<void>,
 * }}
 */
export function useOfflineQueue() {
  const { db, employee } = useAuth();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Lazy-init the singleton runner the first time a component subscribes. We intentionally
    // do NOT stop the runner on unmount — other components may still be using it. Auth changes
    // (login/logout) are detected inside `initSyncRunner` via the `(db, employee.id)` key.
    const runner = initSyncRunner({ db, employee });
    wireRunner(runner);
    hasInitialized.current = true;
  }, [db, employee?.id]);

  const enqueue = useCallback(async (item) => {
    if (!item?.type) throw new Error('enqueue requires { type, payload }');
    const clientId = item.clientId || (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    await enqueueItem({ clientId, type: item.type, payload: item.payload || {} });
    await refreshCounts();
    // Kick a drain immediately — if we're online this item ships right away.
    getSyncRunner()?.drainOnce();
    return { clientId };
  }, []);

  const retryAll = useCallback(async () => {
    const errored = await listQueue('error');
    await Promise.all(errored.map(i => updateQueueStatus(i.clientId, 'pending', {
      retryCount: 0, retryAt: 0, error: null,
    })));
    await refreshCounts();
    getSyncRunner()?.drainOnce();
  }, []);

  const clearDone = useCallback(async () => {
    await clearDoneDb();
    await refreshCounts();
  }, []);

  return {
    enqueue,
    pendingCount: snapshot.pendingCount,
    syncingCount: snapshot.syncingCount,
    errorCount: snapshot.errorCount,
    isOnline: snapshot.isOnline,
    retryAll,
    clearDone,
  };
}
