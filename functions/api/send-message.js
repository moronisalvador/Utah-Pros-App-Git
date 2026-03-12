// POST /api/send-message
// Sends an outbound message from a team member to a contact
//
// Request body:
// {
//   conversation_id: uuid,
//   body: string,
//   sent_by: uuid (employee id),
//   media_urls?: string[],
//   is_internal_note?: boolean
// }

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
    const { conversation_id, body, sent_by, media_urls, is_internal_note } = await request.json();

    if (!conversation_id || !body?.trim()) {
      return jsonResponse({ error: 'conversation_id and body are required' }, 400, request, env);
    }

    // ── INTERNAL NOTE: just insert, no Twilio ──
    if (is_internal_note) {
      const [note] = await db.insert('messages', {
        conversation_id,
        type: 'internal_note',
        body: body.trim(),
        status: 'received', // notes are always "received"
        sent_by,
      });

      await db.update('conversations', `id=eq.${conversation_id}`, {
        last_message_at: new Date().toISOString(),
        last_message_preview: `[Note] ${body.trim().substring(0, 80)}`,
        updated_at: new Date().toISOString(),
      });

      return jsonResponse({ success: true, message: note, type: 'internal_note' }, 201, request, env);
    }

    // ── OUTBOUND MESSAGE ──

    // 1. Get conversation + participants
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

    // 2. Get sender info for auto-prefix
    let senderPrefix = '';
    if (sent_by) {
      const [employee] = await db.select('employees', `id=eq.${sent_by}`);
      if (employee?.full_name) {
        senderPrefix = `${employee.full_name}: `;
      }
    }

    // 3. Build the message body with sender prefix for client-facing messages
    const clientBody = senderPrefix + body.trim();

    // 4. Determine status callback URL
    const baseUrl = env.PAGES_URL || `https://${request.headers.get('host')}`;
    const statusCallback = `${baseUrl}/api/twilio-status`;

    // 5. Send via Twilio based on conversation type
    const results = [];

    if (conversation.type === 'group') {
      // Group MMS: send to all participants at once
      const toNumbers = participants.map(p => p.phone).join(',');
      const twilioResult = await sendMessage(env, {
        to: toNumbers,
        body: clientBody,
        mediaUrls: media_urls,
        statusCallback,
      });
      results.push(twilioResult);

    } else if (conversation.type === 'broadcast') {
      // Broadcast: send individually to each participant
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

    // 6. Insert message record (store the original body without prefix for internal display)
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

    // 7. Update conversation
    const updateData = {
      last_message_at: new Date().toISOString(),
      last_message_preview: body.trim().substring(0, 100),
      status: 'waiting_on_client',
      status_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Set first_response_at if this is the first team reply after an inbound
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
