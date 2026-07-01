/**
 * ════════════════════════════════════════════════
 * FILE: email-consent.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Answers one yes/no question: is it okay to email this person? It says no
 *   if they've unsubscribed, if their address bounced/complained before
 *   (both tracked in the email_suppressions table), or if they've asked not
 *   to be contacted at all (Do Not Disturb). Every marketing email in the app
 *   has to pass this check first — see functions/lib/automated-send.js,
 *   which is the only place that's allowed to actually send.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none — pure function, no I/O
 *   Internal:  imported by functions/lib/automated-send.js
 *   Data:      reads  → none (caller looks up the row; this just judges it)
 *              writes → none
 *
 * EXPORTS:
 *   emailAllows({ email, suppressed, dnd }) → boolean
 *
 * NOTES / GOTCHAS:
 *   - Deliberately a pure predicate (no DB calls) so it's cheap to unit test
 *     — see email-consent.test.js, committed before this file existed
 *     (docs/crm-roadmap.md Phase 4c test-first requirement).
 *   - `suppressed` must be resolved by the caller against email_suppressions
 *     (case-insensitive email match) before calling this.
 *   - Unlike SMS's opt_in_status (TCPA is opt-in), marketing email in the US
 *     is governed by CAN-SPAM (opt-out based) — so this does NOT require a
 *     prior opt-in, only that the recipient hasn't opted out/bounced/DND'd.
 * ════════════════════════════════════════════════
 */

export function emailAllows(row) {
  if (!row) return false;
  if (!row.email) return false;
  if (row.suppressed) return false;
  if (row.dnd) return false;
  return true;
}
