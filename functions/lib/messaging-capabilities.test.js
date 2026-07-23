/**
 * ════════════════════════════════════════════════
 * FILE: messaging-capabilities.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the future messaging vocabulary can describe RCS without turning it
 *   on. It also proves that a delivery company cannot silently downgrade an RCS
 *   request to SMS or MMS.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./messaging-capabilities.js
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Pure contract tests only; they make no provider or database calls.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import {
  MESSAGING_CHANNELS,
  PROVIDER_CHANNELS,
  assertMessagingChannelDecision,
  classifyObservedMessagingChannel,
} from './messaging-capabilities.js';

describe('messaging channel capability policy', () => {
  it('retains an observed fallback as auditable policy-violation evidence', () => {
    expect(classifyObservedMessagingChannel({
      provider: 'twilio',
      requestedChannel: 'rcs',
      actualChannel: 'sms',
    })).toEqual({
      provider: 'twilio',
      requestedChannel: 'rcs',
      actualChannel: 'sms',
      fallbackApplied: true,
      fallbackFromChannel: 'rcs',
      policyViolation: true,
      violationCode: 'CROSS_CHANNEL_FALLBACK_OBSERVED',
    });
  });

  it('reserves a provider-neutral RCS channel without adding it to CallRail', () => {
    expect(MESSAGING_CHANNELS).toEqual(['sms', 'mms', 'rcs']);
    expect(PROVIDER_CHANNELS.twilio).toContain('rcs');
    expect(PROVIDER_CHANNELS.callrail).not.toContain('rcs');
  });

  it('accepts an RCS decision only when Twilio actually used RCS', () => {
    expect(assertMessagingChannelDecision({
      provider: 'twilio',
      requestedChannel: 'rcs',
      actualChannel: 'rcs',
    })).toEqual({
      provider: 'twilio',
      requestedChannel: 'rcs',
      actualChannel: 'rcs',
      fallbackApplied: false,
      fallbackFromChannel: null,
    });
  });

  it('rejects RCS through CallRail', () => {
    expect(() => assertMessagingChannelDecision({
      provider: 'callrail',
      requestedChannel: 'rcs',
    })).toThrow(expect.objectContaining({
      code: 'UNSUPPORTED_MESSAGING_CHANNEL',
    }));
  });

  it.each([
    {
      requestedChannel: 'rcs',
      actualChannel: 'sms',
      fallbackApplied: true,
      fallbackFromChannel: 'rcs',
    },
    {
      requestedChannel: 'rcs',
      actualChannel: 'mms',
      fallbackApplied: false,
      fallbackFromChannel: 'rcs',
    },
  ])('rejects provider-managed RCS fallback facts: %o', (facts) => {
    expect(() => assertMessagingChannelDecision({
      provider: 'twilio',
      ...facts,
    })).toThrow(expect.objectContaining({
      code: 'CROSS_CHANNEL_FALLBACK_DISABLED',
    }));
  });

  it('rejects an unexplained channel mismatch even without a fallback flag', () => {
    expect(() => assertMessagingChannelDecision({
      provider: 'twilio',
      requestedChannel: 'rcs',
      actualChannel: 'sms',
    })).toThrow(expect.objectContaining({
      code: 'MESSAGING_CHANNEL_MISMATCH',
    }));
  });
});
