/**
 * ════════════════════════════════════════════════
 * FILE: twilio-inbound.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the required fields on one verified Twilio text and turns them into
 *   the common shape the messaging inbox understands. Picture links remain
 *   temporary inputs and are never included in the saved event facts.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - MessageSid is the replay identity for both SMS and MMS.
 *   - At most ten media items are accepted, matching Twilio's inbound contract.
 * ════════════════════════════════════════════════
 */

const MESSAGE_SID = /^(?:SM|MM)[0-9a-f]{32}$/i;
const ACCOUNT_SID = /^AC[0-9a-f]{32}$/i;
const MAX_MEDIA_ITEMS = 10;

export class TwilioInboundError extends Error {
  constructor(code, message, { status = 400, retryable = false } = {}) {
    super(message);
    this.name = 'TwilioInboundError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function fail(code, message, details) {
  throw new TwilioInboundError(code, message, details);
}

function requiredText(params, key) {
  const value = String(params.get(key) || '').trim();
  if (!value) fail('TWILIO_INBOUND_FIELD_MISSING', `Twilio ${key} is required.`);
  return value;
}

function parseMediaCount(raw) {
  if (!/^\d+$/.test(String(raw ?? '0'))) {
    fail('TWILIO_INBOUND_MEDIA_COUNT_INVALID', 'Twilio NumMedia is invalid.');
  }
  const count = Number(raw || 0);
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_MEDIA_ITEMS) {
    fail(
      'TWILIO_INBOUND_MEDIA_COUNT_UNSUPPORTED',
      `Twilio inbound MMS supports at most ${MAX_MEDIA_ITEMS} media items.`,
    );
  }
  return count;
}

export function parseTwilioInbound(params) {
  if (!params?.get) {
    fail('TWILIO_INBOUND_FORM_INVALID', 'Twilio webhook form data is required.');
  }

  const messageSid = requiredText(params, 'MessageSid');
  const accountSid = requiredText(params, 'AccountSid');
  const from = requiredText(params, 'From');
  const to = requiredText(params, 'To');
  if (!MESSAGE_SID.test(messageSid)) {
    fail('TWILIO_INBOUND_MESSAGE_SID_INVALID', 'Twilio MessageSid is invalid.');
  }
  if (!ACCOUNT_SID.test(accountSid)) {
    fail('TWILIO_INBOUND_ACCOUNT_SID_INVALID', 'Twilio AccountSid is invalid.');
  }

  const mediaCount = parseMediaCount(params.get('NumMedia'));
  const ephemeralMedia = [];
  for (let index = 0; index < mediaCount; index += 1) {
    const url = requiredText(params, `MediaUrl${index}`);
    const contentType = requiredText(params, `MediaContentType${index}`)
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    ephemeralMedia.push(Object.freeze({ index, url, contentType }));
  }

  const messageType = mediaCount > 0 ? 'mms' : 'sms';
  return Object.freeze({
    provider: 'twilio',
    eventType: 'message.received',
    providerEventId: messageSid,
    providerMessageId: messageSid,
    providerConversationId: null,
    accountSid,
    direction: 'inbound',
    messageType,
    from,
    to,
    body: params.get('Body') || '',
    mediaCount,
    ephemeralMedia: Object.freeze(ephemeralMedia),
    dedupeKey: `twilio:message.received:${messageSid}`,
  });
}

export function sameTwilioInboundEvent(existing, event, rawBodyHash) {
  return existing?.provider === event.provider
    && existing.event_type === event.eventType
    && existing.provider_event_id === event.providerEventId
    && existing.provider_message_id === event.providerMessageId
    && (existing.provider_conversation_id ?? null) === null
    && existing.direction === event.direction
    && existing.message_type === event.messageType
    && existing.sender_address === event.from
    && existing.recipient_address === event.to
    && (existing.content ?? '') === event.body
    && Number(existing.media_count) === event.mediaCount
    && existing.raw_body_hash === rawBodyHash;
}

export const TWILIO_INBOUND_LIMITS = Object.freeze({
  maxMediaItems: MAX_MEDIA_ITEMS,
});
