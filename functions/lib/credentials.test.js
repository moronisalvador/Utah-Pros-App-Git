/**
 * ════════════════════════════════════════════════
 * FILE: credentials.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the credential resolver reads the app database FIRST and only falls
 *   back to the old Cloudflare environment variables when the database has nothing
 *   — the guarantee that lets us cut Stripe/Twilio/Resend keys over to the app
 *   without breaking a single send. Also proves it caches, never throws on a DB
 *   blip, and skips the DB entirely when there are no Supabase credentials.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (unit test — run via `npm test`)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./credentials.js
 *
 * NOTES / GOTCHAS:
 *   - Pure unit test: no network, no real DB. A fake `db` client is passed in so
 *     the resolver never builds a real one. clearCredentialCache() runs between
 *     cases so the 60s cache doesn't leak state across tests.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCredential, clearCredentialCache } from './credentials.js';

// A fake service-role client. `rows` maps table → array; `throws` forces a blip.
function fakeDb({ credentials = [], config = [], throws = false } = {}) {
  return {
    async select(table) {
      if (throws) throw new Error('db blip');
      if (table === 'integration_credentials') return credentials;
      if (table === 'integration_config') return config;
      return [];
    },
  };
}

const DB_ENV = { SUPABASE_URL: 'https://db.test' };

beforeEach(() => clearCredentialCache());

describe('resolveCredential — DB-first, env-fallback', () => {
  it('stripe: uses the DB secret over the env var', async () => {
    const db = fakeDb({ credentials: [{ access_token: 'sk_from_db' }] });
    const env = { ...DB_ENV, STRIPE_SECRET_KEY: 'sk_from_env' };
    expect(await resolveCredential(env, db, 'stripe')).toEqual({ secretKey: 'sk_from_db' });
  });

  it('stripe: falls back to env when the DB row is empty', async () => {
    const db = fakeDb({ credentials: [{ access_token: null }] });
    const env = { ...DB_ENV, STRIPE_SECRET_KEY: 'sk_from_env' };
    expect(await resolveCredential(env, db, 'stripe')).toEqual({ secretKey: 'sk_from_env' });
  });

  it('resend: DB key wins; blank string is treated as absent → env', async () => {
    clearCredentialCache();
    const dbKey = fakeDb({ credentials: [{ access_token: 're_from_db' }] });
    expect(await resolveCredential({ ...DB_ENV, RESEND_API_KEY: 're_env' }, dbKey, 'resend'))
      .toEqual({ apiKey: 're_from_db' });

    clearCredentialCache();
    const dbBlank = fakeDb({ credentials: [{ access_token: '   ' }] });
    expect(await resolveCredential({ ...DB_ENV, RESEND_API_KEY: 're_env' }, dbBlank, 'resend'))
      .toEqual({ apiKey: 're_env' });
  });

  it('twilio: mixes DB token + DB config with env fallback per field', async () => {
    const db = fakeDb({
      credentials: [{ access_token: 'tok_db' }],
      config: [
        { key: 'twilio_account_sid', value: 'AC_db' },
        { key: 'twilio_messaging_service_sid', value: null }, // absent → env
        { key: 'twilio_phone_number', value: '+18010000000' },
      ],
    });
    const env = {
      ...DB_ENV,
      TWILIO_ACCOUNT_SID: 'AC_env',
      TWILIO_AUTH_TOKEN: 'tok_env',
      TWILIO_MESSAGING_SERVICE_SID: 'MG_env',
      TWILIO_PHONE_NUMBER: '+18019999999',
    };
    expect(await resolveCredential(env, db, 'twilio')).toEqual({
      accountSid: 'AC_db',
      authToken: 'tok_db',
      messagingServiceSid: 'MG_env', // fell back
      phoneNumber: '+18010000000',
    });
  });
});

describe('resolveCredential — safety', () => {
  it('skips the DB entirely when there is no SUPABASE_URL (env-only)', async () => {
    // No db passed AND no SUPABASE_URL → must not attempt a read; env is the answer.
    const env = { RESEND_API_KEY: 're_env_only' };
    expect(await resolveCredential(env, null, 'resend')).toEqual({ apiKey: 're_env_only' });
  });

  it('never throws on a DB blip — falls back to env', async () => {
    const db = fakeDb({ throws: true });
    const env = { ...DB_ENV, STRIPE_SECRET_KEY: 'sk_env' };
    expect(await resolveCredential(env, db, 'stripe')).toEqual({ secretKey: 'sk_env' });
  });

  it('returns undefined fields when neither DB nor env has the value', async () => {
    const db = fakeDb({ credentials: [] });
    expect(await resolveCredential(DB_ENV, db, 'stripe')).toEqual({ secretKey: undefined });
  });

  it('caches within the TTL (a second call does not hit the DB again)', async () => {
    let calls = 0;
    const db = {
      async select(table) { calls++; return table === 'integration_credentials' ? [{ access_token: 'sk_db' }] : []; },
    };
    const env = { ...DB_ENV, STRIPE_SECRET_KEY: 'sk_env' };
    await resolveCredential(env, db, 'stripe');
    await resolveCredential(env, db, 'stripe');
    expect(calls).toBe(1); // second call served from cache
  });

  it('rejects an unknown provider', async () => {
    await expect(resolveCredential(DB_ENV, fakeDb(), 'paypal')).rejects.toThrow(/unknown provider/);
  });
});
