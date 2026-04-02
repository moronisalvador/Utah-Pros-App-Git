/**
 * Normalize a phone string to E.164 format (+1XXXXXXXXXX).
 * Strips non-digits, prepends US country code for 10-digit numbers.
 */
export function normalizePhone(raw) {
  let phone = (raw || '').replace(/\D/g, '');
  if (phone.length === 10) phone = '1' + phone;
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}
