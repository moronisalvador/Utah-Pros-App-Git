/**
 * ════════════════════════════════════════════════
 * FILE: sms-consent.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers one preliminary question for automated texts: does this contact
 *   have a phone, recorded opt-in, and no Do Not Disturb or explicit opt-out?
 *   Staff-written one-to-one service messages have a separately reviewed
 *   implied-permission code, but automation never consumes it.
 *
 *   This file also holds the lists of "allowed" answers each send path will
 *   accept from the database. Only the staff one-to-one list accepts
 *   `IMPLIED_CONSENT`; automated and scheduled traffic require global opt-in.
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
 *     messages. Automation and scheduled sends still require GLOBAL_OPT_IN.
 *   - This predicate is a CHEAP PRE-FILTER, not the authority. The authority is
 *     get_service_sms_consent_status() in the database, which is the only thing
 *     that sees duplicate-phone suppression and inbound STOPs that have not been
 *     filed yet. Never send on this predicate alone.
 *   - Still fails closed on no phone / missing automated opt-in / DND /
 *     explicit opt-out, and callers treat unreadable database status as refusal.
 *   - SERVICE_CONSENT stays staff-only on purpose. It is a purpose-scoped
 *     attestation for one-to-one service messages; automated and scheduled
 *     traffic has never consumed it and still does not.
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
// The staff exception is deliberately absent from automation and scheduling.

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
 * Exact service notices the owner approved without a recorded opt-in. This is
 * deliberately an allowlist rather than a generic "transactional" bypass.
 * Additions require an explicit product/compliance review.
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
