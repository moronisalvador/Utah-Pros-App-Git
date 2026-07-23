/**
 * ════════════════════════════════════════════════
 * FILE: process-message-notification-outbox.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Delivers saved alerts for inbound customer messages. Only the protected
 *   scheduler may run it, and every run records whether work succeeded or
 *   needs attention.
 *
 * ENDPOINT:
 *   POST /api/process-message-notification-outbox
 *
 * DEPENDS ON:
 *   Internal:  ../lib/auth.js, ../lib/message-notification-outbox.js,
 *              ../lib/supabase.js, ../lib/worker-runs.js, ./notify.js
 *   Data:      reads/writes → message_notification_outbox; reads →
 *              integration_config and notification data; writes → worker_runs
 *
 * NOTES / GOTCHAS:
 *   - The route is inert until MESSAGING_SCHEMA_MODE=foundation.
 *   - This worker never sends a customer message; it only dispatches internal
 *     staff notifications already committed to the outbox.
 * ════════════════════════════════════════════════
 */

import { checkCronSecret } from '../lib/auth.js';
import { processMessageNotificationOutbox } from '../lib/message-notification-outbox.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';
import { dispatchEvent } from './notify.js';

const WORKER_NAME = 'process-message-notification-outbox';

function response(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function run(db, env) {
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await processMessageNotificationOutbox(db, env, {
      dispatchImpl: dispatchEvent,
    });
  } catch (error) {
    result = {
      success: false,
      delivered: 0,
      retryable: 0,
      deadLettered: 0,
      error: error.message || 'Notification outbox processing failed',
    };
  }
  await recordWorkerRun(db, {
    workerName: WORKER_NAME,
    status: result.success ? 'completed' : 'error',
    recordsProcessed: result.delivered,
    errorMessage: result.error ||
      (result.retryable || result.deadLettered
        ? `${result.retryable || 0} retryable, ${result.deadLettered || 0} dead-lettered`
        : null),
    startedAt,
    meta: {
      claimed: result.claimed || 0,
      retryable: result.retryable || 0,
      dead_lettered: result.deadLettered || 0,
    },
  });
  return result;
}

export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  if (!(await checkCronSecret(request, db))) {
    return response({ error: 'Unauthorized' }, 401);
  }
  const result = await run(db, env);
  return response(result, result.success ? 200 : 500);
}

export async function scheduled(event, env) {
  return run(supabase(env), env);
}
