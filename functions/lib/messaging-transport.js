/**
 * ════════════════════════════════════════════════
 * FILE: messaging-transport.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives staff-written customer texts one server-side door to the company that
 *   delivers them. It selects an explicitly configured server-side adapter
 *   without teaching the inbox, consent checks, or conversation records about
 *   provider APIs.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./twilio.js, ./callrail-messaging.js
 *   Data:      reads  → none directly
 *              writes → none directly
 *
 * EXPORTS:
 *   resolveMessagingSendMode(env) → disabled | callrail | twilio
 *   resolveMessagingSchemaMode(env) → legacy | foundation
 *   sendMessage(env, message, options?) → the selected adapter's normalized result
 *
 * NOTES / GOTCHAS:
 *   - Provider selection is explicit and server-only. Missing/unknown modes are
 *     resolved to disabled by resolveMessagingSendMode().
 *   - Only the staff person-to-person /api/send-message path imports this seam.
 *     Scheduled and automated sends remain explicitly Twilio-only.
 *   - Unknown/disabled providers fail closed before any provider call. Never add
 *     fallback.
 * ════════════════════════════════════════════════
 */

import { sendMessage as sendTwilioMessage } from './twilio.js';
import { sendCallRailMessage } from './callrail-messaging.js';

const ADAPTERS = Object.freeze({
  twilio: (env, command) => sendTwilioMessage(env, {
    to: command.recipient.address,
    body: command.content.body,
    mediaUrls: command.content.mediaUrls,
    statusCallback: command.statusCallbackUrl,
  }),
  callrail: sendCallRailMessage,
});

export function resolveMessagingSendMode(env) {
  const mode = env?.MESSAGING_SEND_MODE;
  return mode === 'twilio' || mode === 'callrail' || mode === 'disabled'
    ? mode
    : 'disabled';
}

export function resolveMessagingSchemaMode(env) {
  return env?.MESSAGING_SCHEMA_MODE === 'foundation' ? 'foundation' : 'legacy';
}

/**
 * Dispatch a staff-written message through one explicitly selected adapter.
 */
export async function sendMessage(env, message, { provider } = {}) {
  if (provider === 'disabled' || provider == null) {
    const error = new Error('Staff messaging is disabled');
    error.code = 'MESSAGING_SEND_DISABLED';
    throw error;
  }
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
