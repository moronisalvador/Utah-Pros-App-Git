/**
 * ════════════════════════════════════════════════
 * FILE: sms-consent.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers one preliminary question for automated texts: does this contact
 *   have a phone, recorded opt-in, and no Do Not Disturb or explicit opt-out?
 *   Staff-written one-to-one service messages have a separately reviewed
 *   implied-permission code. Only the exact typed transactional-service
 *   producers named below may consume that code; generic automation cannot.
 *
 *   This file also holds the lists of "allowed" answers each send path will
 *   accept from the database. Only the staff one-to-one list accepts
 *   `IMPLIED_CONSENT` generally; the exact service-notice list is the narrow
 *   automated exception. Scheduled free-form traffic requires global opt-in.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none — pure functions, no I/O
 *   Internal:  imported by functions/lib/automated-send.js,
 *              functions/api/send-message.js, functions/api/process-scheduled.js
 *   Data:      reads  → none (callers look up the contact; this just judges it)
 *              writes → none
 *
 * EXPORTS:
 *   consentAllows({ phone, opt_in_status, opt_out_at, dnd }) → boolean
 *   STAFF_ACCEPTED_CONSENT_CODES      — /api/send-message, human-typed 1:1
 *   AUTOMATED_ACCEPTED_CONSENT_CODES  — automated-send.js
 *   SCHEDULED_ACCEPTED_CONSENT_CODES  — process-scheduled.js
 *   isAcceptedConsent(status, acceptedCodes) → boolean
 *
 * NOTES / GOTCHAS:
 *   - `IMPLIED_CONSENT` is restricted to staff-written one-to-one service
 *     messages and exact typed transactional service notices. Generic
 *     automation and scheduled free-form sends still require GLOBAL_OPT_IN.
 *   - This predicate is a CHEAP PRE-FILTER, not the authority. The authority is
 *     get_service_sms_consent_status() in the database, which is the only thing
 *     that sees duplicate-phone suppression and inbound STOPs that have not been
 *     filed yet. Never send on this predicate alone.
 *   - Still fails closed on no phone / missing automated opt-in / DND /
 *     explicit opt-out, and callers treat unreadable database status as refusal.
 *   - SERVICE_CONSENT is purpose-scoped. Staff direct service messages and the
 *     three typed service notices may consume it; generic automation and
 *     scheduled free-form traffic do not.
 *   - The kill-switch (automation_settings.sms_sending_enabled) is a SEPARATE,
 *     higher gate checked in automated-send.js.
 * ════════════════════════════════════════════════
 */

/**
 * Cheap automated-send pre-filter. Staff person-to-person sends do not use it.
 */
export function consentAllows(row) {
  if (!row) return false;
  if (!row.phone) return false;
  if (row.dnd) return false;
  if (row.opt_out_at) return false;
  if (!row.opt_in_status) return false;
  return true;
}

// ─── SECTION: accepted consent codes ───────────────────────────────────────
// The direct-staff and typed-service exceptions are absent from generic
// automation and free-form scheduling.

/** Staff person-to-person sends via POST /api/send-message. */
export const STAFF_ACCEPTED_CONSENT_CODES = Object.freeze([
  'GLOBAL_OPT_IN',
  'SERVICE_CONSENT',
  'IMPLIED_CONSENT',
]);

/** Automated sends via automated-send.js (reminders, follow-ups, sequences). */
export const AUTOMATED_ACCEPTED_CONSENT_CODES = Object.freeze([
  'GLOBAL_OPT_IN',
]);

/**
 * Exact service notices the owner approved without a recorded opt-in. This
 * registry does not grant the generic automation chokepoint a bypass: each
 * notice needs a dedicated typed producer that derives purpose and copy from a
 * server-owned appointment/signature record. Additions require explicit review.
 */
export const TRANSACTIONAL_SERVICE_SMS_PURPOSES = Object.freeze([
  'appointment_scheduled',
  'appointment_canceled',
  'signature_request',
]);

export const TRANSACTIONAL_SERVICE_ACCEPTED_CONSENT_CODES = Object.freeze([
  'GLOBAL_OPT_IN',
  'SERVICE_CONSENT',
  'IMPLIED_CONSENT',
]);

export function isTransactionalServiceSmsPurpose(value) {
  return TRANSACTIONAL_SERVICE_SMS_PURPOSES.includes(value);
}

/** Scheduled sends drained by process-scheduled.js. */
export const SCHEDULED_ACCEPTED_CONSENT_CODES = Object.freeze([
  'GLOBAL_OPT_IN',
]);

/**
 * True only when the database explicitly allowed the send AND returned a code
 * this path accepts. A null/undefined/unparseable status is always false —
 * never infer permission from a missing answer.
 */
export function isAcceptedConsent(status, acceptedCodes) {
  if (!status || status.allowed !== true) return false;
  return acceptedCodes.includes(status.code);
}
