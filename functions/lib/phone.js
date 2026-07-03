/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/phone.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The worker-side twin of src/lib/phone.js. Turns whatever someone typed
 *   into a standard stored phone form (+18014471917) so server code — SMS
 *   sending, CSV import de-duplication, form lead capture — all compares and
 *   stores numbers the same way the app does. Kept as its own copy because
 *   Cloudflare Pages Functions bundle separately from the React app and can't
 *   import from src/.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (server-side helper, not a page)
 *
 * DEPENDS ON:
 *   Packages:  none — pure function, no I/O
 *   Internal:  none
 *   Exports:   normalizePhone(raw) → string|null, formatPhone(raw) → string
 *
 * NOTES / GOTCHAS:
 *   - Byte-for-byte identical logic to src/lib/phone.js — keep the two in sync.
 *     US-centric: both assume 10-digit US numbers (optionally +1).
 *   - Frozen for the CRM wave (nobody edits) — the phone normalization contract
 *     downstream phases dedupe/consent against.
 * ════════════════════════════════════════════════
 */

/**
 * Normalize a phone string to E.164 format (+1XXXXXXXXXX).
 * Strips non-digits, prepends US country code for 10-digit numbers.
 */
export function normalizePhone(raw) {
  let phone = (raw || '').replace(/\D/g, '');
  if (phone.length === 10) phone = '1' + phone;
  if (phone.length < 10) return null;
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}

/**
 * Format a US phone number for display: "(801) 447-1917".
 * Accepts +1XXXXXXXXXX (E.164) or a bare 10-digit number. Anything else
 * (non-US, malformed) is echoed back unchanged; null/undefined → ''.
 */
export function formatPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  let ten = null;
  if (digits.length === 10) ten = digits;
  else if (digits.length === 11 && digits.startsWith('1')) ten = digits.slice(1);
  if (!ten) return String(raw); // non-US / unexpected → leave as-is
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
