/**
 * ════════════════════════════════════════════════
 * FILE: attest-sms-consent.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that only authorized internal office staff can record verified prior
 *   SMS permission, that request-supplied actor identities are ignored, and that
 *   invalid evidence or a database-reported STOP/DND state never becomes consent.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/attest-sms-consent.js
 *   Data:      none (auth and database calls are mocked)
 *
 * NOTES / GOTCHAS:
 *   - No provider helper is imported or called; this route cannot send a message.
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: null,
  db: null,
}));

vi.mock('../lib/auth.js', () => ({
  requireRole: (...args) => h.auth(...args),
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => h.db,
}));

import { onRequestPost } from './attest-sms-consent.js';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const ENV = {};

function request(body) {
  return {
    json: vi.fn(async () => body),
    headers: new Headers({ Authorization: 'Bearer test-token' }),
  };
}

function validBody(overrides = {}) {
  return {
    contact_id: CONTACT_ID,
    consent_method: 'verbal_permission',
    consent_obtained_on: '2026-07-22',
    evidence_note: 'Customer gave verbal permission during the signed work intake.',
    performed_by: 'forged-client-actor',
    ...overrides,
  };
}

beforeEach(() => {
  h.auth = vi.fn(async () => ({
    user: { id: 'auth-user' },
    employee: {
      id: EMPLOYEE_ID,
      role: 'office',
      is_active: true,
      is_external: false,
    },
  }));
  h.db = {
    rpc: vi.fn(async () => ({
      ok: true,
      contact_id: CONTACT_ID,
      opt_in_status: true,
      recorded_by: EMPLOYEE_ID,
    })),
  };
});

describe('POST /api/attest-sms-consent authorization', () => {
  it('returns the auth failure before parsing input or calling the RPC', async () => {
    h.auth = vi.fn(async () => ({ error: 'Invalid or expired token', status: 401 }));
    const req = request(validBody());

    const response = await onRequestPost({ request: req, env: ENV });

    expect(response.status).toBe(401);
    expect(req.json).not.toHaveBeenCalled();
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('rejects an external employee before any consent mutation', async () => {
    h.auth = vi.fn(async () => ({
      employee: {
        id: EMPLOYEE_ID,
        role: 'office',
        is_active: true,
        is_external: true,
      },
    }));

    const response = await onRequestPost({ request: request(validBody()), env: ENV });

    expect(response.status).toBe(403);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('asks the shared auth helper for exactly admin and office roles', async () => {
    await onRequestPost({ request: request(validBody()), env: ENV });

    expect(h.auth).toHaveBeenCalledWith(
      expect.anything(),
      ENV,
      h.db,
      ['admin', 'office'],
    );
  });
});

describe('POST /api/attest-sms-consent evidence and audit contract', () => {
  it('rejects an unsupported evidence method without calling the RPC', async () => {
    const response = await onRequestPost({
      request: request(validBody({ consent_method: 'contact_exists' })),
      env: ENV,
    });

    expect(response.status).toBe(400);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('rejects a vague evidence note without calling the RPC', async () => {
    const response = await onRequestPost({
      request: request(validBody({ evidence_note: 'yes' })),
      env: ENV,
    });

    expect(response.status).toBe(400);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it.each(['', '07/22/2026', '2099-01-01'])(
    'rejects invalid consent date %s without calling the RPC',
    async (consentObtainedOn) => {
      const response = await onRequestPost({
        request: request(validBody({ consent_obtained_on: consentObtainedOn })),
        env: ENV,
      });

      expect(response.status).toBe(400);
      expect(h.db.rpc).not.toHaveBeenCalled();
    },
  );

  it('uses the authenticated employee as actor and ignores a forged client actor', async () => {
    const response = await onRequestPost({
      request: request(validBody()),
      env: ENV,
    });

    expect(response.status).toBe(200);
    expect(h.db.rpc).toHaveBeenCalledWith('attest_prior_sms_consent', {
      p_contact_id: CONTACT_ID,
      p_actor_id: EMPLOYEE_ID,
      p_consent_method: 'verbal_permission',
      p_consent_obtained_on: '2026-07-22',
      p_evidence_note: 'Customer gave verbal permission during the signed work intake.',
    });
  });

  it.each([
    ['CONTACT_DND_ACTIVE', 409],
    ['CONTACT_OPTED_OUT', 409],
    ['CONTACT_SUPPRESSION_CHANGED', 409],
  ])('keeps %s fail-closed', async (code, expectedStatus) => {
    h.db.rpc = vi.fn(async () => ({ ok: false, code }));

    const response = await onRequestPost({
      request: request(validBody()),
      env: ENV,
    });

    expect(response.status).toBe(expectedStatus);
    expect((await response.json()).code).toBe(code);
  });
});
