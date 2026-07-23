import { describe, expect, it } from 'vitest';
import { buildMessagingSetupStatus } from './messaging-setup.js';

const READY_ENV = {
  CF_PAGES_BRANCH: 'dev',
  MESSAGING_SCHEMA_MODE: 'foundation',
  MESSAGING_SEND_MODE: 'callrail',
  CALLRAIL_COMPANY_ID: 'COM123',
  CALLRAIL_TRACKING_NUMBER: '+18015550100',
  CALLRAIL_SIGNING_KEY: 'write-only-secret',
};

describe('buildMessagingSetupStatus', () => {
  it('reports a fully configured CallRail binding without exposing secrets', () => {
    const status = buildMessagingSetupStatus(READY_ENV, {
      credentialConfigured: true,
      accountResolved: true,
      health: {
        checked: true,
        lastTextWebhookAt: '2026-07-23T20:00:00.000Z',
        pendingEvents: 2,
        ambiguousAttempts: 1,
      },
    });

    expect(status.transport).toEqual(expect.objectContaining({
      schema_mode: 'foundation',
      send_mode: 'callrail',
      mode_mutable_in_app: false,
      outbound_enabled: false,
    }));
    expect(status.callrail.selected_sender_last4).toBe('0100');
    expect(status.callrail.ready_for_activation).toBe(false);
    expect(status.blockers).toEqual([
      { code: 'CALLRAIL_EVENTS_PENDING', scope: 'health' },
      { code: 'CALLRAIL_ATTEMPTS_AMBIGUOUS', scope: 'health' },
      { code: 'CALLRAIL_SENDER_DISCOVERY_REQUIRED', scope: 'verification' },
    ]);
    expect(status.capabilities.cross_channel_fallback).toBe(false);
    expect(JSON.stringify(status)).not.toContain('write-only-secret');
    expect(JSON.stringify(status)).not.toContain('+18015550100');
  });

  it('fails closed for missing and unknown modes with deterministic blockers', () => {
    const status = buildMessagingSetupStatus({
      MESSAGING_SEND_MODE: 'CALLRAIL',
      MESSAGING_SCHEMA_MODE: 'FOUNDATION',
    });

    expect(status.transport).toEqual(expect.objectContaining({
      schema_mode: 'legacy',
      send_mode: 'disabled',
      outbound_enabled: false,
    }));
    expect(status.blockers.map((item) => item.code)).toEqual([
      'MESSAGING_SCHEMA_NOT_FOUNDATION',
      'CALLRAIL_CREDENTIAL_MISSING',
      'CALLRAIL_ACCOUNT_MISSING',
      'CALLRAIL_COMPANY_MISSING',
      'CALLRAIL_TRACKING_NUMBER_MISSING',
      'CALLRAIL_SIGNING_KEY_MISSING',
      'MESSAGING_SEND_DISABLED',
    ]);
  });

  it('never reports outbound enabled for the Twilio mode', () => {
    const status = buildMessagingSetupStatus(
      { ...READY_ENV, MESSAGING_SEND_MODE: 'twilio', CF_PAGES_BRANCH: 'main' },
      { credentialConfigured: true, accountResolved: true },
    );

    expect(status.environment).toBe('production');
    expect(status.transport.outbound_enabled).toBe(false);
    expect(status.blockers).toContainEqual({
      code: 'TWILIO_IS_ACTIVE_PROVIDER',
      scope: 'activation',
    });
  });

  it('keeps activation unverified until discovery matches the configured sender', () => {
    const status = buildMessagingSetupStatus(
      { ...READY_ENV, MESSAGING_SEND_MODE: 'disabled' },
      {
        credentialConfigured: true,
        accountResolved: true,
        health: { checked: true },
      },
    );

    expect(status.callrail.binding_presence_complete).toBe(true);
    expect(status.callrail.ready_for_activation).toBe(false);
    expect(status.transport.outbound_enabled).toBe(false);
    expect(status.blockers).toEqual([
      { code: 'CALLRAIL_SENDER_DISCOVERY_REQUIRED', scope: 'verification' },
      { code: 'MESSAGING_SEND_DISABLED', scope: 'activation' },
    ]);
  });
});
