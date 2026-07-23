/**
 * Reconciles due ambiguous CallRail attempts by reading provider history.
 *
 * This route is inert outside foundation schema mode, requires the shared cron
 * secret over HTTP, and never submits or retries a provider message.
 */

import { checkCronSecret } from '../lib/auth.js';
import {
  findCallrailAttemptOutcome,
  resolveCallrailReconcileConfig,
} from '../lib/callrail-reconcile.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const WORKER_NAME = 'reconcile-callrail-messages';
const BATCH_LIMIT = 20;
const RETRY_DELAY_MS = 5 * 60 * 1000;

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function applyOutcome(db, attempt, message, outcome) {
  const dedupeKey = `callrail:reconcile:${outcome.providerConversationId}:${outcome.providerMessageId}`;
  const rawBodyHash = await sha256(JSON.stringify({
    provider: 'callrail',
    conversationId: outcome.providerConversationId,
    messageId: outcome.providerMessageId,
    status: outcome.providerStatus,
    occurredAt: outcome.occurredAt,
  }));
  const rows = await db.rpc('project_callrail_reconcile_outcome', {
    p_attempt_id: attempt.id,
    p_message_id: message?.id || null,
    p_provider_message_id: outcome.providerMessageId,
    p_provider_conversation_id: outcome.providerConversationId,
    p_company_resource_id: outcome.companyResourceId,
    p_sender_address: outcome.senderAddress,
    p_recipient_address: outcome.recipientAddress,
    p_provider_status: outcome.providerStatus,
    p_occurred_at: outcome.occurredAt,
    p_raw_body_hash: rawBodyHash,
    p_dedupe_key: dedupeKey,
    p_confirmed: outcome.confirmed,
  });
  return rows === true || rows?.[0] === true;
}

export async function reconcileDueCallrailMessages(db, env, { now = new Date() } = {}) {
  if (env.MESSAGING_SCHEMA_MODE !== 'foundation') {
    return { success: false, reconciled: 0, error: 'MESSAGING_SCHEMA_NOT_READY' };
  }

  let config;
  try {
    config = await resolveCallrailReconcileConfig(env, db);
  } catch (error) {
    return { success: false, reconciled: 0, error: error.code || 'CALLRAIL_NOT_CONFIGURED' };
  }

  const attempts = await db.select(
    'message_send_attempts',
    `provider=eq.callrail&state=in.(accepted,ambiguous)&reconcile_after=lte.${encodeURIComponent(now.toISOString())}&order=reconcile_after.asc&limit=${BATCH_LIMIT}`,
  );
  let reconciled = 0;
  let failed = 0;
  let deferred = 0;
  for (const attempt of attempts) {
    const [message] = attempt.message_id
      ? await db.select(
        'messages',
        `id=eq.${encodeURIComponent(attempt.message_id)}&provider=eq.callrail&select=id,provider,recipient_address,body&limit=1`,
      )
      : [];
    try {
      const outcome = await findCallrailAttemptOutcome({
        attempt,
        message,
        config,
        now,
      });
      const applied = await applyOutcome(db, attempt, message, outcome);
      if (applied) reconciled += 1;
    } catch (error) {
      const retryable = error.retryable === true;
      await db.update('message_send_attempts', `id=eq.${attempt.id}&state=in.(accepted,ambiguous)`, {
        reconcile_after: retryable
          ? new Date(now.getTime() + RETRY_DELAY_MS).toISOString()
          : null,
        error_code: error.code || 'CALLRAIL_RECONCILE_FAILED',
        error_message: String(error.message || error).slice(0, 500),
        updated_at: now.toISOString(),
      });
      if (retryable) deferred += 1;
      else failed += 1;
    }
  }
  return {
    success: failed === 0,
    reconciled,
    deferred,
    failed,
    scanned: attempts.length,
  };
}

async function runAndRecord(db, env) {
  const startedAt = new Date().toISOString();
  const result = await reconcileDueCallrailMessages(db, env);
  await recordWorkerRun(db, {
    workerName: WORKER_NAME,
    status: result.success ? 'completed' : 'error',
    recordsProcessed: result.reconciled,
    errorMessage: result.error || (result.failed ? `${result.failed} attempt(s) blocked` : null),
    startedAt,
    meta: {
      scanned: result.scanned || 0,
      deferred: result.deferred || 0,
      failed: result.failed || 0,
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
