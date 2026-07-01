/**
 * ════════════════════════════════════════════════
 * FILE: callrail.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The pure, no-side-effects helpers for turning a CallRail webhook delivery
 *   into the fields our database expects, plus a safety check for recording
 *   links. "Pure" means these functions only take data in and give data back —
 *   they never touch the network or the database — so they can be unit-tested
 *   directly (see callrail.test.js). The database/network CallRail helpers live
 *   separately in callrail-api.js on purpose.
 *
 * WHERE IT LIVES:
 *   Pure helper module. Imported by functions/api/callrail-webhook.js (mapping)
 *   and functions/api/callrail-recording.js (URL allowlist).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./callrail-api.js (transcriptText — also pure)
 *   Exports:   firstOf, boolish, pickCallId, mapCallPayload, mapFormPayload,
 *              isAllowedRecordingUrl
 *
 * NOTES / GOTCHAS:
 *   - CallRail's webhook body is `application/x-www-form-urlencoded`, so after
 *     decoding EVERY value is a string — including booleans and numbers. That
 *     is why `boolish()` exists (the literal string "false" is truthy in JS)
 *     and why duration is coerced with Number().
 *   - The call id is delivered under `resource_id`; there is no top-level `id`
 *     key on the live payload. `pickCallId` still checks `id`/`call_id` first so
 *     a differently-shaped delivery (or a JSON body) also works.
 *   - `firstOf` treats '' the same as null/undefined, so CallRail's many empty
 *     string fields (campaign, value, transcription on a call with none) map to
 *     null rather than an empty string.
 * ════════════════════════════════════════════════
 */
import { transcriptText } from './callrail-api.js';

// Return the first key whose value is present (not null/undefined/'').
export function firstOf(obj, keys) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
}

// Coerce a form-encoded ("false"/"true"/"0"/"1") or real boolean into a boolean.
// The trap: a naive `!!"false"` is TRUE, which would flag a clean call as spam.
export function boolish(v) {
  if (v === true) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return false;
}

// The call id — top-level under any of several keys, then the live payload's
// `resource_id`, then a nested resource wrapper (JSON-body deliveries).
export function pickCallId(body) {
  return firstOf(body, ['id', 'call_id', 'callrail_id', 'resource_id'])
    || firstOf(body?.call || {}, ['id', 'call_id', 'callrail_id'])
    || firstOf(body?.resource || {}, ['id', 'call_id']);
}

// Map a CallRail "call" webhook payload → upsert_lead_from_callrail params.
export function mapCallPayload(body) {
  const duration = firstOf(body, ['duration', 'duration_sec']);
  return {
    p_callrail_id:     String(pickCallId(body)),
    p_source_type:     'call',
    p_tracking_number: firstOf(body, ['tracking_phone_number', 'tracking_number']),
    p_caller_number:   firstOf(body, ['customer_phone_number', 'caller_number', 'from_number']),
    p_duration_sec:    duration == null ? null : Number(duration),
    p_spam_flag:       boolish(firstOf(body, ['spam', 'spam_flag'])),
    p_source:          firstOf(body, ['source', 'utm_source']),
    p_medium:          firstOf(body, ['medium', 'utm_medium']),
    p_campaign:        firstOf(body, ['campaign', 'utm_campaign']),
    p_recording_url:   firstOf(body, ['recording', 'recording_url']),
    p_transcription:   transcriptText(firstOf(body, ['transcription', 'transcript'])),
    p_form_data:       null,
    p_lead_status:     firstOf(body, ['lead_status']) || 'new',
    p_value:           firstOf(body, ['value']),
    p_direction:       firstOf(body, ['direction']),
    p_occurred_at:     firstOf(body, ['start_time', 'created_at', 'occurred_at']) || new Date().toISOString(),
    p_raw_payload:     body,
  };
}

// Map a CallRail "form submission" webhook payload.
export function mapFormPayload(body) {
  return {
    p_callrail_id:     String(firstOf(body, ['id', 'form_id', 'callrail_id', 'resource_id'])),
    p_source_type:     'form',
    p_tracking_number: null,
    p_caller_number:   firstOf(body, ['phone_number', 'customer_phone_number']),
    p_duration_sec:    null,
    p_spam_flag:       boolish(firstOf(body, ['spam', 'spam_flag'])),
    p_source:          firstOf(body, ['source', 'utm_source']),
    p_medium:          firstOf(body, ['medium', 'utm_medium']),
    p_campaign:        firstOf(body, ['campaign', 'utm_campaign']),
    p_recording_url:   null,
    p_transcription:   null,
    p_form_data:       firstOf(body, ['form_data', 'formdata']) || body,
    p_lead_status:     'new',
    p_value:           firstOf(body, ['value']),
    p_direction:       'inbound',
    p_occurred_at:     firstOf(body, ['created_at', 'occurred_at']) || new Date().toISOString(),
    p_raw_payload:     body,
  };
}

// SSRF guard for the recording proxy: only ever proxy a CallRail-hosted
// recording URL. Two legitimate shapes exist:
//   - api.callrail.com/…            → the REST API recording endpoint (backfill)
//   - app.callrail.com/calls/{id}/recording/redirect?access_key=…
//                                   → the pre-signed redirect the LIVE webhook
//                                     delivers in its `recording` field
export function isAllowedRecordingUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  if (/^https:\/\/api\.callrail\.com\//.test(url)) return true;
  if (/^https:\/\/app\.callrail\.com\/calls\/[^/?#]+\/recording\/redirect(\?|$)/.test(url)) return true;
  return false;
}
