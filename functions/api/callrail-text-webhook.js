/**
 * ════════════════════════════════════════════════
 * FILE: callrail-text-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Receives only CallRail text events on a dedicated signed route, claims each
 *   event once in the provider-event inbox, and stops there until the separately
 *   reviewed message/MMS domain processor is enabled.
 *
 * ENDPOINT:
 *   POST /api/callrail-text-webhook
 *
 * DEPENDS ON:
 *   Internal:  ../lib/callrail-text-webhook.js, ../lib/supabase.js,
 *              ../lib/worker-runs.js
 *   Data:      reads/writes → message_provider_events; writes → worker_runs
 *
 * NOTES / GOTCHAS:
 *   - Missing CALLRAIL_SIGNING_KEY disables the route with 503.
 *   - The exact raw bytes are verified before JSON parsing.
 *   - Short-lived MMS URLs are not persisted by this receiver.
 *   - This route never delegates to the existing call/form webhook.
 * ════════════════════════════════════════════════
 */

import { parseVerifiedCallrailTextWebhook } from '../lib/callrail-text-webhook.js';
import {
  buildCallrailRetryPatch,
  processCallrailTextEvent,
} from '../lib/callrail-message-processor.js';
import { ingestVerifiedCallrailEventMms } from '../lib/callrail-mms.js';
import { supabase } from '../lib/supabase.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

const WORKER_NAME = 'callrail-text-webhook';
const MAX_WEBHOOK_BYTES = 256 * 1024;

async function recordRunBestEffort(db, details) {
  await recordWorkerRun(db, details).catch(() => {});
}

function response(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256(rawBody) {
  const digest = await crypto.subtle.digest('SHA-256', rawBody);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function findEvent(db, dedupeKey) {
  const [event] = await db.select(
    'message_provider_events',
    `dedupe_key=eq.${encodeURIComponent(dedupeKey)}` +
      '&select=id,processing_state,provider,event_type,provider_event_id,' +
      'provider_message_id,provider_conversation_id,direction,message_type,' +
      'sender_address,recipient_address,content,company_resource_id,' +
      'person_resource_id,agent_name,media_count,occurred_at,raw_body_hash&limit=1',
  );
  return event || null;
}

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function matchesImmutableEvent(existing, event, rawBodyHash) {
  return existing.provider === event.provider
    && existing.event_type === event.eventType
    && sameNullable(existing.provider_event_id, event.providerEventId)
    && existing.provider_message_id === event.providerMessageId
    && existing.provider_conversation_id === event.providerConversationId
    && existing.direction === event.direction
    && existing.message_type === event.messageType
    && existing.sender_address === event.from
    && existing.recipient_address === event.to
    && sameNullable(existing.content, event.body)
    && existing.company_resource_id === event.companyResourceId
    && sameNullable(existing.person_resource_id, event.personResourceId)
    && sameNullable(existing.agent_name, event.agentName)
    && Number(existing.media_count) === event.ephemeralMediaUrls.length
    && existing.occurred_at === event.occurredAt
    && existing.raw_body_hash === rawBodyHash;
}

async function duplicateResponse(db, existing, event, rawBodyHash, startedAt) {
  if (!matchesImmutableEvent(existing, event, rawBodyHash)) {
    await recordRunBestEffort(db, {
      workerName: WORKER_NAME,
      status: 'error',
      recordsProcessed: 0,
      errorMessage: 'CALLRAIL_EVENT_DEDUPE_CONFLICT',
      startedAt,
      meta: { duplicate: true, processing_state: existing.processing_state },
    });
    return response({
      error: 'Conflicting CallRail text event',
      code: 'CALLRAIL_EVENT_DEDUPE_CONFLICT',
    }, 409);
  }

  const failedDuplicate = existing.processing_state === 'failed';
  await recordRunBestEffort(db, {
    workerName: WORKER_NAME,
    status: failedDuplicate ? 'error' : 'completed',
    recordsProcessed: 0,
    errorMessage: failedDuplicate ? 'DUPLICATE_FAILED_CALLRAIL_EVENT' : null,
    startedAt,
    meta: { duplicate: true, processing_state: existing.processing_state },
  });
  return response({ accepted: true, duplicate: true }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();
  const signingKey = env.CALLRAIL_SIGNING_KEY;
  const companyId = env.CALLRAIL_COMPANY_ID;
  let processingErrorCode = null;

  if (env.MESSAGING_SCHEMA_MODE !== 'foundation' || !signingKey || !companyId) {
    await recordRunBestEffort(db, {
      workerName: WORKER_NAME,
      status: 'error',
      errorMessage: 'CallRail text webhook not configured',
      startedAt,
    });
    return response({ error: 'CallRail text webhook is not configured' }, 503);
  }

  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return response({ error: 'CallRail text webhook payload is too large' }, 413);
  }
  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    return response({ error: 'CallRail text webhook payload is too large' }, 413);
  }
  let event;
  try {
    event = await parseVerifiedCallrailTextWebhook({
      rawBody,
      signature: request.headers.get('Signature'),
      signingKey,
    });
  } catch (error) {
    const forbidden = [
      'INVALID_CALLRAIL_SIGNATURE',
      'STALE_CALLRAIL_TIMESTAMP',
      'FUTURE_CALLRAIL_TIMESTAMP',
    ].includes(error.code);
    await recordRunBestEffort(db, {
      workerName: WORKER_NAME,
      status: 'error',
      errorMessage: error.code || 'Invalid CallRail text event',
      startedAt,
    });
    return response({
      error: forbidden ? 'Forbidden' : 'Invalid CallRail text event',
      code: error.code || 'INVALID_CALLRAIL_TEXT_EVENT',
    }, forbidden ? 403 : 400);
  }

  if (event.companyResourceId !== companyId) {
    await recordRunBestEffort(db, {
      workerName: WORKER_NAME,
      status: 'error',
      errorMessage: 'CALLRAIL_COMPANY_MISMATCH',
      startedAt,
    });
    return response({ error: 'Forbidden', code: 'CALLRAIL_COMPANY_MISMATCH' }, 403);
  }

  const rawBodyHash = await sha256(rawBody);
  let existing;
  try {
    existing = await findEvent(db, event.dedupeKey);
  } catch (error) {
    await recordRunBestEffort(db, {
      workerName: WORKER_NAME,
      status: 'error',
      errorMessage: error.message,
      startedAt,
    });
    return response({ error: 'Temporary webhook processing failure' }, 500);
  }
  if (existing) {
    return duplicateResponse(db, existing, event, rawBodyHash, startedAt);
  }

  try {
    const [claimedEvent] = await db.insert('message_provider_events', {
      provider: event.provider,
      event_type: event.eventType,
      provider_event_id: event.providerEventId,
      provider_message_id: event.providerMessageId,
      provider_conversation_id: event.providerConversationId,
      direction: event.direction,
      message_type: event.messageType,
      sender_address: event.from,
      recipient_address: event.to,
      content: event.body,
      company_resource_id: event.companyResourceId,
      person_resource_id: event.personResourceId,
      agent_name: event.agentName,
      media_count: event.ephemeralMediaUrls.length,
      raw_body_hash: rawBodyHash,
      dedupe_key: event.dedupeKey,
      occurred_at: event.occurredAt,
      processing_state: 'claimed',
      claimed_at: new Date().toISOString(),
    });
    try {
      let processingEvent = { ...event, eventId: claimedEvent.id };
      if (event.messageType === 'mms') {
        try {
          const owned = await ingestVerifiedCallrailEventMms({
            db,
            env,
            event: { ...event, mediaCount: event.ephemeralMediaUrls.length },
          });
          processingEvent = { ...event, eventId: claimedEvent.id, ownedMedia: owned.media };
          await db.update('message_provider_events', `id=eq.${claimedEvent.id}`, {
            owned_media: owned.media,
            updated_at: new Date().toISOString(),
          });
        } catch (mediaError) {
          // Consent keywords still apply even when attachment capture fails.
          await processCallrailTextEvent({
            db,
            event: { ...event, eventId: claimedEvent.id },
            consentOnly: true,
          }).catch(() => {});
          throw mediaError;
        }
      }
      const result = await processCallrailTextEvent({ db, event: processingEvent });
      await db.update('message_provider_events', `id=eq.${claimedEvent.id}`, {
        processing_state: 'processed',
        processed_at: new Date().toISOString(),
        message_id: result.messageId,
        send_attempt_id: result.attemptId || null,
        outcome: result.outcome,
        updated_at: new Date().toISOString(),
      });
    } catch (processingError) {
      processingErrorCode = processingError.code || 'CALLRAIL_PROCESSING_FAILED';
      await db.update('message_provider_events', `id=eq.${claimedEvent.id}`, {
        ...buildCallrailRetryPatch({
          previousAttempts: 0,
          error: processingError,
        }),
      });
    }
  } catch (error) {
    // The unique dedupe key may have been claimed concurrently.
    let winner;
    try {
      winner = await findEvent(db, event.dedupeKey);
    } catch {
      winner = null;
    }
    if (!winner) {
      await recordRunBestEffort(db, {
        workerName: WORKER_NAME,
        status: 'error',
        errorMessage: error.message,
        startedAt,
      });
      return response({ error: 'Temporary webhook processing failure' }, 500);
    }
    return duplicateResponse(db, winner, event, rawBodyHash, startedAt);
  }

  await recordRunBestEffort(db, {
    workerName: WORKER_NAME,
    status: processingErrorCode ? 'error' : 'completed',
    recordsProcessed: 1,
    errorMessage: processingErrorCode,
    startedAt,
    meta: { event_type: event.eventType },
  });
  return response({ accepted: true }, 202);
}
