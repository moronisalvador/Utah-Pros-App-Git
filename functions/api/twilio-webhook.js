// POST /api/twilio-webhook
// Receives inbound SMS/MMS from Twilio.
//
// COMPLIANCE: Handles STOP/HELP/START keywords per CTIA guidelines.
// We ALWAYS update our own state here:
//   1. Updating our database (contacts.opt_in_status, contacts.dnd)
//   2. Logging to sms_consent_log (audit trail for TCPA)
// The customer-facing REPLY is conditional (see keywordReplyBody):
//   - Advanced Opt-Out OFF (default): we reply with a CTIA-compliant STOP/HELP
//     confirmation carrying UPR's SMS support contact.
//   - Advanced Opt-Out ON (env TWILIO_ADVANCED_OPT_OUT='true'): Twilio's
//     messaging service owns the reply, so we return empty TwiML (no double-text).
//
// Flow:
//   1. Validate Twilio signature (prevents spoofed webhooks)
//   2. Check for compliance keywords (STOP/HELP/START)
//   3. Find or create contact
//   4. Find or create conversation
//   5. Insert message
//   6. Update conversation metadata
//   7. Run automation rules

import { supabase } from '../lib/supabase.js';
import { validateTwilioSignature } from '../lib/twilio.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { dispatchEvent } from './notify.js';

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
// CTIA requires handling these exact keywords (case-insensitive)
const STOP_KEYWORDS = ['stop', 'unsubscribe', 'cancel', 'end', 'quit'];
const START_KEYWORDS = ['start', 'unstop', 'subscribe', 'yes'];
const HELP_KEYWORDS = ['help', 'info'];

export function detectKeyword(body) {
  const trimmed = (body || '').trim().toLowerCase();
  if (STOP_KEYWORDS.includes(trimmed)) return 'stop';
  if (START_KEYWORDS.includes(trimmed)) return 'start';
  if (HELP_KEYWORDS.includes(trimmed)) return 'help';
  return null;
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

  try {
    // ── 1. Validate Twilio signature ──
    // Skip validation if auth token not configured (dev/testing)
    if (!env.TWILIO_AUTH_TOKEN) {
      console.warn('TWILIO_AUTH_TOKEN not configured — rejecting webhook (fail closed)');
      return new Response('Twilio auth token not configured', { status: 500 });
    }
    const isValid = await validateTwilioSignature(request, env.TWILIO_AUTH_TOKEN, request.url);
    if (!isValid) {
      return new Response('Forbidden', { status: 403 });
    }

    // Parse Twilio webhook payload (application/x-www-form-urlencoded)
    const formData = await request.formData();
    const from = formData.get('From');         // +1XXXXXXXXXX
    const to = formData.get('To');             // Your Twilio number
    const body = formData.get('Body') || '';
    const messageSid = formData.get('MessageSid');
    const numMedia = parseInt(formData.get('NumMedia') || '0', 10);

    if (!from || !messageSid) {
      return twimlResponse('');  // Empty TwiML = no auto-reply
    }

    // Collect media URLs if MMS
    const mediaUrls = [];
    for (let i = 0; i < numMedia; i++) {
      const url = formData.get(`MediaUrl${i}`);
      if (url) mediaUrls.push(url);
    }

    // ── 2. Find or create contact ──
    let [contact] = await db.select('contacts', `phone=eq.${encodeURIComponent(from)}&limit=1`);

    if (!contact) {
      // Auto-create contact from inbound message
      [contact] = await db.insert('contacts', {
        phone: from,
        name: null,
        opt_in_status: true,          // Inbound message = implied consent (they texted us first)
        opt_in_source: 'inbound_sms',
        opt_in_at: new Date().toISOString(),
      });

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

    if (keyword === 'stop') {
      // ── STOP: Immediately opt out + DND ──
      await db.update('contacts', `id=eq.${contact.id}`, {
        opt_in_status: false,
        opt_out_at: new Date().toISOString(),
        opt_out_reason: 'stop_keyword',
        dnd: true,
        dnd_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await db.insert('sms_consent_log', {
        contact_id: contact.id,
        phone: from,
        event_type: 'stop_keyword',
        source: 'keyword',
        details: `Contact texted "${body.trim()}". Opted out and DND enabled.`,
      });

      return twimlResponse(keywordReplyBody('stop', { advancedOptOut }));
    }

    if (keyword === 'start') {
      // ── START: Re-subscribe ──
      await db.update('contacts', `id=eq.${contact.id}`, {
        opt_in_status: true,
        opt_in_source: 'start_keyword',
        opt_in_at: new Date().toISOString(),
        opt_out_at: null,
        opt_out_reason: null,
        dnd: false,
        dnd_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await db.insert('sms_consent_log', {
        contact_id: contact.id,
        phone: from,
        event_type: 'start_keyword',
        source: 'keyword',
        details: `Contact texted "${body.trim()}". Re-subscribed and DND disabled.`,
      });

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

      return twimlResponse(keywordReplyBody('help', { advancedOptOut }));
    }

    // ── 4. Find or create conversation ──
    // Look for existing active conversation with this contact
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
      // Create new conversation
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

    // ── 5. Insert inbound message ──
    const [message] = await db.insert('messages', {
      conversation_id: conversation.id,
      type: 'sms_inbound',
      body: body.trim() || null,
      status: 'received',
      twilio_sid: messageSid,
      sender_phone: from,
      sender_contact_id: contact.id,
      media_urls: mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
    });

    // ── 6. Update conversation ──
    await db.update('conversations', `id=eq.${conversation.id}`, {
      status: 'needs_response',
      status_changed_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
      last_message_preview: (body.trim() || '[Media]').substring(0, 100),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    });

    // ── 7. Notify the assigned rep / office of the inbound message ──
    // Fire-and-forget in the background so Twilio still gets its TwiML instantly.
    context.waitUntil(notifyInboundMessage({ db, env, conversation, contact, from, text: body }));

    // ── 8. Run automation rules (future) ──
    // TODO: Check automation_rules for matching triggers and execute actions

    // Return empty TwiML (no auto-reply for normal messages)
    return twimlResponse('');

  } catch (err) {
    console.error('twilio-webhook error:', err);
    // Still return 200 to Twilio so it doesn't retry
    return twimlResponse('');
  }
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
