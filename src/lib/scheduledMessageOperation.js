/**
 * ════════════════════════════════════════════════
 * FILE: scheduledMessageOperation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps one stable request id for the same scheduled-text payload so a lost
 *   database response can be retried without creating a second scheduled row.
 *
 * DEPENDS ON:
 *   Packages: none
 *   Internal: src/lib/resumeRestore.js (account/epoch-owned durable key)
 *   Data:     reads/writes → one opaque owner-scoped localStorage key per
 *             unresolved operation; the caller also owns an in-memory Map
 *
 * EXPORTS:
 *   getScheduledMessageOperation(map, payload, createId)
 *   clearScheduledMessageOperation(map, operation)
 *
 * NOTES / GOTCHAS:
 *   - The id is cleared only after the server confirms success. A failed or
 *     ambiguous response deliberately retains it across a Capacitor WebView
 *     restart for the next identical retry.
 *   - A changed conversation, body, send time, or signed-in owner lease creates
 *     a different operation. A still-mounted screen must never reuse account
 *     A's UUID after the device changes to account B.
 * ════════════════════════════════════════════════
 */

import {
  isPwaOwnerLeaseCurrent,
  ownedDraftStorageKey,
} from './resumeRestore.js';

function browserStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

// Two independent 32-bit hashes keep message text out of the durable key. A
// collision can only cause the server RPC to reject a mismatched payload; it
// cannot silently create or submit the wrong schedule.
function hashPayload(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function operationKey({ conversationId, body, sendAt }) {
  const payload = JSON.stringify([conversationId, body, sendAt]);
  return `${hashPayload(payload, 0x811c9dc5)}${hashPayload(payload, 0x9e3779b9)}`;
}

export function getScheduledMessageOperation(
  operations,
  payload,
  {
    createId = () => crypto.randomUUID(),
    ownerLease = null,
    storage,
  } = {},
) {
  const key = operationKey(payload);
  const resolvedStorage = storage === undefined && ownerLease
    ? browserStorage()
    : storage || null;
  const storageKey = ownedDraftStorageKey(
    ownerLease,
    'scheduled-message-operation',
    key,
  );
  // Use the same opaque owner+epoch namespace for the volatile map as the
  // durable key. Checking the current device lease before reuse prevents a
  // mounted Capacitor view from carrying an old account's id through logout or
  // an account switch. The unowned fallback keeps the existing web behaviour
  // for callers that intentionally have no PWA lease.
  const ownerLeaseCurrent = !ownerLease
    || isPwaOwnerLeaseCurrent(ownerLease, resolvedStorage);
  const mapKey = storageKey || key;
  const existingId = ownerLeaseCurrent ? operations.get(mapKey) : null;
  if (existingId) return { key, mapKey, id: existingId, storageKey };

  if (storageKey && ownerLeaseCurrent) {
    try {
      const durableId = resolvedStorage?.getItem(storageKey);
      if (durableId) {
        operations.set(mapKey, durableId);
        return { key, mapKey, id: durableId, storageKey };
      }
    } catch {
      // Continue with the in-memory safety boundary when storage is unavailable.
    }
  }

  const id = createId();
  if (ownerLeaseCurrent) operations.set(mapKey, id);
  if (storageKey && ownerLeaseCurrent) {
    try {
      resolvedStorage?.setItem(storageKey, id);
      if (!isPwaOwnerLeaseCurrent(ownerLease, resolvedStorage)) {
        resolvedStorage?.removeItem(storageKey);
      }
    } catch {
      // In-memory idempotency still protects same-session retries.
    }
  }

  // Session-only retry memory is intentionally small. Confirmed operations are
  // removed immediately; this cap bounds abandoned invalid/denied attempts.
  while (operations.size > 20) {
    operations.delete(operations.keys().next().value);
  }

  return { key, mapKey, id, storageKey };
}

export function clearScheduledMessageOperation(
  operations,
  operation,
  { storage } = {},
) {
  if (operation?.mapKey || operation?.key) {
    operations.delete(operation.mapKey || operation.key);
  }
  if (operation?.storageKey) {
    const resolvedStorage = storage === undefined ? browserStorage() : storage;
    try {
      resolvedStorage?.removeItem(operation.storageKey);
    } catch {
      // The confirmed server result is authoritative; storage cleanup retries
      // naturally on logout/account-change namespace sweeping.
    }
  }
}
