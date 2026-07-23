/**
 * ════════════════════════════════════════════════
 * FILE: twilio-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is where a text FROM a customer lands. Twilio calls it for every inbound
 *   SMS/MMS. It figures out who texted, handles the legally-required opt-out words
 *   (STOP / START / HELP and their variants), saves the message into that person's
 *   conversation thread, and pings the assigned rep. Phase A hardened it:
 *     1. It verifies the call is really from Twilio using the current auth token
 *        from the Connections page (not just the old env var), so rotating the
 *        token can't silently break or spoof inbound.
 *     2. STOP now also catches "STOPALL", "STOP.", "Stop!" and similar, while a
 *        real sentence ("stop by tomorrow") is never mistaken for an opt-out.
 *     3. A real database error returns 500 so Twilio retries — we stop silently
 *        losing inbound texts. A duplicate (already-stored) text acks 200.
 *     4. The unread badge is bumped atomically and every call writes a worker_runs
 *        row for observability.
 *   The customer-facing auto-REPLY is conditional (see keywordReplyBody): OFF
 *   (default) we send our own CTIA-compliant confirmation; when Advanced Opt-Out
 *   is ON (env TWILIO_ADVANCED_OPT_OUT='true') Twilio owns the reply and we return
 *   empty TwiML. The DB opt-in/DND update + sms_consent_log audit run regardless.
 *
 * WHERE IT LIVES:
 *   ENDPOINT: POST /api/twilio-webhook  (Twilio inbound webhook — public,
 *             authenticated by the X-Twilio-Signature HMAC, not a session)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ../lib/supabase.js (service-role REST client),
 *              ../lib/twilio.js (validateTwilioSignature),
 *              ../lib/credentials.js (resolveCredential — DB-first auth token),
 *              ../lib/phone.js (normalizePhone), ../lib/cors.js, ./notify.js
 *   Data:      reads  → contacts, conversation_participants, conversations,
 *                       integration_credentials
 *              writes → contacts (opt-in/DND on STOP/START), conversations,
 *                       conversation_participants, messages, sms_consent_log,
 *                       worker_runs; unread bump via increment_conversation_unread
 *
 * NOTES / GOTCHAS:
 *   - F-3: STOP/START match every stored phone format (digits-OR) and update ALL
 *     matching rows (id=in.(…)), so an opt-out can't leave a duplicate row opted-in.
 *   - F-7: "yes"/"info" double as real replies — they are persisted BEFORE the
 *     keyword early-return so a genuine message is never swallowed.
 *   - F-9: a transient DB error returns 500 (Twilio retries); a duplicate
 *     twilio_sid returns 200 (already processed). See isDuplicateSidError.
 *   - F-13: the auth token is resolved DB-first (Connections page) with an env
 *     fallback, so a token rotation never silently kills inbound.
 *   - The message insert follows the F-core-frozen column shape (channel:'sms').
 *   - The notify hook is fire-and-forget (context.waitUntil) — it can never break
 *     the SMS-ingest path.
 * ════════════════════════════════════════════════
 */

import { supabase } from '../lib/supabase.js';
import { validateTwilioSignature } from '../lib/twilio.js';
import { resolveCredential } from '../lib/credentials.js';
import { handleOptions } from '../lib/cors.js';
import {
  buildPhoneOrFilter,
  detectKeyword,
  isAmbiguousContentReply,
  keywordReplyBody,
} from '../lib/messaging-inbound.js';
import { notifyInboundMessage } from '../lib/messaging-inbound-notifications.js';
import { dispatchEvent } from './notify.js';

export {
  buildPhoneOrFilter,
  detectKeyword,
  isAmbiguousContentReply,
  keywordReplyBody,
  normalizeKeyword,
  phoneMatchVariants,
} from '../lib/messaging-inbound.js';
export { notifyInboundMessage } from '../lib/messaging-inbound-notifications.js';

const WORKER_NAME = 'twilio-webhook';

// A retried inbound whose MessageSid we already stored trips the messages
// UNIQUE(twilio_sid) constraint — that is a duplicate no-op, not a failure:
// ack it 200 so Twilio stops retrying. Any OTHER DB error returns 500 so Twilio
// retries and the inbound is never silently lost (F-9).
export function isDuplicateSidError(err) {
  return /409|duplicate key|messages_twilio_sid_key/i.test(String(err?.message || err));
}

// worker_runs telemetry — one row per invocation; never let it break the path.
async function recordRun(db, { status, processed, errorMessage, startedAt }) {
  try {
    await db.insert('worker_runs', {
      worker_name: WORKER_NAME,
      status,
      records_processed: processed,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
  } catch { /* telemetry is best-effort */ }
}

// ── message.inbound notification hook (Notification Center, Session B) ──
// Additive + fire-and-forget: hands the just-saved inbound message to the shared
// dispatcher as a `message.inbound` event. Audience = the conversation's assigned
// rep when set, otherwise the office/admin fallback (resolved inside notify.js).
// INERT until the catalog type is enabled (dispatchEvent returns {skipped}), and
// wrapped so a notify hiccup can NEVER break the SMS-ingest business path.
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);
  const startedAt = new Date().toISOString();

  // ── 1. Validate Twilio signature (DB-first auth token — F-13) ──
  // Resolve the token from the Connections page first, env fallback, so rotating
  // it via the admin UI does not silently break (or spoof-open) inbound.
  let authToken = null;
  try {
    ({ authToken } = await resolveCredential(env, db, 'twilio'));
  } catch { authToken = env.TWILIO_AUTH_TOKEN || null; }

  if (!authToken) {
    console.warn('twilio-webhook: no Twilio auth token configured — rejecting (fail closed)');
    await recordRun(db, { status: 'error', processed: 0, errorMessage: 'no auth token', startedAt });
    return new Response('Twilio auth token not configured', { status: 500 });
  }
  const isValid = await validateTwilioSignature(request, authToken, request.url);
  if (!isValid) {
    await recordRun(db, { status: 'error', processed: 0, errorMessage: 'invalid signature', startedAt });
    return new Response('Forbidden', { status: 403 });
  }

  try {

    // Parse Twilio webhook payload (application/x-www-form-urlencoded)
    const formData = await request.formData();
    const from = formData.get('From');         // +1XXXXXXXXXX
    const to = formData.get('To');             // Your Twilio number
    const body = formData.get('Body') || '';
    const messageSid = formData.get('MessageSid');
    const numMedia = parseInt(formData.get('NumMedia') || '0', 10);

    if (!from || !messageSid) {
      await recordRun(db, { status: 'completed', processed: 0, startedAt });
      return twimlResponse('');  // Empty TwiML = no auto-reply
    }

    // Count of inbound messages actually persisted this run (telemetry).
    let stored = 0;

    // Collect media URLs if MMS
    const mediaUrls = [];
    for (let i = 0; i < numMedia; i++) {
      const url = formData.get(`MediaUrl${i}`);
      if (url) mediaUrls.push(url);
    }

    // ── 2. Find or create contact (digits-OR match — F-3) ──
    // Match every common stored format of the number, not just an exact E.164
    // string, so STOP/START update the REAL contact row(s) instead of creating a
    // duplicate opted-out row while the original stays opted-in (a send-after-STOP
    // TCPA hole). A number stored more than once → all rows are updated together.
    let phoneMatches = await db.select('contacts', `${buildPhoneOrFilter(from)}&order=created_at.asc`);
    let contact = phoneMatches[0] || null;

    if (!contact) {
      // Auto-create contact from inbound message
      [contact] = await db.insert('contacts', {
        phone: from,
        name: null,
        opt_in_status: true,          // Inbound message = implied consent (they texted us first)
        opt_in_source: 'inbound_sms',
        opt_in_at: new Date().toISOString(),
      });
      phoneMatches = [contact];

      // Log the implied consent
      await db.insert('sms_consent_log', {
        contact_id: contact.id,
        phone: from,
        event_type: 'opt_in',
        source: 'inbound_sms',
        details: 'Implied consent: contact initiated conversation via SMS.',
      });
    }

    // ── 3. Check for compliance keywords ──
    const keyword = detectKeyword(body);
    // When Advanced Opt-Out is enabled on the Twilio Messaging Service, Twilio
    // owns the STOP/START/HELP replies — we then log only and return empty TwiML.
    // Safe default (unset): the webhook sends its own reply, so a plain number
    // still gets a CTIA-compliant confirmation. Owner sets this true only after
    // enabling Advanced Opt-Out in the Twilio console.
    const advancedOptOut = env.TWILIO_ADVANCED_OPT_OUT === 'true';
    const matchIds = phoneMatches.map((c) => c.id);

    // F-7: "yes" (START) / "info" (HELP) are also real customer replies. Persist
    // the inbound message BEFORE the keyword early-return so it is never swallowed;
    // the keyword action below still runs.
    if (keyword && isAmbiguousContentReply(body)) {
      await persistInboundMessage(context, db, env, { contact, from, to, body, messageSid, mediaUrls });
      stored = 1;
    }

    if (keyword === 'stop') {
      // ── STOP: Immediately opt out + DND on ALL matching rows (F-3) ──
      await db.update('contacts', `id=in.(${matchIds.join(',')})`, {
        opt_in_status: false,
        opt_out_at: new Date().toISOString(),
        opt_out_reason: 'stop_keyword',
        dnd: true,
        dnd_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await db.insert('sms_consent_log', phoneMatches.map((c) => ({
        contact_id: c.id,
        phone: c.phone || from,
        event_type: 'stop_keyword',
        source: 'keyword',
        details: `Contact texted "${body.trim()}". Opted out and DND enabled.`,
      })));

      await recordRun(db, { status: 'completed', processed: stored, startedAt });
      return twimlResponse(keywordReplyBody('stop', { advancedOptOut }));
    }

    if (keyword === 'start') {
      // ── START: Re-subscribe ALL matching rows (F-3) ──
      await db.update('contacts', `id=in.(${matchIds.join(',')})`, {
        opt_in_status: true,
        opt_in_source: 'start_keyword',
        opt_in_at: new Date().toISOString(),
        opt_out_at: null,
        opt_out_reason: null,
        dnd: false,
        dnd_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await db.insert('sms_consent_log', phoneMatches.map((c) => ({
        contact_id: c.id,
        phone: c.phone || from,
        event_type: 'start_keyword',
        source: 'keyword',
        details: `Contact texted "${body.trim()}". Re-subscribed and DND disabled.`,
      })));

      await recordRun(db, { status: 'completed', processed: stored, startedAt });
      return twimlResponse(keywordReplyBody('start', { advancedOptOut }));
    }

    if (keyword === 'help') {
      // ── HELP: Required by CTIA — must include company name + support contact ──
      await db.insert('sms_consent_log', {
        contact_id: contact.id,
        phone: from,
        event_type: 'help_request',
        source: 'keyword',
        details: `Contact texted "${body.trim()}".`,
      });

      await recordRun(db, { status: 'completed', processed: stored, startedAt });
      return twimlResponse(keywordReplyBody('help', { advancedOptOut }));
    }

    // ── 4-7. Normal inbound message: persist into its conversation + notify ──
    await persistInboundMessage(context, db, env, { contact, from, to, body, messageSid, mediaUrls });
    stored = 1;

    // ── 8. Run automation rules (future) ──
    // TODO: Check automation_rules for matching triggers and execute actions

    // Return empty TwiML (no auto-reply for normal messages)
    await recordRun(db, { status: 'completed', processed: stored, startedAt });
    return twimlResponse('');

  } catch (err) {
    // A duplicate MessageSid means Twilio retried something we already stored —
    // ack it 200 so it stops. Every other error returns 500 so Twilio retries
    // and the inbound is never silently lost (F-9).
    if (isDuplicateSidError(err)) {
      await recordRun(db, { status: 'completed', processed: 0, startedAt });
      return twimlResponse('');
    }
    console.error('twilio-webhook error:', err);
    await recordRun(db, { status: 'error', processed: 0, errorMessage: err.message, startedAt });
    return new Response('Server error — retry', { status: 500 });
  }
}

// ── Persist an inbound message into its conversation ──
// Find-or-create the per-contact conversation, insert the message row, bump the
// conversation metadata, and fire the (background) notify hook. Extracted so the
// F-7 "yes"/"info" path can store the message BEFORE the keyword early-return
// without duplicating the normal-message path.
async function persistInboundMessage(context, db, env, { contact, from, to, body, messageSid, mediaUrls }) {
  // Find existing active conversation for this contact
  let conversation = null;
  const existingParticipants = await db.select(
    'conversation_participants',
    `contact_id=eq.${contact.id}&is_active=eq.true&select=conversation_id`
  );

  if (existingParticipants.length > 0) {
    const convId = existingParticipants[0].conversation_id;
    const [existing] = await db.select('conversations', `id=eq.${convId}`);
    if (existing) conversation = existing;
  }

  if (!conversation) {
    const title = contact.name || from;
    [conversation] = await db.insert('conversations', {
      type: 'direct',
      title,
      status: 'needs_response',
      twilio_number: to,
    });

    await db.insert('conversation_participants', {
      conversation_id: conversation.id,
      contact_id: contact.id,
      phone: from,
      role: 'primary',
    });
  }

  await db.insert('messages', {
    conversation_id: conversation.id,
    type: 'sms_inbound',
    channel: 'sms',
    body: body.trim() || null,
    status: 'received',
    twilio_sid: messageSid,
    sender_phone: from,
    sender_contact_id: contact.id,
    media_urls: mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
  });

  await db.update('conversations', `id=eq.${conversation.id}`, {
    status: 'needs_response',
    status_changed_at: new Date().toISOString(),
    last_message_at: new Date().toISOString(),
    last_message_preview: (body.trim() || '[Media]').substring(0, 100),
    updated_at: new Date().toISOString(),
  });

  // Atomic unread bump (F-core contract) — replaces a read-modify-write +1 that
  // could lose a count when two inbound messages land together.
  await db.rpc('increment_conversation_unread', { p_conversation_id: conversation.id, p_by: 1 });

  // Fire-and-forget so Twilio still gets its TwiML instantly.
  context.waitUntil(notifyInboundMessage({
    db,
    env,
    conversation,
    contact,
    from,
    text: body,
    dispatchImpl: dispatchEvent,
  }));

  return conversation;
}

// ── TwiML response helper ──
function twimlResponse(messageBody) {
  const twiml = messageBody
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(messageBody)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
