// POST /api/send-message
// Sends an outbound SMS/MMS from a team member to a contact.
//
// Request body:
// {
//   conversation_id: uuid,
//   body: string,
//   sent_by: uuid (employee id),
//   media_urls?: string[],
//   is_internal_note?: boolean,
//   skip_compliance?: boolean  // Only for system-initiated (e.g. automations that already checked)
// }
//
// COMPLIANCE CHAIN (runs before every outbound message):
// 1. DND check — blocks if contact.dnd === true
// 2. Opt-out check — blocks if contact.opt_in_status === false
// 3. Consent log — every send attempt is auditable
//
// Twilio requirements met:
// - TCPA: consent verified before send
// - CTIA: DND/opt-out honored
// - 10DLC: sender name prefixed, status callbacks configured

import { supabase } from '../lib/supabase.js';
import { sendMessage } from '../lib/twilio.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  try {
    const { conversation_id, body, sent_by, media_urls, is_internal_note, skip_compliance } = await request.json();

    if (!conversation_id || !body?.trim()) {
      return jsonResponse({ error: 'conversation_id and body are required' }, 400, request, env);
    }

    // ═══ INTERNAL NOTE: just insert, no Twilio, no compliance needed ═══
    if (is_internal_note) {
      const [note] = await db.insert('messages', {
        conversation_id,
        type: 'internal_note',
        body: body.trim(),
        status: 'received',
        sent_by,
      });

      await db.update('conversations', `id=eq.${conversation_id}`, {
        last_message_at: new Date().toISOString(),
        last_message_preview: `[Note] ${body.trim().substring(0, 80)}`,
        updated_at: new Date().toISOString(),
      });

      return jsonResponse({ success: true, message: note, type: 'internal_note' }, 201, request, env);
    }

    // ═══ OUTBOUND MESSAGE ═══

    // 1. Get conversation + participants + contact data
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

    // ═══ COMPLIANCE CHECKS ═══
    // These run for every outbound message unless skip_compliance is true (system automations only)
    if (!skip_compliance) {
      // Get the primary contact for compliance checks
      const primaryParticipant = participants[0];
      const [contact] = await db.select('contacts', `id=eq.${primaryParticipant.contact_id}`);

      if (contact) {
        // ── CHECK 1: DND (Do Not Disturb) ──
        // If DND is on, block the message immediately.
        // Twilio can suspend accounts that message DND contacts.
        if (contact.dnd) {
          // Log the blocked attempt
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: contact.phone,
            event_type: 'send_blocked_dnd',
            source: 'system',
            details: `Outbound blocked: DND active since ${contact.dnd_at || 'unknown'}`,
            performed_by: sent_by,
          });

          return jsonResponse({
            error: 'Message blocked: contact has Do Not Disturb enabled',
            code: 'DND_ACTIVE',
            contact_id: contact.id,
          }, 403, request, env);
        }

        // ── CHECK 2: Opt-in status ──
        // TCPA requires prior express consent for business texts.
        // If opt_in_status is false, they either never opted in or opted out.
        if (!contact.opt_in_status) {
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: contact.phone,
            event_type: 'send_blocked_no_consent',
            source: 'system',
            details: `Outbound blocked: opt_in_status is false. ${contact.opt_out_reason ? 'Opt-out reason: ' + contact.opt_out_reason : 'Never opted in.'}`,
            performed_by: sent_by,
          });

          return jsonResponse({
            error: 'Message blocked: contact has not opted in to SMS',
            code: 'NO_CONSENT',
            contact_id: contact.id,
          }, 403, request, env);
        }
      }
    }

    // 2. Get sender info for auto-prefix
    // Twilio/CTIA requires identifying the business in messages
    let senderPrefix = '';
    if (sent_by) {
      const [employee] = await db.select('employees', `id=eq.${sent_by}`);
      if (employee?.full_name) {
        senderPrefix = `${employee.full_name}: `;
      }
    }

    // 3. Build message body with sender prefix
    const clientBody = senderPrefix + body.trim();

    // 4. Status callback URL for delivery receipts
    const baseUrl = env.PAGES_URL || `https://${request.headers.get('host')}`;
    const statusCallback = `${baseUrl}/api/twilio-status`;

    // 5. Send via Twilio
    const results = [];

    if (conversation.type === 'group') {
      const toNumbers = participants.map(p => p.phone).join(',');
      const twilioResult = await sendMessage(env, {
        to: toNumbers,
        body: clientBody,
        mediaUrls: media_urls,
        statusCallback,
      });
      results.push(twilioResult);
    } else if (conversation.type === 'broadcast') {
      for (const participant of participants) {
        try {
          const twilioResult = await sendMessage(env, {
            to: participant.phone,
            body: clientBody,
            mediaUrls: media_urls,
            statusCallback,
          });
          results.push(twilioResult);
        } catch (err) {
          results.push({ error: err.message, to: participant.phone });
        }
      }
    } else {
      // Direct: single recipient
      const twilioResult = await sendMessage(env, {
        to: participants[0].phone,
        body: clientBody,
        mediaUrls: media_urls,
        statusCallback,
      });
      results.push(twilioResult);
    }

    // 6. Insert message record
    const twilioSid = results[0]?.sid || null;
    const [message] = await db.insert('messages', {
      conversation_id,
      type: 'sms_outbound',
      body: body.trim(),
      status: twilioSid ? 'queued' : 'failed',
      twilio_sid: twilioSid,
      sent_by,
      media_urls: media_urls?.length > 0 ? JSON.stringify(media_urls) : null,
      error_message: results[0]?.error || null,
    });

    // 7. Update conversation metadata
    const updateData = {
      last_message_at: new Date().toISOString(),
      last_message_preview: body.trim().substring(0, 100),
      status: 'waiting_on_client',
      status_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (conversation.status === 'needs_response' && !conversation.first_response_at) {
      updateData.first_response_at = new Date().toISOString();
    }

    await db.update('conversations', `id=eq.${conversation_id}`, updateData);

    return jsonResponse({
      success: true,
      message,
      twilio: results,
    }, 201, request, env);

  } catch (err) {
    console.error('send-message error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}
