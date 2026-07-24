/**
 * ════════════════════════════════════════════════
 * FILE: send-message.js  (POST /api/send-message)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is the single door every staff-typed text message goes through before it
 *   leaves the building. It looks up who the message is going to, checks each
 *   recipient's permission (Do-Not-Disturb off, opted-in) one person at a time, and
 *   only then hands the text to the selected transport. It writes one message record per recipient
 *   so a text that fails for one person is still recorded instead of vanishing. An
 *   "internal note" is stored quietly with no text ever sent.
 *
 * WHERE IT LIVES:
 *   Route:        POST /api/send-message (Cloudflare Pages Function)
 *   Rendered by:  n/a — called by src/pages/Conversations.jsx
 *
 * DEPENDS ON:
 *   Packages:  none (pure fetch via lib helpers)
 *   Internal:  functions/lib/supabase.js, functions/lib/messaging-transport.js,
 *              functions/lib/cors.js
 *   Data:      reads  → conversations, conversation_participants, contacts, employees,
 *                       service_sms_consents (through get_service_sms_consent_status)
 *              writes → messages, sms_consent_log, conversations
 *
 * Request body:
 *   { conversation_id: uuid, body: string, sent_by: uuid (employee id),
 *     media_urls?: string[], is_internal_note?: boolean,
 *     client_request_id?: uuid }
 *
 * NOTES / GOTCHAS:
 *   - COMPLIANCE, NO BYPASS: the DND + opt-in gate runs for EVERY recipient (TCPA:
 *     consent before send; CTIA: DND/opt-out honored; 10DLC: company identity is
 *     included and the first message carries STOP instructions, status callback set).
 *     There is NO `skip_compliance` flag (removed Wave -1 /
 *     F-2) — never reintroduce it. TCPA penalties are per message.
 *   - WORKER IS THE SOLE WRITER of any `sms_*` message row (omni §7.1). The client
 *     inserts only `internal_note`. Never fall back to another channel (omni §7.3):
 *     a recipient with no valid SMS destination is refused, not retargeted.
 *   - Phase B replaced the Wave -1 group/broadcast refuse-guard with the real
 *     per-participant consent loop below. SMS-only: omni-O's `channel`/email branch is
 *     deliberately deferred to a future omni email reconciliation (roadmap §8a).
 *   - `num_segments` / `price` are left NULL here on purpose — Phase A fills them from
 *     the Twilio status callback (contract §9.2). The insert shape stays segment-aware.
 * ════════════════════════════════════════════════
 */
import { supabase } from '../lib/supabase.js';
import {
  resolveMessagingSchemaMode,
  resolveMessagingSendMode,
  sendMessage,
} from '../lib/messaging-transport.js';
import { requireMessagingAccess } from '../lib/messaging-auth.js';
import {
  claimChildMessageAttempt,
  claimMessageAttempt,
  completeMessageAttempt,
  findMessageAttempt,
} from '../lib/messaging-attempts.js';
import { resolveMessageMedia } from '../lib/message-media.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

// ─── SECTION: Helpers ───────────────────────────────────────────────────────

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedPhoneIdentity(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

// Run the per-recipient consent gate. Returns { blocked, code } and, when a
// resolved contact is blocked, writes the audit row to sms_consent_log. Fails
// CLOSED: a missing contact (dangling/forged participant) is a block, not a send.
async function gateRecipient(db, contact, participantPhone, sentBy) {
  if (!contact) return { blocked: true, code: 'CONTACT_NOT_FOUND' };
  const contactPhone = normalizedPhoneIdentity(contact.phone);
  const destinationPhone = normalizedPhoneIdentity(participantPhone);
  if (!contactPhone || destinationPhone !== contactPhone) {
    return { blocked: true, code: 'CONTACT_PHONE_MISMATCH' };
  }

  // One service-role-only database decision owns duplicate-phone suppression,
  // durable-but-unprojected STOP events, global opt-in, and the narrow
  // one-to-one service consent. Browser roles cannot forge the service record.
  const rawStatus = await db.rpc('get_service_sms_consent_status', {
    p_contact_id: contact.id,
    p_destination_phone: participantPhone,
  });
  const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
  if (status?.allowed === true) return { blocked: false };

  if (status?.code === 'DND_ACTIVE') {
    await db.insert('sms_consent_log', {
      contact_id: contact.id,
      phone: contact.phone,
      event_type: 'send_blocked_dnd',
      source: 'system',
      details: `Outbound blocked: DND active since ${contact.dnd_at || 'unknown'}`,
      performed_by: sentBy,
    });
    return { blocked: true, code: 'DND_ACTIVE' };
  }

  if (status?.code === 'CONTACT_PHONE_MISMATCH') {
    return { blocked: true, code: 'CONTACT_PHONE_MISMATCH' };
  }
  if (status?.code === 'CONTACT_NOT_FOUND') {
    return { blocked: true, code: 'CONTACT_NOT_FOUND' };
  }

  // Missing/unknown status fails closed as NO_CONSENT. Never fall back to the
  // browser-visible contact boolean when the authoritative RPC is unavailable.
  {
    await db.insert('sms_consent_log', {
      contact_id: contact.id,
      phone: contact.phone,
      event_type: 'send_blocked_no_consent',
      source: 'system',
      details: status?.source === 'explicit_opt_out'
        ? `Outbound blocked: explicit opt-out recorded. ${contact.opt_out_reason ? 'Reason: ' + contact.opt_out_reason : ''}`
        : status?.source === 'pending_stop'
          ? 'Outbound blocked: an inbound STOP request is awaiting projection.'
          : 'Outbound blocked: no current global or service-message consent.',
      performed_by: sentBy,
    });
    return { blocked: true, code: 'NO_CONSENT' };
  }
}

// Send to ONE already-consent-cleared recipient and record its own messages row.
// Never throws — a transport failure (or a missing SMS destination, which we refuse
// rather than retarget) is captured as a `failed` row so it is visible, not lost.
// The worker is the sole writer of this row (omni §7.1).
async function sendToRecipient(db, env, {
  conversationId,
  participant,
  clientBody,
  rawBody,
  mediaUrls,
  statusCallback,
  sentBy,
  provider,
  requestedChannel,
  foundationSchema,
  clientRequestId = null,
  attemptId = null,
}) {
  let providerResult = null;
  let error = null;

  if (!participant.phone) {
    // No valid SMS destination → refuse (omni §7.3: never cross-channel fallback).
    error = new Error('No phone number for recipient');
  } else {
    try {
      const media = await resolveMessageMedia(db, mediaUrls || [], conversationId, {
        allowLegacyPublic: provider === 'twilio',
        legacyPublicBaseUrl: env.SUPABASE_URL,
      });
      providerResult = await sendMessage(env, {
        purpose: 'staff_p2p',
        recipient: {
          contactId: participant.contact_id,
          address: participant.phone,
        },
        sender: {
          employeeId: sentBy,
        },
        content: {
          body: clientBody,
          mediaUrls,
          media,
        },
        statusCallbackUrl: statusCallback,
      }, { provider, db });
    } catch (err) {
      error = err;
    }
  }

  const providerMessageId = provider === 'twilio'
    ? providerResult?.sid || null
    : providerResult?.providerMessageId || null;
  const accepted = provider === 'twilio'
    ? !!providerMessageId
    : providerResult?.accepted === true;
  const sid = provider === 'twilio' ? providerMessageId : null;
  const errorCode = error?.code != null ? String(error.code) : null;
  const errorMessage = error?.message || null;
  const ambiguous = error?.ambiguous === true;
  const ambiguousCode = provider === 'callrail'
    ? 'CALLRAIL_SEND_AMBIGUOUS'
    : 'TWILIO_SEND_AMBIGUOUS';
  const reconciliationPending = ambiguous
    || (provider === 'callrail' && accepted && !providerMessageId);
  const actualChannel = accepted && provider === 'twilio'
    ? (String(providerResult?.from || '').startsWith('rcs:') ? 'rcs' : requestedChannel)
    : null;

  let row;
  try {
    const messageRecord = {
      conversation_id: conversationId,
      type: 'sms_outbound',
      body: rawBody,
      channel: mediaUrls?.length > 0 ? 'mms' : 'sms',
      status: accepted ? (providerResult?.status || 'queued') : 'failed',
      twilio_sid: sid,
      sent_by: sentBy,
      media_urls: mediaUrls?.length > 0 ? JSON.stringify(mediaUrls) : null,
      error_code: ambiguous ? ambiguousCode : errorCode,
      error_message: errorMessage,
      // num_segments / price: intentionally NULL — Phase A fills them from the
      // Twilio status callback (contract §9.2).
    };
    if (foundationSchema) {
      Object.assign(messageRecord, {
        provider,
        provider_message_id: providerMessageId,
        provider_conversation_id: providerResult?.providerConversationId || null,
        client_request_id: clientRequestId,
        sender_address: providerResult?.from || null,
        recipient_address: participant.phone,
      });
    }
    [row] = await db.insert('messages', messageRecord);
  } catch (insertError) {
    await completeMessageAttempt(db, attemptId, {
      state: 'ambiguous',
      provider_message_id: providerMessageId,
      provider_conversation_id: providerResult?.providerConversationId || null,
      provider_http_status: providerResult?.providerHttpStatus || error?.status || null,
      provider_status: providerResult?.status || null,
      sender_address: providerResult?.from || null,
      actual_channel: actualChannel,
      response_at: new Date().toISOString(),
      error_code: 'MESSAGE_PERSIST_FAILED',
      error_message: 'Provider outcome could not be linked to a message row',
      reconcile_after: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }).catch(() => {});
    throw insertError;
  }

  await completeMessageAttempt(db, attemptId, {
    state: accepted ? 'accepted' : ambiguous ? 'ambiguous' : 'failed',
    message_id: row.id,
    provider_message_id: providerMessageId,
    provider_conversation_id: providerResult?.providerConversationId || null,
    provider_http_status: providerResult?.providerHttpStatus || error?.status || null,
    provider_status: providerResult?.status || null,
    sender_address: providerResult?.from || null,
    actual_channel: actualChannel,
    response_at: new Date().toISOString(),
    completed_at: reconciliationPending ? null : new Date().toISOString(),
    reconcile_after: reconciliationPending
      ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
      : null,
    error_code: ambiguous ? ambiguousCode : errorCode,
    error_message: errorMessage,
  });

  // The per-recipient result surfaced on the response (error_code/error_message
  // are additive to the frozen contract — never removed/renamed).
  const result = sid
    ? { ...providerResult, contact_id: participant.contact_id }
    : accepted
      ? { ...providerResult, contact_id: participant.contact_id }
    : {
      error: errorMessage,
      error_code: ambiguous ? ambiguousCode : errorCode,
      error_message: errorMessage,
      to: participant.phone,
      contact_id: participant.contact_id,
    };

  return { result, row, sent: accepted };
}

async function updateConversationAfterSend(db, conversation, rawBody) {
  const now = new Date().toISOString();
  const updateData = {
    last_message_at: now,
    last_message_preview: rawBody ? rawBody.substring(0, 100) : '📷 Photo',
    status: 'waiting_on_client',
    status_changed_at: now,
    updated_at: now,
  };
  if (conversation.status === 'needs_response' && !conversation.first_response_at) {
    updateData.first_response_at = now;
  }
  await db.update('conversations', `id=eq.${conversation.id}`, updateData);
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const foundationSchema = resolveMessagingSchemaMode(env) === 'foundation';

  // Resolve a real active employee and the same conversations capability the UI
  // uses before any service-role read, consent audit, note write, or provider call.
  const auth = await requireMessagingAccess(request, env, db);
  if (auth.error) {
    const payload = { error: auth.error };
    if (auth.code) payload.code = auth.code;
    return jsonResponse(payload, auth.status, request, env);
  }

  try {
    const {
      conversation_id,
      body,
      sent_by,
      media_urls,
      is_internal_note,
      client_request_id,
    } = await request.json();

    if (!UUID_PATTERN.test(String(conversation_id || ''))) {
      return jsonResponse({
        error: 'conversation_id must be a UUID',
        code: 'INVALID_CONVERSATION_ID',
      }, 400, request, env);
    }
    if (body != null && typeof body !== 'string') {
      return jsonResponse({
        error: 'body must be text',
        code: 'INVALID_MESSAGE_BODY',
      }, 400, request, env);
    }
    if (
      media_urls != null
      && (
        !Array.isArray(media_urls)
        || media_urls.length > 10
        || media_urls.some((url) => typeof url !== 'string' || !url.trim())
      )
    ) {
      return jsonResponse({
        error: 'media_urls must contain at most 10 non-empty URL strings',
        code: 'INVALID_MEDIA_URLS',
      }, 400, request, env);
    }

    // A photo can go with no caption (media-only MMS); a text or note still needs a body.
    const hasMedia = Array.isArray(media_urls) && media_urls.length > 0;
    if (!conversation_id || (!body?.trim() && !(hasMedia && !is_internal_note))) {
      return jsonResponse({ error: 'conversation_id and a message body or media are required' }, 400, request, env);
    }
    if (client_request_id != null && !UUID_PATTERN.test(client_request_id)) {
      return jsonResponse({ error: 'client_request_id must be a UUID', code: 'INVALID_CLIENT_REQUEST_ID' }, 400, request, env);
    }
    if (sent_by && sent_by !== auth.employee.id) {
      return jsonResponse({
        error: 'sent_by does not match the authenticated employee',
        code: 'SENDER_MISMATCH',
      }, 403, request, env);
    }

    const rawBody = (body || '').trim();
    const actorEmployeeId = auth.employee.id;

    // Resolve the canonical conversation before either a note write or any
    // participant/provider work. Conversations are company-wide only for staff
    // who passed the server conversations capability above.
    const [conversation] = await db.select('conversations', `id=eq.${conversation_id}`);
    if (!conversation) {
      return jsonResponse({ error: 'Conversation not found' }, 404, request, env);
    }

    // ═══ INTERNAL NOTE: just insert, no provider call, no SMS compliance needed ═══
    // channel stays NULL (a note has no transport) — it is physically unsendable.
    if (is_internal_note) {
      if (foundationSchema && client_request_id) {
        const [existingNote] = await db.select(
          'messages',
          `client_request_id=eq.${client_request_id}&select=*&limit=1`,
        );
        if (existingNote) {
          const sameNote = existingNote.type === 'internal_note'
            && existingNote.conversation_id === conversation_id
            && existingNote.sent_by === actorEmployeeId
            && existingNote.body === rawBody;
          if (!sameNote) {
            return jsonResponse({
              error: 'client_request_id was already used for a different message',
              code: 'CLIENT_REQUEST_CONFLICT',
            }, 409, request, env);
          }
          return jsonResponse({
            success: true,
            message: existingNote,
            type: 'internal_note',
          }, 201, request, env);
        }
      }

      let note;
      try {
        const noteRecord = {
          conversation_id,
          type: 'internal_note',
          body: rawBody,
          status: 'received',
          sent_by: actorEmployeeId,
        };
        if (foundationSchema) noteRecord.client_request_id = client_request_id || null;
        [note] = await db.insert('messages', noteRecord);
      } catch (insertError) {
        if (!foundationSchema || !client_request_id) throw insertError;
        const [winner] = await db.select(
          'messages',
          `client_request_id=eq.${client_request_id}&select=*&limit=1`,
        );
        const sameNote = winner?.type === 'internal_note'
          && winner.conversation_id === conversation_id
          && winner.sent_by === actorEmployeeId
          && winner.body === rawBody;
        if (!sameNote) throw insertError;
        note = winner;
      }

      await db.update('conversations', `id=eq.${conversation_id}`, {
        last_message_at: new Date().toISOString(),
        last_message_preview: `[Note] ${rawBody.substring(0, 80)}`,
        updated_at: new Date().toISOString(),
      });

      return jsonResponse({ success: true, message: note, type: 'internal_note' }, 201, request, env);
    }

    // ═══ OUTBOUND MESSAGE ═══

    const provider = resolveMessagingSendMode(env);
    if (provider === 'disabled') {
      return jsonResponse({
        error: 'Staff messaging is disabled',
        code: 'MESSAGING_SEND_DISABLED',
      }, 503, request, env);
    }
    if (provider === 'callrail' && !foundationSchema) {
      return jsonResponse({
        error: 'CallRail messaging persistence is not ready',
        code: 'MESSAGING_SCHEMA_NOT_READY',
      }, 503, request, env);
    }

    // 1. Load active participants.
    const participants = await db.select(
      'conversation_participants',
      `conversation_id=eq.${conversation_id}&is_active=eq.true`
    );

    if (participants.length === 0) {
      return jsonResponse({ error: 'No active participants in conversation' }, 400, request, env);
    }

    const isMulti = conversation.type === 'group' || conversation.type === 'broadcast';
    if (
      provider === 'callrail'
      && (conversation.type !== 'direct' || isMulti || participants.length !== 1)
    ) {
      return jsonResponse({
        error: 'CallRail supports staff person-to-person messages only',
        code: 'CALLRAIL_PURPOSE_UNSUPPORTED',
      }, 400, request, env);
    }

    // 2. Sender identity + first-message opt-out notice. An employee name by itself
    // does not identify the party that obtained consent. Repeating the company on
    // later messages is safe and keeps every standalone message attributable.
    const senderPrefix = auth.employee.full_name
      ? `Utah Pros Restoration - ${auth.employee.full_name}: `
      : 'Utah Pros Restoration: ';
    const priorOutbound = await db.select(
      'messages',
      `conversation_id=eq.${conversation_id}&type=eq.sms_outbound&status=in.(queued,sent,delivered,read)&select=id&limit=1`,
    );
    const optOutNotice = priorOutbound.length === 0
      ? ' Reply STOP to unsubscribe.'
      : '';
    // Media-only send: drop the dangling "Name: " colon so the MMS carries just the
    // sender identity plus the required first-message opt-out notice.
    const identifiedBody = rawBody
      ? senderPrefix + rawBody
      : senderPrefix.replace(/:\s*$/, '');
    const clientBody = identifiedBody + optOutNotice;

    // 3. Status callback URL for delivery receipts (Phase A reads segment/price here).
    const baseUrl = env.PAGES_URL || `https://${request.headers.get('host')}`;
    const statusCallback = `${baseUrl}/api/twilio-status`;

    // ── DIRECT (single recipient): strict consent contract ──
    // A blocked recipient returns 403 with the block code (the shape Conversations.jsx
    // reads). This preserves the pre-Phase-B behaviour for the one path the live UI uses.
    // The `skip_compliance` escape hatch is gone (Wave -1 / F-2) — the gate always runs.
    if (!isMulti) {
      const participant = participants[0];
      const [contact] = await db.select('contacts', `id=eq.${participant.contact_id}`);
      const attemptCommand = {
        clientRequestId: foundationSchema ? client_request_id || null : null,
        conversationId: conversation_id,
        actorEmployeeId,
        recipientAddress: participant.phone,
        body: clientBody,
        mediaUrls: media_urls || [],
        provider,
        requestedChannel: media_urls?.length ? 'mms' : 'sms',
        foundationSchema,
        canonicalBody: rawBody,
        recipientContactId: participant.contact_id,
      };
      let priorAttempt;
      try {
        priorAttempt = await findMessageAttempt(db, attemptCommand);
      } catch (claimError) {
        if (claimError.code === 'CLIENT_REQUEST_CONFLICT') {
          return jsonResponse({ error: claimError.message, code: claimError.code }, 409, request, env);
        }
        throw claimError;
      }
      if (priorAttempt) {
        if (priorAttempt.message_id) {
          const [existingMessage] = await db.select(
            'messages',
            `id=eq.${priorAttempt.message_id}&select=*&limit=1`,
          );
          if (existingMessage) {
            return jsonResponse({
              success: true,
              message: existingMessage,
              twilio: [],
            }, 201, request, env);
          }
        }
        return jsonResponse({
          error: 'This message request is already being processed or reconciled',
          code: 'CLIENT_REQUEST_PENDING',
        }, 409, request, env);
      }
      const gate = await gateRecipient(db, contact, participant.phone, actorEmployeeId);
      if (gate.blocked) {
        return jsonResponse({
          error: gate.code === 'DND_ACTIVE'
            ? 'Message blocked: contact has Do Not Disturb enabled'
            : gate.code === 'NO_CONSENT'
              ? 'Message blocked: contact has not opted in to SMS'
              : gate.code === 'CONTACT_PHONE_MISMATCH'
                ? 'Message blocked: conversation phone does not match the consented contact phone'
              : 'Message blocked: could not resolve contact for compliance check',
          code: gate.code,
          contact_id: contact?.id ?? null,
        }, 403, request, env);
      }

      let claim;
      try {
        claim = await claimMessageAttempt(db, attemptCommand);
      } catch (claimError) {
        if (claimError.code === 'CLIENT_REQUEST_CONFLICT') {
          return jsonResponse({ error: claimError.message, code: claimError.code }, 409, request, env);
        }
        throw claimError;
      }

      if (!claim.claimed) {
        if (claim.attempt.message_id) {
          const [existingMessage] = await db.select(
            'messages',
            `id=eq.${claim.attempt.message_id}&select=*&limit=1`,
          );
          if (existingMessage) {
            return jsonResponse({ success: true, message: existingMessage, twilio: [] }, 201, request, env);
          }
        }
        return jsonResponse({
          error: 'This message request is already being processed or reconciled',
          code: 'CLIENT_REQUEST_PENDING',
        }, 409, request, env);
      }

      const { result, row } = await sendToRecipient(db, env, {
        conversationId: conversation_id,
        participant,
        clientBody,
        rawBody,
        mediaUrls: media_urls,
        statusCallback,
        sentBy: actorEmployeeId,
        provider,
        requestedChannel: attemptCommand.requestedChannel,
        foundationSchema,
        clientRequestId: client_request_id || null,
        attemptId: claim.attempt?.id || null,
      });
      await updateConversationAfterSend(db, conversation, rawBody);

      const payload = { success: true, message: row, twilio: [result] };
      if (result.error) { payload.error_code = result.error_code; payload.error_message = result.error_message; }
      return jsonResponse(payload, 201, request, env);
    }

    // ── GROUP / BROADCAST (multi recipient): tolerant per-participant loop ──
    // Consent-check EACH participant; a blocked one is skipped (never texted) and
    // audited; a per-recipient send failure records its own row. Nothing here can
    // text a DND/opted-out contact — the Wave -1 refuse-guard is replaced, not bypassed.
    const results = [];
    const eligibleParticipants = [];
    for (const participant of participants) {
      const [contact] = await db.select('contacts', `id=eq.${participant.contact_id}`);
      const gate = await gateRecipient(db, contact, participant.phone, actorEmployeeId);
      if (gate.blocked) {
        results.push({ skipped: true, code: gate.code, to: participant.phone, contact_id: participant.contact_id });
        continue;
      }
      eligibleParticipants.push(participant);
    }

    // Every recipient was blocked → nothing sent, no message or attempt written.
    if (eligibleParticipants.length === 0) {
      return jsonResponse({
        error: 'Message blocked: no recipient in this conversation is eligible to receive SMS',
        code: 'ALL_RECIPIENTS_BLOCKED',
        twilio: results,
      }, 403, request, env);
    }

    let groupClaim;
    try {
      groupClaim = await claimMessageAttempt(db, {
        clientRequestId: foundationSchema ? client_request_id || null : null,
        conversationId: conversation_id,
        actorEmployeeId,
        recipientAddress: eligibleParticipants
          .map((participant) => participant.phone || '')
          .sort()
          .join(','),
        body: clientBody,
        mediaUrls: media_urls || [],
        provider,
        requestedChannel: media_urls?.length ? 'mms' : 'sms',
        foundationSchema,
      });
    } catch (claimError) {
      if (claimError.code === 'CLIENT_REQUEST_CONFLICT') {
        return jsonResponse({ error: claimError.message, code: claimError.code }, 409, request, env);
      }
      throw claimError;
    }

    const rows = [];
    for (const participant of eligibleParticipants) {
      const childCommand = {
        clientRequestId: null,
        conversationId: conversation_id,
        actorEmployeeId,
        recipientAddress: participant.phone,
        recipientContactId: participant.contact_id,
        body: clientBody,
        canonicalBody: rawBody,
        mediaUrls: media_urls || [],
        provider,
        requestedChannel: media_urls?.length ? 'mms' : 'sms',
        foundationSchema,
        initialState: 'prepared',
      };
      let childClaim;
      if (foundationSchema && groupClaim.attempt?.id) {
        childClaim = await claimChildMessageAttempt(
          db,
          groupClaim.attempt.id,
          childCommand,
        );
        if (!childClaim.claimed && childClaim.attempt.message_id) {
          const [existingMessage] = await db.select(
            'messages',
            `id=eq.${childClaim.attempt.message_id}&select=*&limit=1`,
          );
          if (existingMessage) {
            rows.push(existingMessage);
            results.push({
              contact_id: participant.contact_id,
              to: participant.phone,
              recovered: true,
            });
            continue;
          }
        }
        if (
          !childClaim.claimed
          && childClaim.attempt.state !== 'prepared'
          && !childClaim.attempt.message_id
        ) {
          results.push({
            error: 'Recipient send is already being processed or reconciled',
            error_code: 'CLIENT_REQUEST_PENDING',
            error_message: 'Recipient send is already being processed or reconciled',
            to: participant.phone,
            contact_id: participant.contact_id,
          });
          continue;
        }
        const claimedRows = await db.rpc('claim_message_recipient_attempt', {
          p_attempt_id: childClaim.attempt.id,
        });
        const wonRecipientClaim = Array.isArray(claimedRows)
          ? claimedRows[0] === true
          : claimedRows === true;
        if (!wonRecipientClaim) {
          results.push({
            error: 'Recipient send is already being processed or reconciled',
            error_code: 'CLIENT_REQUEST_PENDING',
            error_message: 'Recipient send is already being processed or reconciled',
            to: participant.phone,
            contact_id: participant.contact_id,
          });
          continue;
        }
      }
      const { result, row } = await sendToRecipient(db, env, {
        conversationId: conversation_id,
        participant,
        clientBody,
        rawBody,
        mediaUrls: media_urls,
        statusCallback,
        sentBy: actorEmployeeId,
        provider,
        requestedChannel: media_urls?.length ? 'mms' : 'sms',
        foundationSchema,
        attemptId: childClaim?.attempt?.id || null,
      });
      results.push(result);
      rows.push(row);
    }

    const anyAccepted = results.some((result) => !result.skipped && !result.error);
    const anyAmbiguous = results.some((result) => (
      typeof result.error_code === 'string'
      && result.error_code.endsWith('_SEND_AMBIGUOUS')
    ));
    await completeMessageAttempt(db, groupClaim.attempt?.id || null, {
      state: anyAmbiguous ? 'ambiguous' : anyAccepted ? 'accepted' : 'failed',
      message_id: null,
      response_at: new Date().toISOString(),
      completed_at: anyAmbiguous ? null : new Date().toISOString(),
      reconcile_after: anyAmbiguous
        ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
        : null,
    });

    await updateConversationAfterSend(db, conversation, rawBody);

    // `message` = the first recorded row (index 0) for backward-compat with C.
    return jsonResponse({ success: true, message: rows[0], twilio: results }, 201, request, env);

  } catch (err) {
    console.error('send-message error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}
