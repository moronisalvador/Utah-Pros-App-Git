/**
 * ════════════════════════════════════════════════
 * FILE: twilio-errors.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   When Twilio can't deliver a text it hands back a numeric error code. This file
 *   is the one place that translates those raw codes into a plain decision the rest
 *   of the app can act on: a human-readable label to show, whether we should stop
 *   texting that number (suppress), whether the CONTACT should be flagged (they
 *   opted out, or the number is a landline), and a small style token the inbox uses
 *   to colour the failed message. Keeping the meaning in one table means the webhook,
 *   the status worker and the UI all agree on what "30007" means.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, imported by workers)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads/writes → none (pure mapping — callers decide what to persist)
 *
 * EXPORTS:
 *   TWILIO_ERROR_CODES — the frozen lookup table (code → decision object).
 *   classifyTwilioError(code) — normalises a string|number code and returns its
 *     decision object, or DEFAULT_TWILIO_ERROR for an unknown/blank code.
 *   DEFAULT_TWILIO_ERROR — the generic fallback (never suppresses, no contact flag).
 *
 * DECISION OBJECT SHAPE (frozen contract — sms-experience-wave-ownership §7):
 *   {
 *     code:        number,        // the numeric Twilio code (0 for the fallback)
 *     label:       string,        // short human-readable reason
 *     suppress:    boolean,       // true → stop (auto)sending to this number
 *     contactFlag: string|null,   // 'opt_out' | 'invalid_number' | null — hint for
 *                                  //   the caller to update the contact record
 *     uiClass:     string,        // inbox style token: 'blocked' | 'carrier' |
 *                                  //   'unreachable' | 'config' | 'error'
 *   }
 *
 * NOTES / GOTCHAS:
 *   - contactFlag is a SEMANTIC HINT, not a column write. The consumer (Phase A's
 *     twilio-status/webhook) decides how to apply it — e.g. 'opt_out' → set the
 *     contact's opt_in_status=false (+ dnd) and log sms_consent_log; 'invalid_number'
 *     → flag the bad number. This file never touches the database.
 *   - suppress vs contactFlag differ on purpose: 30034 (unregistered A2P sender) and
 *     30007 (carrier content-filtering) are SENDER/CONTENT problems, not the
 *     contact's fault — they do NOT flag or suppress the contact (they are ops /
 *     deliverability signals). Only a real opt-out (21610) or an unreachable number
 *     (30006) suppresses + flags the contact.
 *   - The four codes below are the roadmap's required set; extend the table
 *     additively (never repurpose a token) as new codes are observed.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Mapping table ──────────────
export const TWILIO_ERROR_CODES = {
  // Recipient replied STOP / is on Twilio's blocklist for this sender. Definitive
  // opt-out: suppress future sends AND flag the contact as opted out.
  21610: {
    code: 21610,
    label: 'Recipient opted out (STOP)',
    suppress: true,
    contactFlag: 'opt_out',
    uiClass: 'blocked',
  },
  // Landline or a carrier that cannot receive SMS. Permanent for this number:
  // suppress AND flag the number as invalid.
  30006: {
    code: 30006,
    label: 'Undeliverable — landline or unreachable carrier',
    suppress: true,
    contactFlag: 'invalid_number',
    uiClass: 'unreachable',
  },
  // Carrier filtered the message (spam / content / velocity). A sender/content
  // deliverability signal — NOT a contact opt-out, so no contact flag and no
  // per-contact suppression (fix content / registration, not the recipient).
  30007: {
    code: 30007,
    label: 'Carrier filtered (flagged as spam)',
    suppress: false,
    contactFlag: null,
    uiClass: 'carrier',
  },
  // Message sent from a number not registered to an A2P 10DLC campaign. A
  // registration/config problem on our side — never the contact's fault.
  30034: {
    code: 30034,
    label: 'Unregistered sender (A2P 10DLC)',
    suppress: false,
    contactFlag: null,
    uiClass: 'config',
  },
};

// Generic fallback for any code not in the table (including a blank/absent code).
export const DEFAULT_TWILIO_ERROR = {
  code: 0,
  label: 'Delivery error',
  suppress: false,
  contactFlag: null,
  uiClass: 'error',
};

// ─── SECTION: Helpers ──────────────
// Accepts a string ('30007'), number (30007), null or ''. Returns the decision
// object for a known code, else DEFAULT_TWILIO_ERROR. Never throws.
export function classifyTwilioError(code) {
  if (code === null || code === undefined || code === '') return DEFAULT_TWILIO_ERROR;
  const n = typeof code === 'number' ? code : parseInt(String(code).trim(), 10);
  if (!Number.isFinite(n)) return DEFAULT_TWILIO_ERROR;
  return TWILIO_ERROR_CODES[n] || DEFAULT_TWILIO_ERROR;
}
