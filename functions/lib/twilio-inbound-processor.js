/**
 * ════════════════════════════════════════════════
 * FILE: twilio-inbound-processor.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Hands one already-saved Twilio text to the database operation that records
 *   consent, the inbox message, unread state, and the alert together.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./twilio-inbound.js
 *   Data:      reads  → message_provider_events through a database operation
 *              writes → contacts, sms_consent_log, conversations,
 *                       conversation_participants, messages,
 *                       message_notification_outbox through that operation
 *
 * NOTES / GOTCHAS:
 *   - A missing or failed database result stays retryable because the saved
 *     provider event is the recovery boundary.
 * ════════════════════════════════════════════════
 */

import { TwilioInboundError } from './twilio-inbound.js';

export async function processTwilioInboundEvent({
  db,
  event,
  consentOnly = false,
}) {
  if (!db?.rpc || event?.provider !== 'twilio' || !event.eventId) {
    throw new TwilioInboundError(
      'TWILIO_STORED_EVENT_INVALID',
      'A retained Twilio provider event is required.',
      { status: 500, retryable: true },
    );
  }
  let rows;
  try {
    rows = await db.rpc('project_twilio_inbound_event', {
      p_event_id: event.eventId,
      p_consent_only: consentOnly,
    });
  } catch (error) {
    throw new TwilioInboundError(
      'TWILIO_ATOMIC_PROJECTION_FAILED',
      'Atomic Twilio inbound projection failed.',
      { status: 500, retryable: true, cause: error },
    );
  }
  const projection = Array.isArray(rows) ? rows[0] : rows;
  if (!projection?.outcome) {
    throw new TwilioInboundError(
      'TWILIO_ATOMIC_PROJECTION_FAILED',
      'Atomic Twilio inbound projection returned no outcome.',
      { status: 500, retryable: true },
    );
  }
  return {
    outcome: projection.outcome,
    messageId: projection.message_id || null,
    conversationId: projection.conversation_id || null,
    contactId: projection.contact_id || null,
    inserted: projection.inserted === true,
    requiresStaffReply: projection.requires_staff_reply === true,
  };
}
