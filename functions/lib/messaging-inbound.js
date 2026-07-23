/**
 * Provider-neutral inbound SMS compliance and contact matching primitives.
 *
 * Provider routes authenticate and normalize their own payloads, then use these
 * helpers so STOP/START/HELP and legacy phone formats behave identically.
 */

import { normalizePhone } from './phone.js';

const STOP_KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'];
const START_KEYWORDS = ['start', 'unstop', 'subscribe', 'yes'];
const HELP_KEYWORDS = ['help', 'info'];
const AMBIGUOUS_CONTENT_KEYWORDS = ['yes', 'info'];
const SMS_SUPPORT_PHONE = '(385) 336-0611';
const SMS_SUPPORT_EMAIL = 'restoration@utah-pros.com';

export function normalizeKeyword(body) {
  return (body || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function detectKeyword(body) {
  const normalized = normalizeKeyword(body);
  if (!normalized) return null;
  if (STOP_KEYWORDS.includes(normalized)) return 'stop';
  if (START_KEYWORDS.includes(normalized)) return 'start';
  if (HELP_KEYWORDS.includes(normalized)) return 'help';
  return null;
}

export function isAmbiguousContentReply(body) {
  return AMBIGUOUS_CONTENT_KEYWORDS.includes(normalizeKeyword(body));
}

export function phoneMatchVariants(rawPhone) {
  const e164 = normalizePhone(rawPhone);
  if (!e164) return [];
  const ten = e164.slice(2);
  const area = ten.slice(0, 3);
  const exchange = ten.slice(3, 6);
  const subscriber = ten.slice(6);
  return [
    e164,
    ten,
    `1${ten}`,
    `(${area}) ${exchange}-${subscriber}`,
    `${area}-${exchange}-${subscriber}`,
    `${area}.${exchange}.${subscriber}`,
  ];
}

export function buildPhoneOrFilter(rawPhone) {
  const variants = phoneMatchVariants(rawPhone);
  if (variants.length === 0) {
    return `phone=eq.${encodeURIComponent(rawPhone)}&limit=1`;
  }
  const encodeLiteral = (value) => (
    encodeURIComponent(`"${value}"`).replace(/\(/g, '%28').replace(/\)/g, '%29')
  );
  const conditions = [...new Set(variants)]
    .map((value) => `phone.eq.${encodeLiteral(value)}`);
  return `or=(${conditions.join(',')})`;
}

export function keywordReplyBody(keyword, { advancedOptOut = false } = {}) {
  if (advancedOptOut) return '';
  switch (keyword) {
    case 'stop':
      return 'You have been unsubscribed from Utah Pros Restoration messages. ' +
        'Reply START to re-subscribe. For help, reply HELP.';
    case 'start':
      return 'You have been re-subscribed to Utah Pros Restoration messages. ' +
        'Reply STOP to unsubscribe at any time.';
    case 'help':
      return 'Utah Pros Restoration — SMS Support\n' +
        `For help, call ${SMS_SUPPORT_PHONE} or email ${SMS_SUPPORT_EMAIL}.\n` +
        'Reply STOP to unsubscribe. Msg & data rates may apply.';
    default:
      return '';
  }
}
