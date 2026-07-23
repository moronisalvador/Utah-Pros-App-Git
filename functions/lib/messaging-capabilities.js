/**
 * ════════════════════════════════════════════════
 * FILE: messaging-capabilities.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Describes which kinds of customer messages each delivery company can carry.
 *   It also rejects any result that silently changes from the requested kind of
 *   message to another kind.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This future-facing policy is not wired into the active transport.
 *   - Provider-managed fallback is rejected pending a separate owner-approved
 *     policy, consent, persistence, and rollout change.
 * ════════════════════════════════════════════════
 */

export const MESSAGING_CHANNELS = Object.freeze(['sms', 'mms', 'rcs']);

export const PROVIDER_CHANNELS = Object.freeze({
  callrail: Object.freeze(['sms', 'mms']),
  twilio: Object.freeze(['sms', 'mms', 'rcs']),
});

function policyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function assertMessagingChannelDecision({
  provider,
  requestedChannel,
  actualChannel = null,
  fallbackApplied = false,
  fallbackFromChannel = null,
}) {
  const supported = PROVIDER_CHANNELS[provider];
  if (!supported) {
    throw policyError(
      'UNSUPPORTED_MESSAGING_PROVIDER',
      `Unsupported messaging provider: ${String(provider)}`,
    );
  }

  if (!MESSAGING_CHANNELS.includes(requestedChannel) || !supported.includes(requestedChannel)) {
    throw policyError(
      'UNSUPPORTED_MESSAGING_CHANNEL',
      `${provider} does not support requested channel: ${String(requestedChannel)}`,
    );
  }

  if (fallbackApplied || fallbackFromChannel != null) {
    throw policyError(
      'CROSS_CHANNEL_FALLBACK_DISABLED',
      'Cross-channel messaging fallback is disabled',
    );
  }

  if (actualChannel != null) {
    if (!MESSAGING_CHANNELS.includes(actualChannel) || !supported.includes(actualChannel)) {
      throw policyError(
        'UNSUPPORTED_ACTUAL_CHANNEL',
        `${provider} reported unsupported actual channel: ${String(actualChannel)}`,
      );
    }
    if (actualChannel !== requestedChannel) {
      throw policyError(
        'MESSAGING_CHANNEL_MISMATCH',
        `Requested ${requestedChannel} but provider reported ${actualChannel}`,
      );
    }
  }

  return Object.freeze({
    provider,
    requestedChannel,
    actualChannel,
    fallbackApplied: false,
    fallbackFromChannel: null,
  });
}

/**
 * Classify authenticated provider evidence without discarding policy
 * violations. Event callers persist the observation before alerting or
 * disabling future sends.
 */
export function classifyObservedMessagingChannel({
  provider,
  requestedChannel,
  actualChannel,
  fallbackApplied = false,
  fallbackFromChannel = null,
}) {
  const supported = PROVIDER_CHANNELS[provider];
  if (!supported || !MESSAGING_CHANNELS.includes(actualChannel)) {
    throw policyError(
      'UNSUPPORTED_ACTUAL_CHANNEL',
      `${String(provider)} reported unsupported actual channel: ${String(actualChannel)}`,
    );
  }
  const channelMismatch = requestedChannel !== actualChannel;
  const fallbackObserved = fallbackApplied || fallbackFromChannel != null || channelMismatch;
  return Object.freeze({
    provider,
    requestedChannel,
    actualChannel,
    fallbackApplied: fallbackObserved,
    fallbackFromChannel: fallbackFromChannel || (channelMismatch ? requestedChannel : null),
    policyViolation: fallbackObserved,
    violationCode: fallbackObserved ? 'CROSS_CHANNEL_FALLBACK_OBSERVED' : null,
  });
}
