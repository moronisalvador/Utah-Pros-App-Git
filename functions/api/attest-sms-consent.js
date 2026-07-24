/**
 * ════════════════════════════════════════════════
 * FILE: attest-sms-consent.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets authorized office staff record SMS permission that was verified outside
 *   UPR before the app tracked consent. It never sends a message, never clears an
 *   opt-out or Do Not Disturb flag, and asks the database to update the current
 *   service record and evidence history together so the audit record cannot be skipped.
 *
 * WHERE IT LIVES:
 *   Route:        GET/POST /api/attest-sms-consent
 *   Rendered by:  src/components/conversations/SmsConsentAttestationModal.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  functions/lib/auth.js, functions/lib/cors.js,
 *              functions/lib/messaging-auth.js, functions/lib/supabase.js
 *   Data:      reads  → employees, contacts, service_sms_consents, message_provider_events
 *              writes → service_sms_consents, service_sms_consent_attestations, sms_consent_log
 *                       (through attest_prior_sms_consent)
 *
 * NOTES / GOTCHAS:
 *   - Only active, internal admin/office employees may attest prior permission.
 *   - The actor comes from the verified session, never the request body.
 *   - The database function is service-role-only and rechecks role and suppression
 *     state inside the same transaction.
 * ════════════════════════════════════════════════
 */

import { requireRole } from '../lib/auth.js';
import { handleOptions, jsonResponse } from '../lib/cors.js';
import { requireMessagingAccess } from '../lib/messaging-auth.js';
import { supabase } from '../lib/supabase.js';

const ATTESTATION_ROLES = ['admin', 'office'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONSENT_METHODS = new Set([
  'verbal_permission',
  'signed_work_authorization',
  'other_written_permission',
  'customer_requested_texts',
  'other_verified_permission',
]);
const CONSENT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function denverDateValue(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isCalendarDate(value) {
  if (!CONSENT_DATE_PATTERN.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const date = new Date(Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
  ));
  return date.getUTCFullYear() === Number(yearText)
    && date.getUTCMonth() === Number(monthText) - 1
    && date.getUTCDate() === Number(dayText);
}

function statusForCode(code) {
  if (code === 'CONTACT_NOT_FOUND') return 404;
  if (code === 'CONSENT_ATTESTATION_NOT_AUTHORIZED') return 403;
  if (
    code === 'CONTACT_DND_ACTIVE'
    || code === 'CONTACT_OPTED_OUT'
    || code === 'CONTACT_SUPPRESSION_CHANGED'
    || code === 'CONTACT_PENDING_STOP'
  ) return 409;
  return 400;
}

function errorForCode(code) {
  switch (code) {
    case 'CONTACT_NOT_FOUND':
      return 'Contact not found';
    case 'CONTACT_HAS_NO_PHONE':
      return 'Contact does not have a phone number';
    case 'CONTACT_DND_ACTIVE':
      return 'Consent was not recorded because Do Not Disturb is active';
    case 'CONTACT_OPTED_OUT':
      return 'Consent was not recorded because the contact previously opted out';
    case 'CONTACT_SUPPRESSION_CHANGED':
      return 'Consent was not recorded because the contact suppression state changed';
    case 'CONTACT_PENDING_STOP':
      return 'Consent was not recorded because an inbound STOP request is still being processed';
    case 'CONSENT_ATTESTATION_NOT_AUTHORIZED':
      return 'You are not authorized to record prior SMS consent';
    default:
      return 'Consent attestation was not accepted';
  }
}

export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const db = supabase(env);
  const auth = await requireMessagingAccess(request, env, db);
  if (auth.error) {
    return jsonResponse({
      error: auth.error,
      code: auth.code,
    }, auth.status, request, env);
  }

  const contactId = new URL(request.url).searchParams.get('contact_id') || '';
  if (!UUID_PATTERN.test(contactId)) {
    return jsonResponse({ error: 'contact_id must be a UUID' }, 400, request, env);
  }

  try {
    const result = await db.rpc('get_service_sms_consent_status', {
      p_contact_id: contactId,
      p_destination_phone: null,
    });
    const status = Array.isArray(result) ? result[0] : result;
    return jsonResponse({
      ok: true,
      status: status || { allowed: false, code: 'NO_CONSENT' },
    }, 200, request, env);
  } catch (error) {
    console.error('attest-sms-consent status:', error);
    return jsonResponse({
      error: 'Could not verify SMS consent status',
      code: 'CONSENT_STATUS_FAILED',
    }, 500, request, env);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = supabase(env);

  const auth = await requireRole(request, env, db, ATTESTATION_ROLES);
  if (auth.error) {
    return jsonResponse({ error: auth.error }, auth.status, request, env);
  }
  if (auth.employee.is_external === true) {
    return jsonResponse({ error: 'External employees cannot record SMS consent' }, 403, request, env);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON' }, 400, request, env);
  }

  const contactId = String(input?.contact_id || '');
  const method = String(input?.consent_method || '').trim().toLowerCase();
  const consentObtainedOn = String(input?.consent_obtained_on || '').trim();
  const evidenceNote = String(input?.evidence_note || '').trim();

  if (!UUID_PATTERN.test(contactId)) {
    return jsonResponse({ error: 'contact_id must be a UUID' }, 400, request, env);
  }
  if (!CONSENT_METHODS.has(method)) {
    return jsonResponse({ error: 'Select how SMS permission was verified' }, 400, request, env);
  }
  if (
    !isCalendarDate(consentObtainedOn)
    || consentObtainedOn > denverDateValue()
  ) {
    return jsonResponse({ error: 'Enter the date SMS permission was obtained' }, 400, request, env);
  }
  if (evidenceNote.length < 10 || evidenceNote.length > 500) {
    return jsonResponse({
      error: 'Evidence note must be between 10 and 500 characters',
    }, 400, request, env);
  }

  try {
    const connectionIp = String(request.headers.get('CF-Connecting-IP') || '').trim();
    const requestIp = /^[0-9A-Fa-f:.]{3,64}$/.test(connectionIp)
      ? connectionIp
      : null;
    const result = await db.rpc('attest_prior_sms_consent', {
      p_contact_id: contactId,
      p_actor_id: auth.employee.id,
      p_consent_method: method,
      p_consent_obtained_on: consentObtainedOn,
      p_evidence_note: evidenceNote,
      p_request_ip: requestIp,
    });
    const record = Array.isArray(result) ? result[0] : result;

    if (!record?.ok) {
      const code = record?.code || 'CONSENT_ATTESTATION_FAILED';
      return jsonResponse({
        error: errorForCode(code),
        code,
      }, statusForCode(code), request, env);
    }

    return jsonResponse({
      ok: true,
      consent: record,
    }, 200, request, env);
  } catch (error) {
    console.error('attest-sms-consent:', error);
    return jsonResponse({
      error: 'Could not record SMS consent',
      code: 'CONSENT_ATTESTATION_FAILED',
    }, 500, request, env);
  }
}
