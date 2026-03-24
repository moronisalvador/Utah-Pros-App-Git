// /api/process-scheduled.js
// Cloudflare Pages Function — runs as a cron trigger OR on-demand via GET.
//
// Processes scheduled_messages where:
//   status = 'pending' AND send_at <= now()
//
// For each due message:
//   1. Loads conversation + participants + contact
//   2. Runs compliance checks (DND, opt-in)
//   3. Sends via Twilio (same logic as send-message.js)
//   4. Updates scheduled_messages status to 'sent' or 'failed'
//   5. Links sent_message_id back to the created message row
//
// Cron config in wrangler.toml:
//   [triggers]
//   crons = ["* * * * *"]   # Every minute
//
// Can also be triggered manually: GET /api/process-scheduled

import { supabase } from '../lib/supabase.js';
import { sendMessage } from '../lib/twilio.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// GET = manual trigger, POST = cron trigger
export async function onRequestGet(context) {
  return processScheduled(context);
}

export async function onRequestPost(context) {
  return processScheduled(context);
}

// Also support Cloudflare scheduled() handler for cron triggers
export async function scheduled(event, env, ctx) {
  const db = supabase(env);
  const result = await processQueue(db, env, null);
  console.log('Cron processed:', result);
}

async function processScheduled(context) {
  const { request, env } = context;
  const db = supabase(env);
  const result = await processQueue(db, env, request);
  return jsonResponse(result, 200, request, env);
}

async function processQueue(db, env, request) {
  const now = new Date().toISOString();
  const processed = [];
  const errors = [];

  try {
    // Fetch all due messages (limit 20 per run to avoid timeouts)
    const pending = await db.select(
      'scheduled_messages',
      `status=eq.pending&send_at=lte.${encodeURIComponent(now)}&order=send_at.asc&limit=20`
    );

    if (pending.length === 0) {
      return { success: true, processed: 0, message: 'No scheduled messages due' };
    }

    for (const scheduled of pending) {
      try {
        // Mark as 'processing' to prevent double-sends
        await db.update('scheduled_messages', `id=eq.${scheduled.id}`, { status: 'processing' });

        // Load conversation
        const [conversation] = await db.select('conversations', `id=eq.${scheduled.conversation_id}`);
        if (!conversation) {
          await markFailed(db, scheduled.id, 'Conversation not found');
          errors.push({ id: scheduled.id, error: 'Conversation not found' });
          continue;
        }

        // Load participants
        const participants = await db.select(
          'conversation_participants',
          `conversation_id=eq.${scheduled.conversation_id}&is_active=eq.true`
        );
        if (participants.length === 0) {
          await markFailed(db, scheduled.id, 'No active participants');
          errors.push({ id: scheduled.id, error: 'No active participants' });
          continue;
        }

        // ── Compliance checks ──
        const primaryParticipant = participants[0];
        const [contact] = await db.select('contacts', `id=eq.${primaryParticipant.contact_id}`);

        if (contact?.dnd) {
          await markFailed(db, scheduled.id, 'Blocked: contact has DND enabled');
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: contact.phone,
            event_type: 'send_blocked_dnd',
            source: 'system',
            details: `Scheduled message ${scheduled.id} blocked: DND active.`,
            performed_by: scheduled.created_by,
          });
          errors.push({ id: scheduled.id, error: 'DND active' });
          continue;
        }

        if (contact && !contact.opt_in_status) {
          await markFailed(db, scheduled.id, 'Blocked: contact not opted in');
          await db.insert('sms_consent_log', {
            contact_id: contact.id,
            phone: contact.phone,
            event_type: 'send_blocked_no_consent',
            source: 'system',
            details: `Scheduled message ${scheduled.id} blocked: no opt-in consent.`,
            performed_by: scheduled.created_by,
          });
          errors.push({ id: scheduled.id, error: 'No opt-in consent' });
          continue;
        }

        // ── Build & send ──
        let senderPrefix = '';
        if (scheduled.created_by) {
          const [employee] = await db.select('employees', `id=eq.${scheduled.created_by}`);
          if (employee?.full_name) senderPrefix = `${employee.full_name}: `;
        }

        const clientBody = senderPrefix + scheduled.body.trim();

        const baseUrl = env.PAGES_URL || env.APP_URL || 'https://dev.utahpros.app';
        const statusCallback = `${baseUrl}/api/twilio-status`;

        const twilioResult = await sendMessage(env, {
          to: participants[0].phone,
          body: clientBody,
          mediaUrls: scheduled.media_urls ? JSON.parse(scheduled.media_urls) : undefined,
          statusCallback,
        });

        // Insert the actual message record
        const [message] = await db.insert('messages', {
          conversation_id: scheduled.conversation_id,
          type: 'sms_outbound',
          body: scheduled.body.trim(),
          status: twilioResult.sid ? 'queued' : 'failed',
          twilio_sid: twilioResult.sid || null,
          sent_by: scheduled.created_by,
          media_urls: scheduled.media_urls,
          error_message: twilioResult.error || null,
        });

        // Update conversation
        await db.update('conversations', `id=eq.${scheduled.conversation_id}`, {
          last_message_at: new Date().toISOString(),
          last_message_preview: scheduled.body.trim().substring(0, 100),
          status: 'waiting_on_client',
          status_changed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Mark scheduled message as sent
        await db.update('scheduled_messages', `id=eq.${scheduled.id}`, {
          status: 'sent',
          sent_message_id: message.id,
        });

        processed.push({ id: scheduled.id, message_id: message.id });

      } catch (err) {
        console.error(`Error processing scheduled ${scheduled.id}:`, err);
        await markFailed(db, scheduled.id, err.message);
        errors.push({ id: scheduled.id, error: err.message });
      }
    }

  } catch (err) {
    console.error('process-scheduled error:', err);
    return { success: false, error: err.message };
  }

  return {
    success: true,
    processed: processed.length,
    failed: errors.length,
    details: { processed, errors },
  };
}

async function markFailed(db, scheduledId, errorMessage) {
  await db.update('scheduled_messages', `id=eq.${scheduledId}`, {
    status: 'failed',
    error_message: errorMessage,
  });
}
