/**
 * ════════════════════════════════════════════════
 * FILE: send-message.js  (POST /api/send-message)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is the single door every staff-typed text message goes through before it
 *   leaves the building. It looks up who the message is going to, checks each
 *   recipient's permission (Do-Not-Disturb off, opted-in) one person at a time, and
 *   only then hands the text to Twilio. It writes one message record per recipient
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
 *   Data:      reads  → conversations, conversation_participants, contacts, employees
 *              writes → messages, sms_consent_log, conversations
 *
 * Request body:
 *   { conversation_id: uuid, body: string, sent_by: uuid (employee id),
 *     media_urls?: string[], is_internal_note?: boolean }
 *
 * NOTES / GOTCHAS:
 *   - COMPLIANCE, NO BYPASS: the DND + opt-in gate runs for EVERY recipient (TCPA:
 *     consent before send; CTIA: DND/opt-out honored; 10DLC: sender name prefixed,
 *     status callback set). There is NO `skip_compliance` flag (removed Wave -1 /
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
import { sendMessage } from '../lib/messaging-transport.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

// Verify the caller is an authenticated UPR user before sending SMS on the
// company Twilio account. Without this, anyone who knows the URL could send
// messages (cost + spam/reputation risk).
async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return { error: 'Missing Authorization header', status: 401 };
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Invalid or expired token', status: 401 };
  return { ok: true };
}

// ─── SECTION: Helpers ───────────────────────────────────────────────────────

// Run the per-recipient consent gate. Returns { blocked, code } and, when a
// resolved contact is blocked, writes the audit row to sms_consent_log. Fails
// CLOSED: a missing contact (dangling/forged participant) is a block, not a send.
async function gateRecipient(db, contact, sentBy) {
  if (!contact) return { blocked: true, code: 'CONTACT_NOT_FOUND' };

  // CHECK 1: DND — Twilio can suspend accounts that message DND contacts.
  if (contact.dnd) {
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

  // CHECK 2: Opt-in — TCPA requires prior express consent for business texts.
  if (!contact.opt_in_status) {
    await db.insert('sms_consent_log', {
      contact_id: contact.id,
      phone: contact.phone,
      event_type: 'send_blocked_no_consent',
      source: 'system',
      details: `Outbound blocked: opt_in_status is false. ${contact.opt_out_reason ? 'Opt-out reason: ' + contact.opt_out_reason : 'Never opted in.'}`,
      performed_by: sentBy,
    });
    return { blocked: true, code: 'NO_CONSENT' };
  }

  return { blocked: false };
}

// Send to ONE already-consent-cleared recipient and record its own messages row.
// Never throws — a transport failure (or a missing SMS destination, which we refuse
// rather than retarget) is captured as a `failed` row so it is visible, not lost.
// The worker is the sole writer of this row (omni §7.1).
async function sendToRecipient(db, env, { conversationId, participant, clientBody, rawBody, mediaUrls, statusCallback, sentBy }) {
  let twilioResult = null;
  let error = null;

  if (!participant.phone) {
    // No valid SMS destination → refuse (omni §7.3: never cross-channel fallback).
    error = new Error('No phone number for recipient');
  } else {
    try {
      twilioResult = await sendMessage(env, {
        to: participant.phone,
        body: clientBody,
        mediaUrls,
        statusCallback,
      });
    } catch (err) {
      error = err;
    }
  }

  const sid = twilioResult?.sid || null;
  const errorCode = error?.code != null ? String(error.code) : null;
  const errorMessage = error?.message || null;

  const [row] = await db.insert('messages', {
    conversation_id: conversationId,
    type: 'sms_outbound',
    body: rawBody,
    channel: mediaUrls?.length > 0 ? 'mms' : 'sms',
    status: sid ? 'queued' : 'failed',
    twilio_sid: sid,
    sent_by: sentBy,
    media_urls: mediaUrls?.length > 0 ? JSON.stringify(mediaUrls) : null,
    error_code: errorCode,
    error_message: errorMessage,
    // num_segments / price: intentionally NULL — Phase A fills them from the
    // Twilio status callback (contract §9.2).
  });

  // The per-recipient result surfaced on the response (error_code/error_message
  // are additive to the frozen contract — never removed/renamed).
  const result = sid
    ? { ...twilioResult, contact_id: participant.contact_id }
    : { error: errorMessage, error_code: errorCode, error_message: errorMessage, to: participant.phone, contact_id: participant.contact_id };

  return { result, row, sent: !!sid };
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

  // Verify caller is authenticated before any send/compliance work.
  const auth = await requireAuth(request, env);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status, request, env);

  try {
    const { conversation_id, body, sent_by, media_urls, is_internal_note } = await request.json();

    // A photo can go with no caption (media-only MMS); a text or note still needs a body.
    const hasMedia = Array.isArray(media_urls) && media_urls.length > 0;
    if (!conversation_id || (!body?.trim() && !(hasMedia && !is_internal_note))) {
      return jsonResponse({ error: 'conversation_id and a message body or media are required' }, 400, request, env);
    }

    const rawBody = (body || '').trim();

    // ═══ INTERNAL NOTE: just insert, no Twilio, no compliance needed ═══
    // channel stays NULL (a note has no transport) — it is physically unsendable.
    if (is_internal_note) {
      const [note] = await db.insert('messages', {
        conversation_id,
        type: 'internal_note',
        body: rawBody,
        status: 'received',
        sent_by,
      });

      await db.update('conversations', `id=eq.${conversation_id}`, {
        last_message_at: new Date().toISOString(),
        last_message_preview: `[Note] ${rawBody.substring(0, 80)}`,
        updated_at: new Date().toISOString(),
      });

      return jsonResponse({ success: true, message: note, type: 'internal_note' }, 201, request, env);
    }

    // ═══ OUTBOUND MESSAGE ═══

    // 1. Load conversation + active participants.
    const [conversation] = await db.select('conversations', `id=eq.${conversation_id}`);
    if (!conversation) {
      return jsonResponse({ error: 'Conversation not found' }, 404, request, env);
    }

    const participants = await db.select(
      'conversation_participants',
      `conversation_id=eq.${conversation_id}&is_active=eq.true`
    );

    if (participants.length === 0) {
      return jsonResponse({ error: 'No active participants in conversation' }, 400, request, env);
    }

    const isMulti = conversation.type === 'group' || conversation.type === 'broadcast';

    // 2. Sender prefix (Twilio/CTIA requires identifying the business in messages).
    let senderPrefix = '';
    if (sent_by) {
      const [employee] = await db.select('employees', `id=eq.${sent_by}`);
      if (employee?.full_name) senderPrefix = `${employee.full_name}: `;
    }
    // Media-only send: drop the dangling "Name: " colon so the MMS carries just the
    // sender's name (CTIA identification) with the photo, not "Jane: " + nothing.
    const clientBody = rawBody ? senderPrefix + rawBody : senderPrefix.replace(/:\s*$/, '');

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
      const gate = await gateRecipient(db, contact, sent_by);
      if (gate.blocked) {
        return jsonResponse({
          error: gate.code === 'DND_ACTIVE'
            ? 'Message blocked: contact has Do Not Disturb enabled'
            : gate.code === 'NO_CONSENT'
              ? 'Message blocked: contact has not opted in to SMS'
              : 'Message blocked: could not resolve contact for compliance check',
          code: gate.code,
          contact_id: contact?.id ?? null,
        }, 403, request, env);
      }

      const { result, row } = await sendToRecipient(db, env, {
        conversationId: conversation_id, participant, clientBody, rawBody, mediaUrls: media_urls, statusCallback, sentBy: sent_by,
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
    const rows = [];
    for (const participant of participants) {
      const [contact] = await db.select('contacts', `id=eq.${participant.contact_id}`);
      const gate = await gateRecipient(db, contact, sent_by);
      if (gate.blocked) {
        results.push({ skipped: true, code: gate.code, to: participant.phone, contact_id: participant.contact_id });
        continue;
      }
      const { result, row } = await sendToRecipient(db, env, {
        conversationId: conversation_id, participant, clientBody, rawBody, mediaUrls: media_urls, statusCallback, sentBy: sent_by,
      });
      results.push(result);
      rows.push(row);
    }

    // Every recipient was blocked → nothing sent, no message written.
    if (rows.length === 0) {
      return jsonResponse({
        error: 'Message blocked: no recipient in this conversation is eligible to receive SMS',
        code: 'ALL_RECIPIENTS_BLOCKED',
        twilio: results,
      }, 403, request, env);
    }

    await updateConversationAfterSend(db, conversation, rawBody);

    // `message` = the first recorded row (index 0) for backward-compat with C.
    return jsonResponse({ success: true, message: rows[0], twilio: results }, 201, request, env);

  } catch (err) {
    console.error('send-message error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}
