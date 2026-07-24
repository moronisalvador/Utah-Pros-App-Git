/**
 * ════════════════════════════════════════════════
 * FILE: webflow-form-webhook.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two pure pieces of the Webflow lead-webhook's routing logic:
 *   (1) which registered UPR form (and schema) a submission's field shape maps
 *   to — the R2 site design vs. the still-live legacy pages — and (2) whether
 *   the visitor ticked the SMS-consent checkbox, regardless of which of the
 *   two casings ("SMS-consent" vs "SMS-Consent") or value shape (boolean vs.
 *   the string a real Webflow POST delivers) it arrives as.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./webflow-form-webhook.js (resolveForm, consentFromData,
 *              R2_FORM_ID, LEGACY_FORM_ID)
 *
 * NOTES / GOTCHAS:
 *   - Only the pure helpers are unit-tested; the handler's DB writes/side
 *     effects are integration territory — same convention as
 *     twilio-webhook.test.js / callrail-webhook (see forms.test.js for the
 *     shared isTruthy behavior this leans on).
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  resolveForm,
  consentFromData,
  checkSecret,
  onRequestPost,
  R2_FORM_ID,
  LEGACY_FORM_ID,
} from './webflow-form-webhook.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveForm (R2 vs legacy shape detection)', () => {
  it('routes an R2-shaped submission to the R2 form id', () => {
    const data = { 'Full-name': 'Jane Doe', Phone: '3855551234', Email: 'jane@example.com', Mold: 'true' };
    expect(resolveForm(data)).toEqual({ formId: R2_FORM_ID, schema: expect.any(Object) });
  });

  it('routes a legacy-shaped submission to the legacy form id', () => {
    const data = { Name: 'Jane Doe', 'Phone Number': '3855551234', 'Kind of damage': 'Mold' };
    expect(resolveForm(data)).toEqual({ formId: LEGACY_FORM_ID, schema: expect.any(Object) });
  });

  it('returns null for an unrecognized shape (never guesses)', () => {
    expect(resolveForm({ foo: 'bar' })).toBe(null);
    expect(resolveForm({})).toBe(null);
    expect(resolveForm(null)).toBe(null);
  });
});

describe('consentFromData (SMS-consent detection, either casing)', () => {
  it('detects the R2 casing ("SMS-consent")', () => {
    expect(consentFromData({ 'SMS-consent': 'true' })).toBe(true);
    expect(consentFromData({ 'SMS-consent': 'false' })).toBe(false);
  });

  it('detects the legacy casing ("SMS-Consent")', () => {
    expect(consentFromData({ 'SMS-Consent': true })).toBe(true);
  });

  it('is false when the field is missing or unchecked', () => {
    expect(consentFromData({})).toBe(false);
    expect(consentFromData({ 'SMS-consent': '' })).toBe(false);
    expect(consentFromData(null)).toBe(false);
  });
});

describe('checkSecret (fail-closed service-role boundary)', () => {
  const request = (secret) =>
    new Request(`https://example.test/api/webflow-form-webhook?secret=${secret || ''}`);

  it('denies any supplied value when no expected secret is configured', async () => {
    const db = { select: async () => [] };
    await expect(checkSecret(request('attacker-chosen'), db, {})).resolves.toBe(false);
  });

  it('fails closed when the credential lookup fails and no fallback exists', async () => {
    const db = { select: async () => { throw new Error('lookup unavailable'); } };
    await expect(checkSecret(request('attacker-chosen'), db, {})).resolves.toBe(false);
  });

  it('accepts only the configured database secret', async () => {
    const db = { select: async () => [{ value: 'expected-secret' }] };
    await expect(checkSecret(request('expected-secret'), db, {})).resolves.toBe(true);
    await expect(checkSecret(request('wrong-secret'), db, {})).resolves.toBe(false);
  });

  it('uses the environment fallback and still denies missing request credentials', async () => {
    const db = { select: async () => [] };
    const env = { WEBFLOW_WEBHOOK_SECRET: 'fallback-secret' };
    await expect(checkSecret(request('fallback-secret'), db, env)).resolves.toBe(true);
    await expect(
      checkSecret(new Request('https://example.test/api/webflow-form-webhook'), db, env),
    ).resolves.toBe(false);
  });
});

describe('onRequestPost denial side effects', () => {
  const context = (url) => ({
    request: new Request(url, { method: 'POST', body: '{}' }),
    env: {
      SUPABASE_URL: 'https://qa.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-key',
    },
    waitUntil: vi.fn(),
  });

  it('missing request credentials deny before even the credential lookup', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ctx = context('https://example.test/api/webflow-form-webhook');

    const response = await onRequestPost(ctx);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('wrong credentials permit only the exact authentication-secret lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ value: 'expected-secret' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ctx = context(
      'https://example.test/api/webflow-form-webhook?secret=wrong-secret',
    );

    const response = await onRequestPost(ctx);

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://qa.example.test/rest/v1/integration_config?key=eq.webflow_webhook_secret&select=value',
    );
    expect(options).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-only-key',
          apikey: 'test-only-key',
        }),
      }),
    );
    expect(url).not.toContain('/rpc/');
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it('missing server configuration denies after only the exact credential lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ctx = context(
      'https://example.test/api/webflow-form-webhook?secret=attacker-chosen',
    );

    const response = await onRequestPost(ctx);

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/rest/v1/integration_config?key=eq.webflow_webhook_secret&select=value',
    );
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });
});
