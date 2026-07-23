/**
 * ════════════════════════════════════════════════
 * FILE: message-notification-outbox.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Delivers notifications that were saved alongside an inbound message. It
 *   safely reserves a small batch, retries temporary failures, and moves a
 *   repeatedly failing item aside so one bad alert cannot block the queue.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none. The route supplies the notification dispatcher.
 *   Data:      reads/writes → message_notification_outbox through one claim
 *              function and narrow state updates
 *
 * NOTES / GOTCHAS:
 *   - The database claim function is the concurrency boundary. Its claim token
 *     fences a slow worker from finishing a row that a later worker reclaimed.
 *   - A disabled notification type is a successful no-op. An unknown type is
 *     retried because it usually means deployment/configuration order drift.
 * ════════════════════════════════════════════════
 */

const DEFAULT_BATCH_LIMIT = 20;
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function asPayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Invalid persisted payload is handled as a permanent row failure below.
    }
  }
  return null;
}

function claimFilter(row) {
  return `id=eq.${encodeURIComponent(row.id)}` +
    `&delivery_state=eq.processing&claim_token=eq.${encodeURIComponent(row.claim_token)}`;
}

function failurePatch(row, error, now) {
  const attempts = Number(row.delivery_attempts) || 0;
  const permanent = error?.permanent === true;
  const deadLetter = permanent || attempts >= MAX_ATTEMPTS;
  const common = {
    delivery_state: deadLetter ? 'dead_letter' : 'retryable',
    last_error: String(error?.message || error || 'Notification dispatch failed').slice(0, 500),
    claimed_at: null,
    claim_token: null,
    updated_at: now.toISOString(),
  };
  if (deadLetter) {
    return {
      ...common,
      next_attempt_at: null,
      failed_at: now.toISOString(),
    };
  }
  const delay = RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)];
  return {
    ...common,
    next_attempt_at: new Date(now.getTime() + delay).toISOString(),
    failed_at: null,
  };
}

async function dispatchRow(db, env, row, now, dispatchImpl) {
  const payload = asPayload(row.payload);
  if (!row.type_key || !payload) {
    const error = Object.assign(new Error('Invalid notification outbox payload'), {
      permanent: true,
    });
    await db.update('message_notification_outbox', claimFilter(row), failurePatch(row, error, now));
    return { deadLettered: true };
  }

  try {
    const result = await dispatchImpl({
      db,
      env,
      typeKey: row.type_key,
      body: payload,
    });
    if (result?.skipped && ['unknown_type', 'no_type_key'].includes(result.reason)) {
      throw new Error(`Notification dispatcher skipped row: ${result.reason}`);
    }
    await db.update('message_notification_outbox', claimFilter(row), {
      delivery_state: 'delivered',
      delivered_at: now.toISOString(),
      next_attempt_at: null,
      last_error: null,
      claimed_at: null,
      claim_token: null,
      updated_at: now.toISOString(),
    });
    return { delivered: true };
  } catch (error) {
    const patch = failurePatch(row, error, now);
    await db.update('message_notification_outbox', claimFilter(row), patch);
    return patch.delivery_state === 'dead_letter'
      ? { deadLettered: true }
      : { retryable: true };
  }
}

export async function processMessageNotificationOutbox(db, env, {
  now = new Date(),
  batchLimit = DEFAULT_BATCH_LIMIT,
  claimToken = crypto.randomUUID(),
  dispatchImpl,
} = {}) {
  if (env.MESSAGING_SCHEMA_MODE !== 'foundation') {
    return {
      success: false,
      delivered: 0,
      retryable: 0,
      deadLettered: 0,
      error: 'MESSAGING_SCHEMA_NOT_READY',
    };
  }
  if (typeof dispatchImpl !== 'function') {
    throw new Error('Notification dispatcher is required');
  }

  const claimed = await db.rpc('claim_message_notification_outbox', {
    p_limit: Math.min(Math.max(Number(batchLimit) || DEFAULT_BATCH_LIMIT, 1), 100),
    p_now: now.toISOString(),
    p_stale_before: new Date(now.getTime() - LEASE_MS).toISOString(),
    p_claim_token: claimToken,
  });

  let delivered = 0;
  let retryable = 0;
  let deadLettered = 0;
  for (const row of claimed || []) {
    const result = await dispatchRow(db, env, row, now, dispatchImpl);
    if (result.delivered) delivered += 1;
    else if (result.retryable) retryable += 1;
    else deadLettered += 1;
  }
  return {
    success: retryable === 0 && deadLettered === 0,
    delivered,
    retryable,
    deadLettered,
    claimed: (claimed || []).length,
  };
}

export const MESSAGE_NOTIFICATION_OUTBOX_LIMITS = Object.freeze({
  batchLimit: DEFAULT_BATCH_LIMIT,
  leaseMs: LEASE_MS,
  maxAttempts: MAX_ATTEMPTS,
});
