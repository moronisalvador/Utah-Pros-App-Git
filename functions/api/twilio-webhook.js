/**
 * ════════════════════════════════════════════════
 * FILE: twilio-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Authenticates one Twilio inbound SMS/MMS, retains its normalized provider
 *   event, privately owns MMS bytes, then projects consent, canonical message,
 *   unread state, and the notification outbox in one database transaction.
 *
 * ENDPOINT:
 *   POST /api/twilio-webhook
 *
 * DEPENDS ON:
 *   Internal: ../lib/twilio.js, ../lib/twilio-inbound.js,
 *             ../lib/twilio-mms.js, ../lib/twilio-inbound-processor.js,
 *             ../lib/twilio-inbound-auth.js, ../lib/supabase.js,
 *             ../lib/worker-runs.js
 *   Data:     reads/writes → message_provider_events; writes through
 *             project_twilio_inbound_event → contacts, conversations,
 *             conversation_participants, messages, sms_consent_log,
 *             message_notification_outbox
 *
 * NOTES / GOTCHAS:
 *   - Signature validation uses the exact request URL and every received form
 *     parameter before any domain/provider/storage side effect.
 *   - Before signature success, only the exact token/AccountSid authentication
 *     lookup is allowed; there is no telemetry or domain write.
 *   - MessageSid is the provider-event/message dedupe identity.
 *   - A notification is never dispatched directly from this route. The unique
 *     durable outbox row is the only message.inbound delivery path.
 *   - STOP/START/HELP TwiML remains synchronous. Advanced Opt-Out may make the
 *     response intentionally empty while the durable consent projection stays.
 * ════════════════════════════════════════════════
 */

import { handleOptions } from '../lib/cors.js';
import {
  detectKeyword,
  keywordReplyBody,
} from '../lib/messaging-inbound.js';
import { supabase } from '../lib/supabase.js';
import {
  parseTwilioInbound,
  sameTwilioInboundEvent,
  TwilioInboundError,
} from '../lib/twilio-inbound.js';
import { processTwilioInboundEvent } from '../lib/twilio-inbound-processor.js';
import { resolveTwilioInboundAuth } from '../lib/twilio-inbound-auth.js';
import { ingestTwilioMms } from '../lib/twilio-mms.js';
import { validateTwilioFormSignature } from '../lib/twilio.js';
import { recordWorkerRun } from '../lib/worker-runs.js';

export {
  buildPhoneOrFilter,
  detectKeyword,
  isAmbiguousContentReply,
  keywordReplyBody,
  normalizeKeyword,
  phoneMatchVariants,
} from '../lib/messaging-inbound.js';

const WORKER_NAME = 'twilio-webhook';
const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_PROCESSING_ATTEMPTS = 8;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;
const PROCESSING_LEASE_MS = 5 * 60_000;

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function twimlResponse(messageBody = '') {
  const message = messageBody
    ? `<Message>${xmlEscape(messageBody)}</Message>`
    : '';
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${message}</Response>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    },
  );
}

function keywordTwiml(event, env) {
  const keyword = detectKeyword(event?.body);
  return twimlResponse(keywordReplyBody(keyword, {
    advancedOptOut: env.TWILIO_ADVANCED_OPT_OUT === 'true',
  }));
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function retryPatch(existing, error, now = new Date()) {
  const attempts = Math.max(0, Number(existing?.processing_attempts) || 0) + 1;
  const retryable = error?.retryable === true && attempts < MAX_PROCESSING_ATTEMPTS;
  const delay = Math.min(
    RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1)),
    RETRY_MAX_MS,
  );
  return {
    processing_state: retryable ? 'retryable' : 'failed',
    processing_attempts: attempts,
    next_attempt_at: retryable
      ? new Date(now.getTime() + delay).toISOString()
      : null,
    outcome: retryable ? 'processing_deferred' : 'processing_blocked',
    error_code: error?.code || 'TWILIO_INBOUND_PROCESSING_FAILED',
    error_message: String(error?.message || error).slice(0, 500),
    claimed_at: null,
    updated_at: now.toISOString(),
  };
}

async function findEvent(db, dedupeKey) {
  const [event] = await db.select(
    'message_provider_events',
    `dedupe_key=eq.${encodeURIComponent(dedupeKey)}` +
      '&select=id,provider,event_type,provider_event_id,provider_message_id,' +
      'provider_conversation_id,direction,message_type,sender_address,' +
      'recipient_address,content,media_count,owned_media,raw_body_hash,' +
      'processing_state,processing_attempts,outcome,message_id,contact_id,' +
      'conversation_id,occurred_at,claimed_at&limit=1',
  );
  return event || null;
}

function retainedEvent(row, event, ownedMedia = row?.owned_media || []) {
  return {
    ...event,
    eventId: row.id,
    occurredAt: row.occurred_at,
    ownedMedia,
  };
}

async function recordRunBestEffort(db, details, recordRunImpl) {
  await recordRunImpl(db, details).catch(() => {});
}

function processingResponse(error, event, env) {
  if (error?.retryable === true) {
    return new Response('Server error — retry', { status: 500 });
  }
  return keywordTwiml(event, env);
}

async function processRetainedEvent({
  db,
  eventRow,
  event,
  authToken,
  ingestMmsImpl,
  processEventImpl,
}) {
  let processingEvent = retainedEvent(eventRow, event);
  try {
    if (event.messageType === 'mms') {
      try {
        const owned = await ingestMmsImpl({
          db,
          accountSid: event.accountSid,
          authToken,
          messageSid: event.providerMessageId,
          media: event.ephemeralMedia,
        });
        processingEvent = retainedEvent(eventRow, event, owned.media);
        await db.update('message_provider_events', `id=eq.${eventRow.id}`, {
          owned_media: owned.media,
          updated_at: new Date().toISOString(),
        });
      } catch (mediaError) {
        // The text body may carry STOP/START/HELP even when media capture fails.
        // Apply only consent state atomically; never create a canonical message
        // or outbox occurrence until every attachment is privately owned.
        await processEventImpl({
          db,
          event: retainedEvent(eventRow, event),
          consentOnly: true,
        }).catch(() => {});
        throw mediaError;
      }
    }
    return await processEventImpl({ db, event: processingEvent });
  } catch (error) {
    const patch = retryPatch(eventRow, error);
    try {
      await db.update('message_provider_events', `id=eq.${eventRow.id}`, patch);
    } catch (cause) {
      throw new TwilioInboundError(
        'TWILIO_EVENT_RETRY_STATE_FAILED',
        'Twilio inbound retry state could not be retained.',
        { status: 500, retryable: true, cause },
      );
    }
    if (error && typeof error === 'object') {
      error.retryable = patch.processing_state === 'retryable';
      throw error;
    }
    throw new TwilioInboundError(
      'TWILIO_INBOUND_PROCESSING_FAILED',
      'Twilio inbound processing failed.',
      {
        status: 500,
        retryable: patch.processing_state === 'retryable',
      },
    );
  }
}

/**
 * Dependency-injected handler for deterministic Worker tests. The public route
 * below supplies the real service client, credential resolver, private-media
 * copier, projection RPC, and telemetry helper.
 */
export async function handleTwilioInbound({
  request,
  env,
  db,
  resolveInboundAuthImpl = resolveTwilioInboundAuth,
  ingestMmsImpl = ingestTwilioMms,
  processEventImpl = processTwilioInboundEvent,
  recordRunImpl = recordWorkerRun,
}) {
  const startedAt = new Date().toISOString();
  const finish = (details) => recordRunBestEffort(db, {
    workerName: WORKER_NAME,
    startedAt,
    ...details,
  }, recordRunImpl);

  if (env.MESSAGING_SCHEMA_MODE !== 'foundation') {
    return new Response('Twilio inbound webhook is not configured', {
      status: 503,
    });
  }

  let credential;
  try {
    credential = await resolveInboundAuthImpl(env, db);
  } catch {
    credential = null;
  }
  if (!credential?.authToken || !credential?.accountSid) {
    return new Response('Twilio auth token not configured', { status: 500 });
  }

  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return new Response('Payload too large', { status: 413 });
  }
  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    return new Response('Payload too large', { status: 413 });
  }
  const params = new URLSearchParams(new TextDecoder().decode(rawBody));
  const signatureValid = await validateTwilioFormSignature({
    signature: request.headers.get('X-Twilio-Signature'),
    authToken: credential.authToken,
    url: request.url,
    params,
  });
  if (!signatureValid) {
    return new Response('Forbidden', { status: 403 });
  }

  let event;
  try {
    event = parseTwilioInbound(params);
    if (event.accountSid !== credential.accountSid) {
      throw new TwilioInboundError(
        'TWILIO_INBOUND_ACCOUNT_MISMATCH',
        'Twilio AccountSid does not match the configured account.',
        { status: 403 },
      );
    }
  } catch (error) {
    await finish({
      status: 'error',
      recordsProcessed: 0,
      errorMessage: error.code || 'TWILIO_INBOUND_INVALID',
    });
    return new Response(
      error.status === 403 ? 'Forbidden' : 'Invalid Twilio webhook',
      { status: error.status || 400 },
    );
  }

  const rawBodyHash = await sha256Hex(rawBody);
  let existing;
  try {
    existing = await findEvent(db, event.dedupeKey);
  } catch (error) {
    await finish({
      status: 'error',
      recordsProcessed: 0,
      errorMessage: error.message,
    });
    return new Response('Server error — retry', { status: 500 });
  }

  if (existing) {
    if (!sameTwilioInboundEvent(existing, event, rawBodyHash)) {
      await finish({
        status: 'error',
        recordsProcessed: 0,
        errorMessage: 'TWILIO_EVENT_DEDUPE_CONFLICT',
      });
      return new Response('Conflicting Twilio webhook', { status: 409 });
    }
    if (existing.processing_state === 'processed') {
      await finish({
        status: 'completed',
        recordsProcessed: 0,
        meta: { duplicate: true, processing_state: 'processed' },
      });
      return keywordTwiml(event, env);
    }
    if (existing.processing_state === 'failed') {
      await finish({
        status: 'error',
        recordsProcessed: 0,
        errorMessage: 'DUPLICATE_FAILED_TWILIO_EVENT',
        meta: { duplicate: true, processing_state: 'failed' },
      });
      return keywordTwiml(event, env);
    }
    const claimedAt = new Date(existing.claimed_at || 0).getTime();
    const claimedIsStale = Number.isFinite(claimedAt)
      && claimedAt > 0
      && claimedAt < Date.now() - PROCESSING_LEASE_MS;
    if (existing.processing_state === 'claimed' && !claimedIsStale) {
      await finish({
        status: 'error',
        recordsProcessed: 0,
        errorMessage: 'TWILIO_EVENT_ALREADY_CLAIMED',
        meta: { duplicate: true, processing_state: 'claimed' },
      });
      return new Response('Server error — retry', { status: 500 });
    }

    try {
      await processRetainedEvent({
        db,
        eventRow: existing,
        event,
        authToken: credential.authToken,
        ingestMmsImpl,
        processEventImpl,
      });
      await finish({
        status: 'completed',
        recordsProcessed: 1,
        meta: { duplicate: true, recovered: true },
      });
      return keywordTwiml(event, env);
    } catch (error) {
      await finish({
        status: 'error',
        recordsProcessed: 0,
        errorMessage: error.code || 'TWILIO_INBOUND_PROCESSING_FAILED',
      });
      return processingResponse(error, event, env);
    }
  }

  let claimed;
  try {
    [claimed] = await db.insert('message_provider_events', {
      provider: event.provider,
      event_type: event.eventType,
      provider_event_id: event.providerEventId,
      provider_message_id: event.providerMessageId,
      provider_conversation_id: null,
      direction: event.direction,
      message_type: event.messageType,
      sender_address: event.from,
      recipient_address: event.to,
      content: event.body,
      media_count: event.mediaCount,
      raw_body_hash: rawBodyHash,
      dedupe_key: event.dedupeKey,
      occurred_at: new Date().toISOString(),
      processing_state: 'claimed',
      claimed_at: new Date().toISOString(),
    });
  } catch (error) {
    // A concurrent delivery may have won the unique dedupe-key insert.
    let winner = null;
    try {
      winner = await findEvent(db, event.dedupeKey);
    } catch {
      // The original insert error is the useful result.
    }
    if (winner && sameTwilioInboundEvent(winner, event, rawBodyHash)) {
      await finish({
        status: winner.processing_state === 'processed' ? 'completed' : 'error',
        recordsProcessed: 0,
        errorMessage: winner.processing_state === 'processed'
          ? null
          : 'TWILIO_EVENT_CONCURRENTLY_CLAIMED',
        meta: { duplicate: true, concurrent: true },
      });
      return winner.processing_state === 'processed' || winner.processing_state === 'failed'
        ? keywordTwiml(event, env)
        : new Response('Server error — retry', { status: 500 });
    }
    await finish({
      status: 'error',
      recordsProcessed: 0,
      errorMessage: error.message,
    });
    return new Response('Server error — retry', { status: 500 });
  }

  try {
    await processRetainedEvent({
      db,
      eventRow: claimed,
      event,
      authToken: credential.authToken,
      ingestMmsImpl,
      processEventImpl,
    });
    await finish({
      status: 'completed',
      recordsProcessed: 1,
      meta: { message_type: event.messageType },
    });
    return keywordTwiml(event, env);
  } catch (error) {
    await finish({
      status: 'error',
      recordsProcessed: 0,
      errorMessage: error.code || 'TWILIO_INBOUND_PROCESSING_FAILED',
    });
    return processingResponse(error, event, env);
  }
}

export function onRequestOptions({ request, env }) {
  return handleOptions(request, env);
}

// public: Twilio cannot present a Supabase session. The exact request URL and
// every form parameter are authenticated with the server-only Twilio token
// before provider-event, Storage, canonical-message, consent, or notify work.
export function onRequestPost({ request, env }) {
  return handleTwilioInbound({
    request,
    env,
    db: supabase(env),
  });
}
