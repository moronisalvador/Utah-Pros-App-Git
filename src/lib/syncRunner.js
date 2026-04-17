// Sync runner — drains the offline queue and dispatches each item to the correct handler.
// One instance per page load (see `syncRunnerSingleton.js`). Exposes a tiny event emitter
// so hooks can subscribe to queue changes without a React context.

import {
  listQueue,
  updateQueueStatus,
  queueCounts,
} from './offlineDb';
import { dispatchRoom } from './dispatchers/roomDispatcher';
import { dispatchPhoto } from './dispatchers/photoDispatcher';

const MAX_RETRIES = 5;
const POLL_MS = 30_000;
// Backoff schedule for retries (1s, 4s, 15s, 1m, 5m). Past 5 tries we mark as error.
const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000, 300_000];

/**
 * Build a new sync runner.
 * @param {{db:object, employee:object}} deps
 */
export function createSyncRunner({ db, employee }) {
  const listeners = new Map(); // event -> Set<cb>
  let draining = false;
  let pollTimer = null;
  let onlineHandler = null;
  let visibilityHandler = null;
  let started = false;

  const emit = (event, detail) => {
    const set = listeners.get(event);
    if (!set) return;
    set.forEach(cb => {
      try { cb(detail); } catch (err) { console.error(`[syncRunner] listener for ${event} threw`, err); }
    });
  };

  const on = (event, cb) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => listeners.get(event)?.delete(cb);
  };

  const dispatchFor = async (item) => {
    switch (item.type) {
      case 'room.create':
        return dispatchRoom(db, employee, item.payload);
      case 'photo.upload':
        return dispatchPhoto(db, employee, item.payload, item);
      // Phase 2 types — placeholders so the switch doesn't throw once they're wired in.
      case 'reading.insert':
      case 'equipment.place':
      case 'equipment.remove':
        throw new Error(`Dispatcher for ${item.type} not implemented yet`);
      default:
        throw new Error(`Unknown queue item type: ${item.type}`);
    }
  };

  const drainOnce = async () => {
    if (draining) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (!db || !employee?.id) return;

    draining = true;
    emit('sync:started');
    try {
      const pending = await listQueue('pending');
      const now = Date.now();
      // Honor backoff — skip items whose retryAt is still in the future.
      const ready = pending.filter(p => !p.retryAt || p.retryAt <= now);

      for (const item of ready) {
        await updateQueueStatus(item.clientId, 'syncing');
        emit('queue:changed', await queueCounts());
        try {
          const result = await dispatchFor(item);
          await updateQueueStatus(item.clientId, 'done', {
            error: null,
            serverId: result?.serverId,
          });
          emit('sync:item-done', { item, result });
        } catch (err) {
          const retryCount = (item.retryCount || 0) + 1;
          if (retryCount >= MAX_RETRIES) {
            await updateQueueStatus(item.clientId, 'error', {
              error: String(err?.message || err),
              retryCount,
            });
            emit('sync:item-error', { item, error: err });
          } else {
            const backoff = BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)];
            await updateQueueStatus(item.clientId, 'pending', {
              error: String(err?.message || err),
              retryCount,
              retryAt: Date.now() + backoff,
            });
          }
        }
        emit('queue:changed', await queueCounts());
      }
    } catch (err) {
      console.error('[syncRunner] drain error', err);
    } finally {
      draining = false;
      emit('sync:idle', await queueCounts().catch(() => null));
    }
  };

  const tick = async () => {
    const counts = await queueCounts().catch(() => ({ pending: 0 }));
    if (counts.pending > 0) drainOnce();
  };

  const start = () => {
    if (started) return;
    started = true;

    onlineHandler = () => drainOnce();
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') drainOnce();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', onlineHandler);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', visibilityHandler);
    }
    pollTimer = setInterval(tick, POLL_MS);

    // Kick one drain on boot so anything queued in a previous session gets picked up.
    drainOnce();
  };

  const stop = () => {
    if (!started) return;
    started = false;
    if (onlineHandler && typeof window !== 'undefined') window.removeEventListener('online', onlineHandler);
    if (visibilityHandler && typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityHandler);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  return { start, stop, drainOnce, on };
}
