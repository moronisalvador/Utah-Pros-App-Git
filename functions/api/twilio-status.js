// POST /api/twilio-status
// Receives delivery status updates from Twilio.
// Twilio sends these for every message when a statusCallback URL is configured.
//
// Status flow: queued → sending → sent → delivered (or failed/undelivered)
// RCS adds: read, clicked
//
// Updates messages.status so the frontend shows real delivery state.

import { supabase } from '../lib/supabase.js';
import { handleOptions } from '../lib/cors.js';

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  try {
    const formData = await request.formData();
    const messageSid = formData.get('MessageSid');
    const messageStatus = formData.get('MessageStatus'); // queued, sending, sent, delivered, failed, undelivered, read
    const errorCode = formData.get('ErrorCode');
    const errorMessage = formData.get('ErrorMessage');

    if (!messageSid || !messageStatus) {
      return new Response('OK', { status: 200 });
    }

    // Build update payload
    const update = { status: messageStatus };

    if (errorCode) update.error_code = errorCode;
    if (errorMessage) update.error_message = errorMessage;

    // RCS-specific: track read and click timestamps
    if (messageStatus === 'read') {
      update.read_at = new Date().toISOString();
    }
    // Note: 'clicked' is for RCS suggested actions — rare but supported
    if (formData.get('ButtonText')) {
      update.clicked_at = new Date().toISOString();
    }

    // Update the message by twilio_sid
    await db.update('messages', `twilio_sid=eq.${encodeURIComponent(messageSid)}`, update);

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('twilio-status error:', err);
    // Return 200 so Twilio doesn't retry
    return new Response('OK', { status: 200 });
  }
}
