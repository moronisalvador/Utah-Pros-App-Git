// POST /api/twilio-status
// Receives delivery status updates from Twilio for outbound messages
// Status progression: queued → sent → delivered → (optionally) read
// Or: queued → sent → failed/undelivered
//
// Configured per-message via StatusCallback param when sending

import { supabase } from '../lib/supabase.js';
import { validateTwilioSignature } from '../lib/twilio.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  try {
    // ── 1. VALIDATE TWILIO SIGNATURE ──
    const webhookUrl = `${env.PAGES_URL || `https://${request.headers.get('host')}`}/api/twilio-status`;
    const isValid = await validateTwilioSignature(request, env.TWILIO_AUTH_TOKEN, webhookUrl);

    if (!isValid) {
      console.error('Invalid Twilio signature on status callback');
      return new Response('Forbidden', { status: 403 });
    }

    // ── 2. PARSE STATUS UPDATE ──
    const formData = await request.formData();
    const messageSid = formData.get('MessageSid');
    const messageStatus = formData.get('MessageStatus'); // queued, sent, delivered, undelivered, failed, read
    const errorCode = formData.get('ErrorCode') || null;
    const errorMessage = formData.get('ErrorMessage') || null;

    if (!messageSid || !messageStatus) {
      return new Response('Missing required fields', { status: 400 });
    }

    // ── 3. UPDATE MESSAGE STATUS ──
    const updateData = {
      status: messageStatus,
    };

    // RCS read receipt
    if (messageStatus === 'read') {
      updateData.read_at = new Date().toISOString();
    }

    // Error details
    if (errorCode) {
      updateData.error_code = errorCode;
      updateData.error_message = errorMessage;
    }

    const updated = await db.update('messages', `twilio_sid=eq.${messageSid}`, updateData);

    if (updated.length === 0) {
      // Message not found — might be from a different system or old message
      console.warn(`Status callback for unknown MessageSid: ${messageSid}`);
    }

    // ── 4. RETURN 200 ──
    // Twilio expects a 200 response — anything else triggers retries
    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('twilio-status error:', err);
    // Still return 200 to prevent Twilio retries on our errors
    return new Response('OK', { status: 200 });
  }
}
