/**
 * ════════════════════════════════════════════════
 * FILE: phone.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small phone-number helpers. normalizePhone turns whatever someone typed into
 *   a standard stored form (+18014471917). formatPhone turns that stored form
 *   into a friendly display form ((801) 447-1917) for the screen.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Exports:   normalizePhone(raw) → string|null, formatPhone(raw) → string
 *
 * NOTES / GOTCHAS:
 *   - US-centric: both assume 10-digit US numbers (optionally +1). formatPhone
 *     echoes anything non-US/malformed back unchanged rather than mangling it.
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
