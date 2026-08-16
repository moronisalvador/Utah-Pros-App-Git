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
  localSmsAllowlist, assertLocalSmsDestinationAllowed,
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

describe('local SMS allowlist', () => {
  const OWNER = '+18015551234';
  const ALLOW = { UPR_ENV: 'local', UPR_LOCAL_SMS_ALLOWLIST: OWNER };

  it('is empty by default, so Twilio stays fully blocked locally', () => {
    expect(localSmsAllowlist(LOCAL)).toEqual([]);
    expect(() => assertProviderCallAllowed(LOCAL, 'twilio')).toThrow(/blocked an outbound/);
  });

  it('unblocks the provider only once an allowlist exists', () => {
    expect(assertProviderCallAllowed(ALLOW, 'twilio')).toBe('live-allowlisted');
  });

  it('permits a send to an allowlisted number', () => {
    expect(assertLocalSmsDestinationAllowed(ALLOW, OWNER)).toBe(OWNER);
  });

  it('normalizes formatting on both sides — the same number in any shape is allowed', () => {
    for (const written of ['(801) 555-1234', '801-555-1234', '8015551234', '+1 801 555 1234']) {
      const env = { UPR_ENV: 'local', UPR_LOCAL_SMS_ALLOWLIST: written };
      expect(assertLocalSmsDestinationAllowed(env, OWNER)).toBe(OWNER);
      expect(assertLocalSmsDestinationAllowed(ALLOW, written)).toBe(written);
    }
  });

  it('accepts several numbers', () => {
    const env = { UPR_ENV: 'local', UPR_LOCAL_SMS_ALLOWLIST: `${OWNER}, 801-555-9999` };
    expect(localSmsAllowlist(env)).toEqual([OWNER, '+18015559999']);
    expect(assertLocalSmsDestinationAllowed(env, '+18015559999')).toBe('+18015559999');
  });

  // THE CASE THIS EXISTS FOR. Not the owner texting themselves deliberately —
  // a loop over contacts, which is how one bad iteration becomes hundreds of
  // real texts from a laptop with no deploy gate in front of it.
  it('refuses every customer number a runaway loop would reach', () => {
    const customers = ['+18015550001', '+13855550002', '+18015550003', '+19995550004'];
    for (const c of customers) {
      expect(() => assertLocalSmsDestinationAllowed(ALLOW, c)).toThrow(/not in UPR_LOCAL_SMS_ALLOWLIST/);
    }
  });

  it('refuses a missing or malformed destination rather than passing it through', () => {
    for (const bad of [undefined, null, '', 'not-a-number', '123']) {
      expect(() => assertLocalSmsDestinationAllowed(ALLOW, bad)).toThrow(/refused an SMS|no destination/);
    }
  });

  it('refuses everything when local and no allowlist is configured', () => {
    expect(() => assertLocalSmsDestinationAllowed(LOCAL, OWNER)).toThrow(/no UPR_LOCAL_SMS_ALLOWLIST/);
  });

  // The allowlist is a LOCAL-ONLY brake. It must never constrain the deployed
  // Worker, which legitimately texts customers.
  it('never restricts anything on cloud, even if the variable leaks there', () => {
    expect(localSmsAllowlist(CLOUD)).toEqual([]);
    expect(assertLocalSmsDestinationAllowed(CLOUD, '+18015550001')).toBe('+18015550001');
    const leaked = { UPR_LOCAL_SMS_ALLOWLIST: OWNER }; // set, but UPR_ENV is not local
    expect(assertLocalSmsDestinationAllowed(leaked, '+13855559999')).toBe('+13855559999');
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
