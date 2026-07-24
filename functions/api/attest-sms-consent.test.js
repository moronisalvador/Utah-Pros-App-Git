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
  messagingAuth: null,
  db: null,
}));

vi.mock('../lib/auth.js', () => ({
  requireRole: (...args) => h.auth(...args),
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => h.db,
}));
vi.mock('../lib/messaging-auth.js', () => ({
  requireMessagingAccess: (...args) => h.messagingAuth(...args),
}));

import { onRequestGet, onRequestPost } from './attest-sms-consent.js';

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const ENV = {};

function request(body) {
  return {
    url: `https://app.test/api/attest-sms-consent?contact_id=${CONTACT_ID}`,
    json: vi.fn(async () => body),
    headers: new Headers({
      Authorization: 'Bearer test-token',
      'CF-Connecting-IP': '203.0.113.42',
    }),
  };
}

function validBody(overrides = {}) {
  return {
    contact_id: CONTACT_ID,
    consent_method: 'verbal_permission',
    consent_obtained_on: '2026-07-22',
    evidence_note: 'Customer gave verbal permission during the signed work intake.',
    performed_by: 'forged-client-actor',
    ip_address: '198.51.100.99',
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
  h.messagingAuth = vi.fn(async () => ({
    user: { id: 'auth-user' },
    employee: {
      id: EMPLOYEE_ID,
      role: 'technician',
      is_active: true,
      is_external: false,
    },
  }));
  h.db = {
    rpc: vi.fn(async (name) => (
      name === 'get_service_sms_consent_status'
        ? {
            allowed: true,
            code: 'SERVICE_CONSENT',
            contact_id: CONTACT_ID,
          }
        : {
            ok: true,
            contact_id: CONTACT_ID,
            service_sms_consent: true,
            recorded_by: EMPLOYEE_ID,
          }
    )),
  };
});

describe('GET /api/attest-sms-consent status', () => {
  it('requires messaging access before reading the service-only status', async () => {
    h.messagingAuth = vi.fn(async () => ({
      error: 'Messaging access is not granted for this role',
      code: 'MESSAGING_NOT_AUTHORIZED',
      status: 403,
    }));

    const response = await onRequestGet({ request: request(), env: ENV });

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('returns only the service-role status decision for the requested contact', async () => {
    const response = await onRequestGet({ request: request(), env: ENV });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(h.db.rpc).toHaveBeenCalledWith('get_service_sms_consent_status', {
      p_contact_id: CONTACT_ID,
      p_destination_phone: null,
    });
    expect(await response.json()).toEqual({
      ok: true,
      status: {
        allowed: true,
        code: 'SERVICE_CONSENT',
        contact_id: CONTACT_ID,
      },
    });
  });
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

  it.each(['', '07/22/2026', '2026-02-31', '2026-13-01', '2099-01-01'])(
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

  it('uses the authenticated employee and trusted connection IP, ignoring forged body values', async () => {
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
      p_request_ip: '203.0.113.42',
    });
  });

  it.each([
    ['CONTACT_DND_ACTIVE', 409],
    ['CONTACT_OPTED_OUT', 409],
    ['CONTACT_SUPPRESSION_CHANGED', 409],
    ['CONTACT_PENDING_STOP', 409],
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
