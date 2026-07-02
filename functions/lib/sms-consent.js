/**
 * ════════════════════════════════════════════════
 * FILE: sms-consent.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers one yes/no question: is it okay to text this person? It says no if
 *   we have no number for them, if they've asked not to be contacted at all
 *   (Do Not Disturb), or if they have not opted in to texts. Unlike email
 *   (opt-out based), business SMS in the US is governed by TCPA — prior express
 *   consent is required — so this REQUIRES a real opt-in, not just the absence
 *   of an opt-out. Every automated text has to pass this check first; the only
 *   place allowed to actually send is functions/lib/automated-send.js.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none — pure function, no I/O
 *   Internal:  imported by functions/lib/automated-send.js
 *   Data:      reads  → none (caller looks up the contact; this just judges it)
 *              writes → none
 *
 * EXPORTS:
 *   consentAllows({ phone, opt_in_status, dnd }) → boolean
 *
 * NOTES / GOTCHAS:
 *   - Deliberately a pure predicate (no DB calls) so it's cheap to unit test —
 *     see sms-consent.test.js, committed before this file existed (Phase F
 *     test-first requirement).
 *   - This is the SMS twin of email-consent.js's emailAllows(). The kill-switch
 *     (automation_settings.sms_sending_enabled) is a SEPARATE, higher gate
 *     checked in automated-send.js — consent can pass while sending is globally
 *     disabled, and a disabled send is skipped before this predicate matters.
 *   - `opt_in_status` is the contacts column set true only on a real opt-in
 *     (matches the compliance chain in functions/api/send-message.js).
 * ════════════════════════════════════════════════
 */

export function consentAllows(row) {
  if (!row) return false;
  if (!row.phone) return false;
  if (row.dnd) return false;
  if (!row.opt_in_status) return false;
  return true;
}
