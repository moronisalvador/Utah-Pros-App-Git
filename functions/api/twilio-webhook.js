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
import { normalizePhone } from '../lib/phone.js';
import { dispatchEvent } from './notify.js';

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
export async function notifyInboundMessage({ db, env, conversation, contact, from, text, dispatchImpl = dispatchEvent }) {
  try {
    const assignedTo = conversation?.assigned_to || null;
    const who = (contact?.name && String(contact.name).trim()) || from;
    const preview = (text || '').trim().slice(0, 140);
    await dispatchImpl({
      db, env,
      typeKey: 'message.inbound',
      body: {
        title: `New text from ${who}`,
        body: preview || '[Media]',
        link: '/conversations',
        entity_type: 'conversation',
        entity_id: conversation?.id || null,
        // Assigned rep wins; unassigned falls back to ROLE_AUDIENCE (office/admin).
        recipient_ids: assignedTo ? [assignedTo] : undefined,
        data: { conversation_id: conversation?.id || null, route: '/conversations' },
      },
    });
  } catch { /* fire-and-forget — a notify failure never breaks SMS ingest */ }
}

// ── STOP/HELP/START keyword detection ──
// CTIA/carrier requires handling these exact keywords (case-insensitive).
// STOPALL is on Twilio's default opt-out keyword list alongside STOP.
const STOP_KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];
const START_KEYWORDS = ['start', 'unstop', 'subscribe', 'yes'];
const HELP_KEYWORDS = ['help', 'info'];

// Punctuation tolerance: strip everything but a–z/0–9 so "STOP.", "Stop!",
// "STOP ALL" and "s.t.o.p" all resolve to their keyword, while a real sentence
// ("stop by tomorrow" → "stopbytomorrow") stays a non-match — only a lone
// keyword token collapses onto an entry in the lists above.
export function normalizeKeyword(body) {
  return (body || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function detectKeyword(body) {
  const norm = normalizeKeyword(body);
  if (!norm) return null;
  if (STOP_KEYWORDS.includes(norm)) return 'stop';
  if (START_KEYWORDS.includes(norm)) return 'start';
  if (HELP_KEYWORDS.includes(norm)) return 'help';
  return null;
}

// ── F-3: digits-based contact lookup ──
// The webhook used to resolve the inbound sender with an exact `phone=eq.{from}`.
// A contact stored in a non-E.164 form (e.g. "(801) 919-6858") never matched, so
// a STOP created a *duplicate* opted-out row while the original stayed opted-in —
// a send-after-STOP TCPA hole. We now match against every common stored format of
// the number. Twilio always sends E.164, but this is format-agnostic on both sides.
export function phoneMatchVariants(rawFrom) {
  const e164 = normalizePhone(rawFrom);
  if (!e164) return [];
  const ten = e164.slice(2); // strip the "+1"
  const a = ten.slice(0, 3), b = ten.slice(3, 6), c = ten.slice(6);
  return [
    e164,                    // +1XXXXXXXXXX  (E.164 — the live majority)
    ten,                     // XXXXXXXXXX    (bare 10-digit)
    '1' + ten,               // 1XXXXXXXXXX   (bare 11-digit)
    `(${a}) ${b}-${c}`,      // (XXX) XXX-XXXX (the live non-E.164 format)
    `${a}-${b}-${c}`,        // XXX-XXX-XXXX
    `${a}.${b}.${c}`,        // XXX.XXX.XXXX
  ];
}

// Build a PostgREST `or=(...)` filter matching a contact stored in ANY of the
// formats above. Each candidate is double-quoted (so parens/space/commas are
// literal) and URL-encoded (so "+" becomes %2B, never a decoded space). Falls
// back to an exact match for an unparseable sender (shortcode / junk).
export function buildPhoneOrFilter(rawFrom) {
  const variants = phoneMatchVariants(rawFrom);
  if (variants.length === 0) {
    return `phone=eq.${encodeURIComponent(rawFrom)}&limit=1`;
  }
  const enc = (v) => encodeURIComponent(`"${v}"`).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const conds = [...new Set(variants)].map((v) => `phone.eq.${enc(v)}`);
  return `or=(${conds.join(',')})`;
}

// ── F-7: "yes" and "info" double as real customer replies ──
// They live in the START/HELP keyword lists, so the webhook used to swallow them
// (act on the keyword, never store the message). For these ambiguous words we
// persist the inbound message BEFORE the keyword early-return so a genuine reply
// is never lost; the keyword action (re-subscribe / HELP reply) still runs after.
const AMBIGUOUS_CONTENT_KEYWORDS = ['yes', 'info'];
export function isAmbiguousContentReply(body) {
  return AMBIGUOUS_CONTENT_KEYWORDS.includes(normalizeKeyword(body));
}

// ── Compliance-keyword auto-reply copy ──
// Customer-facing SMS support contact — kept in sync with the published Privacy
// Policy (utahrestorationpros.com/privacy-policy). Carriers test the HELP reply.
const SMS_SUPPORT_PHONE = '(385) 336-0611';
const SMS_SUPPORT_EMAIL = 'restoration@utah-pros.com';

// The SMS body the webhook should auto-reply with for a STOP/START/HELP keyword.
// Returns '' when Advanced Opt-Out is enabled on the Twilio Messaging Service —
// in that mode Twilio sends its own STOP/HELP confirmation AND blocks messaging
// to opted-out numbers, so a second reply here would either double-text the
// recipient or be rejected post-STOP (Twilio error 21610). The DB opt-in/DND
// update + sms_consent_log audit run regardless of this value.
export function keywordReplyBody(keyword, { advancedOptOut = false } = {}) {
  if (advancedOptOut) return '';
  switch (keyword) {
    case 'stop':
      return 'You have been unsubscribed from Utah Pros Restoration messages. ' +
        'Reply START to re-subscribe. For help, reply HELP.';
    case 'start':
      return 'You have been re-subscribed to Utah Pros Restoration messages. ' +
        'Reply STOP to unsubscribe at any time.';
    case 'help':
      return 'Utah Pros Restoration — SMS Support\n' +
        `For help, call ${SMS_SUPPORT_PHONE} or email ${SMS_SUPPORT_EMAIL}.\n` +
        'Reply STOP to unsubscribe. Msg & data rates may apply.';
    default:
      return '';
  }
}

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
  context.waitUntil(notifyInboundMessage({ db, env, conversation, contact, from, text: body }));

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
