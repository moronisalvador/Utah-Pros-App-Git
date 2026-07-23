/**
 * ════════════════════════════════════════════════
 * FILE: recover-message-send-attempts.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Repairs the narrow crash window where a provider accepted an outbound
 *   message and the durable attempt captured its provider message ID, but the
 *   canonical UPR message row was not materialized. Recovery is provider
 *   neutral and database-only: this worker never submits or retries a provider
 *   request.
 *
 * ENDPOINT:
 *   POST /api/recover-message-send-attempts (shared cron secret required)
 *
 * DEPENDS ON:
 *   Internal: ../lib/auth.js, ../lib/supabase.js, ../lib/worker-runs.js
 *   Data: reads → message_send_attempts
 *         executes → materialize_message_send_attempt(uuid), service-role only
 *         writes → worker_runs (best effort)
 *
 * NOTES / GOTCHAS:
 *   - Inert unless MESSAGING_SCHEMA_MODE=foundation.
 *   - The RPC owns locking, validation, canonical insertion, and attempt linking.
 *   - No provider adapter is imported here by design.
 * ════════════════════════════════════════════════
 */

import { checkCronSecret } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const WORKER_NAME = 'recover-message-send-attempts';
const BATCH_LIMIT = 50;

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

export async function recoverMessageSendAttempts(db, env) {
  if (env.MESSAGING_SCHEMA_MODE !== 'foundation') {
    return {
      success: false,
      recovered: 0,
      replayed: 0,
      failed: 0,
      scanned: 0,
      error: 'MESSAGING_SCHEMA_NOT_READY',
    };
  }

  const attempts = await db.select(
    'message_send_attempts',
    'provider_message_id=not.is.null&message_id=is.null' +
      '&state=in.(accepted,ambiguous,confirmed)&order=response_at.asc.nullslast,created_at.asc' +
      `&select=id&limit=${BATCH_LIMIT}`,
  );
  let recovered = 0;
  let replayed = 0;
  let failed = 0;

  for (const attempt of attempts) {
    try {
      const projection = firstRow(await db.rpc('materialize_message_send_attempt', {
        p_attempt_id: attempt.id,
      }));
      if (!projection?.outcome || !projection?.message_id) {
        throw new Error('Materialization RPC returned no canonical message');
      }
      if (projection.outcome === 'message_materialized') recovered += 1;
      else replayed += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    success: failed === 0,
    recovered,
    replayed,
    failed,
    scanned: attempts.length,
  };
}

async function runAndRecord(db, env) {
  const startedAt = new Date().toISOString();
  const result = await recoverMessageSendAttempts(db, env);
  await recordWorkerRun(db, {
    workerName: WORKER_NAME,
    status: result.success ? 'completed' : 'error',
    recordsProcessed: result.recovered,
    errorMessage: result.error || (result.failed ? `${result.failed} attempt(s) failed` : null),
    startedAt,
    meta: {
      scanned: result.scanned,
      replayed: result.replayed,
      failed: result.failed,
    },
  });
  return result;
}

export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  if (!(await checkCronSecret(request, db))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await runAndRecord(db, env);
  return Response.json(result, { status: result.success ? 200 : 503 });
}

export async function scheduled(event, env) {
  await runAndRecord(supabase(env), env);
}
