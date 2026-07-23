/**
 * ════════════════════════════════════════════════
 * FILE: callrail-text-webhook.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Authenticates and normalizes only CallRail's documented Text Message
 *   Received and Text Message Sent webhook payloads. It signs the exact raw
 *   request bytes, rejects replayed/stale timestamps, and produces a stable
 *   provider-event identity before any route is allowed to touch UPR data.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * EXPORTS:
 *   verifyCallrailSignature(rawBody, signature, signingKey) → Promise<boolean>
 *   normalizeCallrailTextWebhook(payload) → normalized text event
 *   deriveCallrailTextDedupeKey(event) → stable provider-event key
 *   parseVerifiedCallrailTextWebhook(options) → authenticated normalized event
 *   CallrailTextWebhookError
 *
 * NOTES / GOTCHAS:
 *   - `rawBody` must be the untouched request bytes/string. Never stringify a
 *     parsed object and expect its signature to match.
 *   - `ephemeralMediaUrls` are short-lived provider inputs. A future route must
 *     download approved media immediately and persist only UPR-owned storage
 *     references, never these URLs.
 *   - `body` is untrusted customer/provider content. This module preserves it;
 *     callers must never interpret it as HTML or executable markup.
 *   - This module is deliberately stateless: no fetch, database, storage,
 *     credential resolution, logging, or request/response side effects.
 * ════════════════════════════════════════════════
 */

const SHA1_BYTE_LENGTH = 20;
const ISO_TIMESTAMP_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const ALLOWED_LEAD_STATUSES = new Set([
  null,
  'good_lead',
  'not_a_lead',
  'previously_marked_good_lead',
]);

export class CallrailTextWebhookError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CallrailTextWebhookError';
    this.code = code;
  }
}

function bodyBytes(rawBody) {
  if (typeof rawBody === 'string') return new TextEncoder().encode(rawBody);
  if (rawBody instanceof ArrayBuffer) return new Uint8Array(rawBody);
  if (ArrayBuffer.isView(rawBody)) {
    return new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  }
  return null;
}

function decodeBase64(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    return null;
  }

  try {
    const decoded = atob(value);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

// Compares one fixed-size SHA-1 digest without returning early on a mismatch.
function timingSafeDigestEqual(expected, actual) {
  let mismatch = expected.length ^ (actual?.length ?? 0);
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected[index] ^ (actual?.[index] ?? 0);
  }
  return mismatch === 0;
}

/**
 * Verify CallRail's base64 HMAC-SHA1 Signature against the exact raw body.
 */
export async function verifyCallrailSignature(rawBody, signature, signingKey) {
  const bytes = bodyBytes(rawBody);
  if (!bytes || typeof signingKey !== 'string' || signingKey.length === 0) return false;

  const suppliedDigest = decodeBase64(signature);
  if (!suppliedDigest || suppliedDigest.length !== SHA1_BYTE_LENGTH) return false;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const expectedDigest = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, bytes),
  );

  return timingSafeDigestEqual(expectedDigest, suppliedDigest);
}

function parseJsonBody(rawBody) {
  const bytes = bodyBytes(rawBody);
  if (!bytes) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_PAYLOAD',
      'CallRail webhook body must be raw UTF-8 bytes or a string',
    );
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_PAYLOAD',
      'CallRail webhook body is not valid UTF-8',
    );
  }

  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('not an object');
    }
    return payload;
  } catch {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_PAYLOAD',
      'CallRail webhook body must be a JSON object',
    );
  }
}

function requireText(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TEXT_EVENT',
      `CallRail text webhook has an invalid ${field}`,
    );
  }
  return value;
}

function requireIdentifier(value, field) {
  if (
    (typeof value !== 'string' && typeof value !== 'number')
    || String(value).length === 0
  ) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TEXT_EVENT',
      `CallRail text webhook has an invalid ${field}`,
    );
  }
  return String(value);
}

function normalizeTimestamp(value) {
  const parts = typeof value === 'string'
    ? ISO_TIMESTAMP_WITH_ZONE.exec(value)
    : null;
  if (!parts) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TIMESTAMP',
      'CallRail text webhook timestamp must be ISO 8601 with a time-zone offset',
    );
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, ,
    offsetHourText = '00', offsetMinuteText = '00'] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText);
  const offsetMinute = Number(offsetMinuteText);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;

  if (
    day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59
  ) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TIMESTAMP',
      'CallRail text webhook timestamp is not a real date',
    );
  }

  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TIMESTAMP',
      'CallRail text webhook timestamp is not a real date',
    );
  }
  return { timestampMs, occurredAt: new Date(timestampMs).toISOString() };
}

function validateReplayWindow(timestampMs, nowMs, replayWindowMs, futureToleranceMs) {
  // CallRail documents this as the message event time, not a webhook-issued
  // timestamp, and does not resend failed deliveries. Freshness rejection is
  // therefore opt-in only; the route relies on signature + durable dedupe.
  if (replayWindowMs == null && futureToleranceMs == null) return;
  if (
    !Number.isFinite(nowMs)
    || (replayWindowMs != null && (!Number.isFinite(replayWindowMs) || replayWindowMs < 0))
    || (futureToleranceMs != null && (!Number.isFinite(futureToleranceMs) || futureToleranceMs < 0))
  ) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_VERIFICATION_OPTIONS',
      'CallRail webhook replay-window options are invalid',
    );
  }

  if (replayWindowMs != null && nowMs - timestampMs > replayWindowMs) {
    throw new CallrailTextWebhookError(
      'STALE_CALLRAIL_TIMESTAMP',
      'CallRail webhook timestamp is outside the replay window',
    );
  }
  if (futureToleranceMs != null && timestampMs - nowMs > futureToleranceMs) {
    throw new CallrailTextWebhookError(
      'FUTURE_CALLRAIL_TIMESTAMP',
      'CallRail webhook timestamp is too far in the future',
    );
  }
}

function assertTextEventShape(payload) {
  const callKeys = [
    'answered',
    'call_type',
    'duration',
    'start_time',
    'tracking_phone_number',
  ];
  const formKeys = ['form_data', 'form_url', 'submitted_at'];
  if ([...callKeys, ...formKeys].some((key) => Object.hasOwn(payload, key))) {
    throw new CallrailTextWebhookError(
      'UNSUPPORTED_CALLRAIL_EVENT',
      'CallRail call and form payloads are not accepted by the text webhook',
    );
  }

  if (!['sms', 'mms'].includes(payload.message_type)) {
    throw new CallrailTextWebhookError(
      'UNSUPPORTED_CALLRAIL_EVENT',
      'CallRail webhook is not a documented SMS or MMS event',
    );
  }
}

function normalizeMediaUrls(messageType, mediaUrls) {
  if (!Array.isArray(mediaUrls)) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TEXT_EVENT',
      'CallRail text webhook media_urls must be an array',
    );
  }

  const normalized = mediaUrls.map((value) => {
    const url = requireText(value, 'media_urls item');
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('not HTTPS');
      return url;
    } catch {
      throw new CallrailTextWebhookError(
        'INVALID_CALLRAIL_TEXT_EVENT',
        'CallRail text webhook media URLs must use HTTPS',
      );
    }
  });

  if (
    (messageType === 'sms' && normalized.length !== 0)
    || (messageType === 'mms' && normalized.length === 0)
  ) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TEXT_EVENT',
      'CallRail message_type does not match media_urls',
    );
  }
  return normalized;
}

/**
 * Derive the provider-event claim key from CallRail's documented stable ID.
 */
export function deriveCallrailTextDedupeKey(event) {
  if (
    !event
    || !['message.received', 'message.sent'].includes(event.eventType)
    || typeof event.providerMessageId !== 'string'
    || event.providerMessageId.length === 0
  ) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_DEDUPE_INPUT',
      'A normalized CallRail text event is required for dedupe',
    );
  }
  return `callrail:${event.eventType}:${event.providerMessageId}`;
}

/**
 * Normalize only the two documented CallRail text webhook shapes.
 */
export function normalizeCallrailTextWebhook(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TEXT_EVENT',
      'CallRail text webhook payload must be an object',
    );
  }
  assertTextEventShape(payload);

  const isSent = Object.hasOwn(payload, 'agent');
  const eventType = isSent ? 'message.sent' : 'message.received';
  const direction = isSent ? 'outbound' : 'inbound';
  const messageType = payload.message_type;
  const { occurredAt } = normalizeTimestamp(payload.timestamp);

  if (!ALLOWED_LEAD_STATUSES.has(payload.lead_status)) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_TEXT_EVENT',
      'CallRail text webhook has an invalid lead_status',
    );
  }

  const event = {
    provider: 'callrail',
    eventType,
    direction,
    providerEventId: requireIdentifier(payload.id, 'id'),
    providerMessageId: requireIdentifier(payload.resource_id, 'resource_id'),
    providerConversationId: requireIdentifier(payload.conversation_id, 'conversation_id'),
    companyResourceId: requireIdentifier(payload.company_resource_id, 'company_resource_id'),
    personResourceId: requireIdentifier(payload.person_resource_id, 'person_resource_id'),
    from: requireText(payload.source_number, 'source_number'),
    to: requireText(payload.destination_number, 'destination_number'),
    body: requireText(payload.content, 'content', { allowEmpty: true }),
    messageType,
    ephemeralMediaUrls: normalizeMediaUrls(messageType, payload.media_urls),
    providerTimestamp: payload.timestamp,
    occurredAt,
    leadStatus: payload.lead_status,
    agentName: isSent ? requireText(payload.agent, 'agent') : null,
  };

  return Object.freeze({
    ...event,
    ephemeralMediaUrls: Object.freeze(event.ephemeralMediaUrls),
    dedupeKey: deriveCallrailTextDedupeKey(event),
  });
}

/**
 * Verify signature and replay freshness before exposing normalized content.
 */
export async function parseVerifiedCallrailTextWebhook({
  rawBody,
  signature,
  signingKey,
  nowMs = Date.now(),
  replayWindowMs = null,
  futureToleranceMs = null,
}) {
  if (!(await verifyCallrailSignature(rawBody, signature, signingKey))) {
    throw new CallrailTextWebhookError(
      'INVALID_CALLRAIL_SIGNATURE',
      'CallRail webhook signature is invalid',
    );
  }

  const payload = parseJsonBody(rawBody);
  const { timestampMs } = normalizeTimestamp(payload.timestamp);
  validateReplayWindow(timestampMs, nowMs, replayWindowMs, futureToleranceMs);
  return normalizeCallrailTextWebhook(payload);
}
