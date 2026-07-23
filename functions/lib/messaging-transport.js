/**
 * ════════════════════════════════════════════════
 * FILE: messaging-transport.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives staff-written customer texts one server-side door to the company that
 *   delivers them. Today that door always hands the message to the existing
 *   Twilio sender. A future provider can be added here without teaching the
 *   inbox, consent checks, or conversation records about provider APIs.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./twilio.js
 *   Data:      reads  → none directly
 *              writes → none directly
 *
 * EXPORTS:
 *   sendMessage(env, message, options?) → the active adapter's unchanged result
 *
 * NOTES / GOTCHAS:
 *   - Phase 1 is behavior-neutral: Twilio is the only registered adapter and the
 *     default. This file does not read environment mode or CallRail settings.
 *   - Only the staff person-to-person /api/send-message path imports this seam.
 *     Scheduled and automated sends remain explicitly Twilio-only.
 *   - Unknown providers fail closed before any provider call. Never add fallback.
 * ════════════════════════════════════════════════
 */

import { sendMessage as sendTwilioMessage } from './twilio.js';

const DEFAULT_PROVIDER = 'twilio';
const ADAPTERS = Object.freeze({
  twilio: sendTwilioMessage,
});

/**
 * Dispatch a staff-written message through one explicitly selected adapter.
 * Existing callers omit options and therefore retain the Twilio path exactly.
 */
export async function sendMessage(env, message, { provider = DEFAULT_PROVIDER } = {}) {
  const adapter = Object.prototype.hasOwnProperty.call(ADAPTERS, provider)
    ? ADAPTERS[provider]
    : undefined;
  if (!adapter) {
    const error = new Error(`Unsupported messaging provider: ${String(provider)}`);
    error.code = 'UNSUPPORTED_MESSAGING_PROVIDER';
    throw error;
  }
  return adapter(env, message);
}
