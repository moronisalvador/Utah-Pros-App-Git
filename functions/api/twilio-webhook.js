// POST /api/twilio-webhook
// Receives ALL inbound messages from Twilio
// Configured in Twilio Console: Number → Webhook URL → https://your-domain/api/twilio-webhook
//
// This is the most critical Worker — it's the entry point for every inbound text.

import { supabase } from '../lib/supabase.js';
import { validateTwilioSignature, parseTwilioWebhook, emptyTwimlResponse, sendMessage as twilioSend } from '../lib/twilio.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  try {
    // ── 1. VALIDATE TWILIO SIGNATURE ──
    // CRITICAL: Without this, anyone can POST fake messages to this endpoint
    const webhookUrl = `${env.PAGES_URL || `https://${request.headers.get('host')}`}/api/twilio-webhook`;
    const isValid = await validateTwilioSignature(request, env.TWILIO_AUTH_TOKEN, webhookUrl);

    if (!isValid) {
      console.error('Invalid Twilio signature — rejecting webhook');
      return new Response('Forbidden', { status: 403 });
    }

    // ── 2. PARSE INBOUND MESSAGE ──
    const formData = await request.formData();
    const msg = parseTwilioWebhook(formData);

    // Idempotency: check if we already processed this MessageSid
    const existing = await db.select('messages', `twilio_sid=eq.${msg.messageSid}`);
    if (existing.length > 0) {
      return emptyTwimlResponse(); // Already processed, skip
    }

    // ── 3. ROUTE TO CONVERSATION ──
    let conversation = null;
    let contact = null;
    let isNewContact = false;

    if (msg.addressSid) {
      // Group MMS — route by AddressSid
      const convos = await db.select('conversations', `twilio_group_sid=eq.${msg.addressSid}`);
      conversation = convos[0] || null;
    }

    if (!conversation) {
      // Direct message — find conversation by sender phone
      const participants = await db.select(
        'conversation_participants',
        `phone=eq.${encodeURIComponent(msg.from)}&is_active=eq.true&select=conversation_id,contact_id`
      );

      if (participants.length > 0) {
        // Find the most recent direct conversation for this participant
        for (const p of participants) {
          const convos = await db.select(
            'conversations',
            `id=eq.${p.conversation_id}&type=eq.direct&order=last_message_at.desc&limit=1`
          );
          if (convos[0]) {
            conversation = convos[0];
            break;
          }
        }
      }
    }

    // ── 4. FIND OR CREATE CONTACT ──
    const contacts = await db.select('contacts', `phone=eq.${encodeURIComponent(msg.from)}`);
    if (contacts[0]) {
      contact = contacts[0];
    } else {
      // New unknown number — create contact
      isNewContact = true;
      const [newContact] = await db.insert('contacts', {
        phone: msg.from,
        name: null, // Unknown — team will fill in
        role: 'other',
        opt_in_status: false, // Needs manual opt-in confirmation
      });
      contact = newContact;
    }

    // ── 5. CREATE CONVERSATION IF NEW ──
    if (!conversation) {
      const [newConv] = await db.insert('conversations', {
        type: 'direct',
        title: contact.name || msg.from,
        status: 'needs_response',
        status_changed_at: new Date().toISOString(),
        twilio_number: msg.to,
        twilio_group_sid: msg.addressSid || null,
      });
      conversation = newConv;

      // Add participant
      await db.insert('conversation_participants', {
        conversation_id: conversation.id,
        contact_id: contact.id,
        phone: msg.from,
        role: contact.role,
      });
    }

    // ── 6. INSERT MESSAGE ──
    const [message] = await db.insert('messages', {
      conversation_id: conversation.id,
      type: 'sms_inbound',
      body: msg.body,
      channel: msg.channelPrefix === 'rcs' ? 'rcs' : (msg.numMedia > 0 ? 'mms' : 'sms'),
      status: 'received',
      twilio_sid: msg.messageSid,
      sender_phone: msg.from,
      sender_contact_id: contact.id,
      media_urls: msg.mediaUrls.length > 0 ? JSON.stringify(msg.mediaUrls) : null,
    });

    // ── 7. UPDATE CONVERSATION ──
    await db.update('conversations', `id=eq.${conversation.id}`, {
      last_message_at: new Date().toISOString(),
      last_message_preview: msg.body?.substring(0, 100) || '[Media]',
      status: 'needs_response',
      status_changed_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      // Clear first_response_at so we track the next team response time
      first_response_at: null,
      updated_at: new Date().toISOString(),
    });

    // ── 8. EVALUATE AUTOMATION RULES ──
    // Fetch active rules ordered by priority
    try {
      const rules = await db.select('automation_rules', 'is_active=eq.true&order=priority.asc');

      for (const rule of rules) {
        const triggered = await evaluateRule(rule, {
          message: msg,
          conversation,
          contact,
          isNewContact,
          env,
        });
        if (triggered) break; // First match wins (unless multi-match is configured later)
      }
    } catch (ruleErr) {
      // Automation failures should not block message processing
      console.error('Automation rule error:', ruleErr);
    }

    // ── 9. RETURN EMPTY TWIML ──
    return emptyTwimlResponse();

  } catch (err) {
    console.error('twilio-webhook error:', err);
    // Still return TwiML so Twilio doesn't retry
    return emptyTwimlResponse();
  }
}

/**
 * Evaluate a single automation rule against the inbound message context
 */
async function evaluateRule(rule, ctx) {
  const { message, conversation, contact, isNewContact, env } = ctx;
  const config = rule.trigger_config || {};

  let shouldFire = false;

  switch (rule.trigger_type) {
    case 'keyword': {
      const keywords = config.keywords || [];
      const bodyLower = (message.body || '').toLowerCase();
      shouldFire = keywords.some(kw => bodyLower.includes(kw.toLowerCase()));
      break;
    }

    case 'after_hours': {
      // Check if current time (Mountain) is outside business hours
      const now = new Date();
      // Convert to Mountain Time (UTC-7 or UTC-6 for DST)
      const mt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Denver' }));
      const hour = mt.getHours();
      const startHour = parseInt(config.start_hour || '18', 10); // 6 PM
      const endHour = parseInt(config.end_hour || '8', 10);       // 8 AM
      shouldFire = hour >= startHour || hour < endHour;
      break;
    }

    case 'new_contact':
      shouldFire = isNewContact;
      break;

    case 'first_message': {
      // First message in this conversation from this contact
      const db = supabase(env);
      const prior = await db.select(
        'messages',
        `conversation_id=eq.${conversation.id}&type=eq.sms_inbound&limit=2`
      );
      shouldFire = prior.length <= 1; // Only the message we just inserted
      break;
    }

    default:
      shouldFire = false;
  }

  if (!shouldFire) return false;

  // Execute the action
  await executeAction(rule, ctx);
  return true;
}

/**
 * Execute an automation action
 */
async function executeAction(rule, ctx) {
  const { message, conversation, env } = ctx;
  const config = rule.action_config || {};
  const db = supabase(env);

  switch (rule.action_type) {
    case 'auto_reply': {
      const replyBody = config.message || config.template_body || '';
      if (!replyBody) return;

      // Get the conversation's Twilio number
      const from = conversation.twilio_number || env.TWILIO_PHONE_NUMBER;

      // Send auto-reply via Twilio
      const result = await twilioSend(env, {
        to: message.from,
        body: replyBody,
      });

      // Log the auto-reply as a message
      await db.insert('messages', {
        conversation_id: conversation.id,
        type: 'sms_outbound',
        body: replyBody,
        status: result.sid ? 'queued' : 'failed',
        twilio_sid: result.sid,
        // No sent_by — this is automated
      });
      break;
    }

    case 'tag': {
      const tag = config.tag;
      if (tag) {
        await db.upsert('conversation_tags', {
          conversation_id: conversation.id,
          tag,
        });
      }
      break;
    }

    case 'assign': {
      const assignTo = config.assign_to;
      if (assignTo) {
        await db.update('conversations', `id=eq.${conversation.id}`, {
          assigned_to: assignTo,
          updated_at: new Date().toISOString(),
        });
      }
      break;
    }

    case 'update_status': {
      const newStatus = config.status;
      if (newStatus) {
        await db.update('conversations', `id=eq.${conversation.id}`, {
          status: newStatus,
          status_changed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      break;
    }

    // escalate, create_group, send_template, notify — implemented in future phases
    default:
      console.log(`Action type '${rule.action_type}' not yet implemented`);
  }
}
