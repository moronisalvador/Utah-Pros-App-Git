/**
 * ════════════════════════════════════════════════
 * FILE: environment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that the laptop-versus-Cloudflare switch behaves. The most important
 *   thing it proves is a NEGATIVE: that nothing changes for the deployed servers.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./environment.js, ./quickbooks.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';

import {
  uprTier, isLocal, providerMode, assertNotLiveCredential, assertProviderCallAllowed,
} from './environment.js';
import { qboEnvironment } from './quickbooks.js';

const LOCAL = { UPR_ENV: 'local' };
const CLOUD = {};

describe('uprTier', () => {
  it('is cloud unless UPR_ENV is exactly "local"', () => {
    expect(uprTier(CLOUD)).toBe('cloud');
    expect(uprTier({ UPR_ENV: 'production' })).toBe('cloud');
    expect(uprTier({ UPR_ENV: 'Local' })).toBe('cloud'); // case-sensitive on purpose
    expect(uprTier({ UPR_ENV: '' })).toBe('cloud');
    expect(uprTier(undefined)).toBe('cloud');
    expect(uprTier(LOCAL)).toBe('local');
  });

  it('treats a missing env object as cloud, never as local', () => {
    // Fail-safe direction: an unreadable env must not be mistaken for a laptop,
    // because "local" is the permissive-to-mock branch.
    expect(isLocal(undefined)).toBe(false);
    expect(isLocal(null)).toBe(false);
  });
});

describe('providerMode', () => {
  it('is always live on cloud, for every provider', () => {
    for (const p of ['quickbooks', 'stripe', 'twilio', 'callrail', 'encircle', 'anything-new']) {
      expect(providerMode(CLOUD, p)).toBe('live');
    }
  });

  it('maps sandbox-capable providers to sandbox locally', () => {
    expect(providerMode(LOCAL, 'quickbooks')).toBe('sandbox');
    expect(providerMode(LOCAL, 'stripe')).toBe('sandbox');
  });

  it('maps the no-sandbox providers to mock locally', () => {
    for (const p of ['twilio', 'callrail', 'encircle', 'propertymeld', 'webflow']) {
      expect(providerMode(LOCAL, p)).toBe('mock');
    }
  });

  it('denies by default — an unclassified provider is mock, not live', () => {
    expect(providerMode(LOCAL, 'some-provider-added-next-year')).toBe('mock');
    expect(providerMode(LOCAL, '')).toBe('mock');
    expect(providerMode(LOCAL, undefined)).toBe('mock');
  });
});

describe('assertNotLiveCredential', () => {
  it('refuses live Stripe key shapes locally', () => {
    for (const bad of ['sk_live_abc123', 'rk_live_abc123', 'pk_live_abc123']) {
      expect(() => assertNotLiveCredential('stripe', bad, LOCAL)).toThrow(/refuses a live/);
    }
  });

  it('allows test keys locally', () => {
    expect(assertNotLiveCredential('stripe', 'sk_test_abc', LOCAL)).toBe('sk_test_abc');
  });

  it('never interferes on cloud — live keys are correct there', () => {
    expect(assertNotLiveCredential('stripe', 'sk_live_abc', CLOUD)).toBe('sk_live_abc');
  });

  it('passes through empty values without throwing', () => {
    expect(assertNotLiveCredential('stripe', '', LOCAL)).toBe('');
    expect(assertNotLiveCredential('stripe', undefined, LOCAL)).toBe(undefined);
  });
});

describe('assertProviderCallAllowed', () => {
  it('blocks the no-sandbox providers locally', () => {
    for (const p of ['twilio', 'callrail', 'encircle', 'propertymeld']) {
      expect(() => assertProviderCallAllowed(LOCAL, p)).toThrow(/blocked an outbound/);
    }
  });

  it('blocks an unclassified provider locally — deny by default', () => {
    expect(() => assertProviderCallAllowed(LOCAL, 'brand-new-vendor')).toThrow(/blocked an outbound/);
  });

  it('allows sandbox-capable providers locally', () => {
    expect(assertProviderCallAllowed(LOCAL, 'quickbooks')).toBe('sandbox');
    expect(assertProviderCallAllowed(LOCAL, 'stripe')).toBe('sandbox');
  });

  it('never blocks anything on cloud', () => {
    for (const p of ['twilio', 'callrail', 'encircle', 'propertymeld', 'anything']) {
      expect(assertProviderCallAllowed(CLOUD, p)).toBe('live');
    }
  });
});

describe('qboEnvironment — the money path', () => {
  // THIS IS THE LOAD-BEARING TEST. If it ever fails, deployed QuickBooks
  // behaviour has changed, which is the one thing this work must not do.
  it('is byte-identical on cloud to the pre-change behaviour', () => {
    expect(qboEnvironment({})).toBe('production');                              // missing → production
    expect(qboEnvironment({ QBO_ENVIRONMENT: undefined })).toBe('production');
    expect(qboEnvironment({ QBO_ENVIRONMENT: '' })).toBe('production');
    expect(qboEnvironment({ QBO_ENVIRONMENT: 'production' })).toBe('production');
    expect(qboEnvironment({ QBO_ENVIRONMENT: 'PRODUCTION' })).toBe('production');
    expect(qboEnvironment({ QBO_ENVIRONMENT: 'sandbox' })).toBe('sandbox');
    expect(qboEnvironment({ QBO_ENVIRONMENT: 'SANDBOX' })).toBe('sandbox');
    expect(qboEnvironment({ QBO_ENVIRONMENT: 'nonsense' })).toBe('production'); // anything else → production
  });

  it('defaults to sandbox locally', () => {
    expect(qboEnvironment({ UPR_ENV: 'local' })).toBe('sandbox');
    expect(qboEnvironment({ UPR_ENV: 'local', QBO_ENVIRONMENT: 'sandbox' })).toBe('sandbox');
  });

  it('REFUSES production locally rather than silently downgrading', () => {
    // A stray QBO_ENVIRONMENT=production copied into .dev.vars must fail loudly,
    // not quietly resolve to sandbox — a silent downgrade would hide the mistake
    // and a silent upgrade would reach the real company books.
    expect(() => qboEnvironment({ UPR_ENV: 'local', QBO_ENVIRONMENT: 'production' }))
      .toThrow(/refuses QBO_ENVIRONMENT=production/);
  });
});
