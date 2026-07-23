/**
 * Recovers retained CallRail SMS events after transient processing failures.
 *
 * No provider send occurs here. MMS remains fail-closed, and this worker is
 * inert until the foundation schema and a scheduler secret are configured.
 */

import { supabase } from '../lib/supabase.js';
import { checkCronSecret } from '../lib/auth.js';
import {
  buildCallrailRetryPatch,
  normalizeStoredCallrailEvent,
  processCallrailTextEvent,
} from '../lib/callrail-message-processor.js';
import { ingestVerifiedCallrailEventMms } from '../lib/callrail-mms.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const WORKER_NAME = 'process-callrail-events';
const BATCH_LIMIT = 20;
const CLAIM_TTL_MS = 5 * 60 * 1000;

async function processRow(db, row, now, env) {
  const staleBefore = new Date(now.getTime() - CLAIM_TTL_MS).toISOString();
  const claimed = await db.update(
    'message_provider_events',
    `id=eq.${row.id}&or=(processing_state.eq.received,and(processing_state.eq.retryable,next_attempt_at.lte.${encodeURIComponent(now.toISOString())}),and(processing_state.eq.claimed,claimed_at.lt.${encodeURIComponent(staleBefore)}))`,
    {
      processing_state: 'claimed',
      processing_attempts: (Number(row.processing_attempts) || 0) + 1,
      claimed_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
  );
  if (!claimed[0]) return { skipped: true };

  try {
    let normalizedEvent = normalizeStoredCallrailEvent(row);
    if (normalizedEvent.messageType === 'mms' && normalizedEvent.ownedMedia.length === 0) {
      try {
        const owned = await ingestVerifiedCallrailEventMms({
          db,
          env,
          event: normalizedEvent,
        });
        normalizedEvent = { ...normalizedEvent, ownedMedia: owned.media };
        await db.update('message_provider_events', `id=eq.${row.id}`, {
          owned_media: owned.media,
          updated_at: new Date().toISOString(),
        });
      } catch (mediaError) {
        await processCallrailTextEvent({
          db,
          event: normalizedEvent,
          consentOnly: true,
        }).catch(() => {});
        throw mediaError;
      }
    }
    const result = await processCallrailTextEvent({
      db,
      event: normalizedEvent,
    });
    await db.update('message_provider_events', `id=eq.${row.id}`, {
      processing_state: 'processed',
      next_attempt_at: null,
      processed_at: new Date().toISOString(),
      message_id: result.messageId,
      send_attempt_id: result.attemptId || null,
      outcome: result.outcome,
      error_code: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    });
    return { processed: true };
  } catch (error) {
    const retryPatch = buildCallrailRetryPatch({
      // The claim above already persisted this attempt number.
      previousAttempts: Number(row.processing_attempts) || 0,
      error,
      now,
    });
    await db.update('message_provider_events', `id=eq.${row.id}`, {
      ...retryPatch,
    });
    return { failed: true, retryable: retryPatch.processing_state === 'retryable' };
  }
}

export async function processCallrailEventQueue(db, env, { now = new Date() } = {}) {
  if (env.MESSAGING_SCHEMA_MODE !== 'foundation' || !env.CALLRAIL_COMPANY_ID) {
    return {
      success: false,
      processed: 0,
      error: env.MESSAGING_SCHEMA_MODE !== 'foundation'
        ? 'MESSAGING_SCHEMA_NOT_READY'
        : 'CALLRAIL_COMPANY_NOT_CONFIGURED',
    };
  }
  const rows = await db.select(
    'message_provider_events',
    `provider=eq.callrail&company_resource_id=eq.${encodeURIComponent(env.CALLRAIL_COMPANY_ID)}&message_type=in.(sms,mms)&or=(processing_state.eq.received,and(processing_state.eq.retryable,next_attempt_at.lte.${encodeURIComponent(now.toISOString())}),and(processing_state.eq.claimed,claimed_at.lt.${encodeURIComponent(new Date(now.getTime() - CLAIM_TTL_MS).toISOString())}))&order=received_at.asc&limit=${BATCH_LIMIT}`,
  );
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    const outcome = await processRow(db, row, now, env);
    if (outcome.processed) processed += 1;
    else if (outcome.failed) failed += 1;
    else skipped += 1;
  }
  return { success: failed === 0, processed, failed, skipped };
}

export async function onRequestPost({ request, env }) {
  const db = supabase(env);
  if (!(await checkCronSecret(request, db))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const startedAt = new Date().toISOString();
  const result = await processCallrailEventQueue(db, env);
  await recordWorkerRun(db, {
    workerName: WORKER_NAME,
    status: result.success ? 'completed' : 'error',
    recordsProcessed: result.processed,
    errorMessage: result.error || (result.failed ? `${result.failed} event(s) failed` : null),
    startedAt,
  }).catch(() => {});
  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function scheduled(event, env) {
  const db = supabase(env);
  const startedAt = new Date().toISOString();
  const result = await processCallrailEventQueue(db, env);
  await recordWorkerRun(db, {
    workerName: WORKER_NAME,
    status: result.success ? 'completed' : 'error',
    recordsProcessed: result.processed,
    errorMessage: result.error || (result.failed ? `${result.failed} event(s) failed` : null),
    startedAt,
  }).catch(() => {});
}
