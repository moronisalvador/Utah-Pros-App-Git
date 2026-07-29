/**
 * ════════════════════════════════════════════════
 * FILE: apns.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves iPhone notifications fail closed when configuration is ambiguous,
 *   target only the matching Apple environment, reuse a stable delivery
 *   identity, and remove only permanently invalid registrations.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./apns.js
 *   Data:      none (database and Apple calls are fakes)
 *
 * NOTES / GOTCHAS:
 *   - No provider credential, real token, or external request is used.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import {
  readApnsConfig,
  sendNativePushToEmployee,
  stableApnsId,
} from './apns.js';

const CONFIG = {
  APNS_P8_KEY: 'synthetic-key',
  APNS_KEY_ID: 'KEY1234567',
  APNS_TEAM_ID: 'TEAM123456',
  APNS_TOPIC: 'com.example.upr',
  APNS_ENV: 'sandbox',
};

function dbWithTokens(tokens) {
  return {
    select: vi.fn(async () => tokens),
    rpc: vi.fn(async (fn) => [
      'claim_native_push_delivery',
      'release_native_push_delivery_claim',
      'prune_stale_native_device_token',
    ].includes(fn)),
  };
}

describe('readApnsConfig', () => {
  it('requires an exact sandbox or production environment', () => {
    expect(readApnsConfig({ ...CONFIG, APNS_ENV: '' })).toMatchObject({
      ok: false,
      missing: expect.arrayContaining(['APNS_ENV']),
    });
    expect(readApnsConfig({ ...CONFIG, APNS_ENV: 'development' })).toMatchObject({
      ok: false,
      missing: expect.arrayContaining(['APNS_ENV']),
    });
    expect(readApnsConfig(CONFIG)).toMatchObject({
      ok: true,
      environment: 'sandbox',
    });
  });
});

describe('stableApnsId', () => {
  it('is a stable UUID-shaped identity derived from notification content', async () => {
    const first = await stableApnsId('appointment.updated:fixture');
    const second = await stableApnsId('appointment.updated:fixture');
    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('sendNativePushToEmployee', () => {
  it('does not read tokens or call Apple when configuration is incomplete', async () => {
    const db = dbWithTokens([{
      id: 'token-1',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    const fetchImpl = vi.fn();

    await expect(sendNativePushToEmployee({
      db,
      env: { ...CONFIG, APNS_ENV: '' },
      employeeId: 'employee-1',
      title: 'Appointment updated',
      body: 'Tomorrow',
      eventKey: 'appointment.updated:1',
      fetchImpl,
    })).resolves.toMatchObject({
      skipped: true,
      reason: 'apns_not_configured',
      attempted: 0,
    });

    expect(db.select).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('queries and calls only the exact configured environment', async () => {
    const db = dbWithTokens([{
      id: 'token-1',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));

    const result = await sendNativePushToEmployee({
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Appointment updated',
      body: 'Tomorrow',
      data: { url: '/tech/appointment/1' },
      eventKey: 'appointment.updated:1',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    expect(db.select).toHaveBeenCalledWith(
      'device_tokens',
      'employee_id=eq.employee-1&platform=eq.ios'
        + '&apns_environment=eq.sandbox&select=id,token,updated_at'
        + '&order=updated_at.desc&limit=5',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options, timeout] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.sandbox.push.apple.com/3/device/private-token');
    expect(options.headers).toMatchObject({
      authorization: 'bearer signed-jwt',
      'apns-topic': 'com.example.upr',
      'apns-push-type': 'alert',
      'apns-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
      'apns-collapse-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    const payload = JSON.parse(options.body);
    const expectedRecipient = await stableApnsId('native-recipient:employee-1');
    expect(payload.aps).toEqual({
      alert: {
        title: 'Utah Pros notification',
        body: 'Open Utah Pros for details.',
      },
      sound: 'default',
    });
    expect(payload.data).toEqual({
      url: '/tech/appointment/1',
      recipient: expectedRecipient,
    });
    expect(payload.data.recipient).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(timeout).toBe(15_000);
    expect(result).toEqual({
      sent: 1,
      attempted: 1,
      pruned: 0,
      retryable: false,
      ambiguous: false,
      results: [{
        id: 'token-1',
        ok: true,
        status: 200,
        provider_attempts: 1,
      }],
    });
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it.each([
    [410, 'Unregistered'],
    [400, 'BadDeviceToken'],
  ])('prunes permanent %s failures only inside the matching environment', async (status, reason) => {
    const db = dbWithTokens([{
      id: 'token-dead',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({
        reason,
        ...(status === 410 ? { timestamp: 1_775_000_000_000 } : {}),
      }),
      { status },
    ));

    const result = await sendNativePushToEmployee({
      db,
      env: { ...CONFIG, APNS_ENV: 'production' },
      employeeId: 'employee-1',
      title: 'Test',
      body: 'Test',
      eventKey: 'owner-test:1',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    expect(db.rpc).toHaveBeenCalledWith(
      'prune_stale_native_device_token',
      expect.objectContaining({
        p_device_token_id: 'token-dead',
        p_token: 'private-token',
        p_apns_environment: 'production',
        p_observed_updated_at: '2026-07-28T12:00:00.000Z',
      }),
    );
    expect(result.pruned).toBe(1);
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('releases, reclaims, and retries an explicit transient provider refusal', async () => {
    const db = dbWithTokens([{
      id: 'token-retry',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ reason: 'TooManyRequests' }),
        { status: 429 },
      ))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const result = await sendNativePushToEmployee({
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Test',
      body: 'Test',
      eventKey: 'owner-test:2',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    expect(db.rpc).not.toHaveBeenCalledWith(
      'prune_stale_native_device_token',
      expect.anything(),
    );
    expect(db.rpc).toHaveBeenCalledWith(
      'release_native_push_delivery_claim',
      expect.objectContaining({ p_delivery_key: expect.any(String) }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      sent: 1,
      attempted: 1,
      pruned: 0,
      retryable: false,
      ambiguous: false,
    });
    expect(result.results[0]).toMatchObject({ provider_attempts: 2 });
  });

  it('retains an ambiguous timeout claim and refuses an automatic replay', async () => {
    const claimed = new Set();
    const db = {
      select: vi.fn(async () => [{
        id: 'token-timeout',
        token: 'private-token',
        updated_at: '2026-07-28T12:00:00.000Z',
      }]),
      rpc: vi.fn(async (fn, params) => {
        if (fn !== 'claim_native_push_delivery') return false;
        if (claimed.has(params.p_delivery_key)) return false;
        claimed.add(params.p_delivery_key);
        return true;
      }),
    };
    const fetchImpl = vi.fn(async () => {
      throw new Error('timeout');
    });
    const input = {
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Ambiguous',
      eventKey: 'same-timeout-event',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    };

    const first = await sendNativePushToEmployee(input);
    const replay = await sendNativePushToEmployee(input);

    expect(first).toMatchObject({ sent: 0, ambiguous: true });
    expect(replay.results[0].reason).toBe('delivery_already_claimed');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(db.rpc).not.toHaveBeenCalledWith(
      'release_native_push_delivery_claim',
      expect.anything(),
    );
  });

  it('keeps a delivered occurrence claimed across token-row re-registration', async () => {
    let tokenRowId = 'token-row-before-logout';
    const claimed = new Set();
    const claimCalls = [];
    const db = {
      select: vi.fn(async () => [{
        id: tokenRowId,
        token: 'same-private-token',
        updated_at: '2026-07-28T12:00:00.000Z',
      }]),
      rpc: vi.fn(async (fn, params) => {
        if (fn !== 'claim_native_push_delivery') return false;
        claimCalls.push(params);
        if (claimed.has(params.p_delivery_key)) return false;
        claimed.add(params.p_delivery_key);
        return true;
      }),
    };
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const input = {
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Stable registration',
      eventKey: 'same-source-event',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    };

    await sendNativePushToEmployee(input);
    tokenRowId = 'token-row-after-reregister';
    const replay = await sendNativePushToEmployee(input);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(replay.results[0].reason).toBe('delivery_already_claimed');
    expect(claimCalls[0].p_device_token_id).not.toBe(
      claimCalls[1].p_device_token_id,
    );
    expect(claimCalls[0].p_device_fingerprint).toBe(
      claimCalls[1].p_device_fingerprint,
    );
    expect(claimCalls[0].p_delivery_key).toBe(claimCalls[1].p_delivery_key);
  });

  it('strips arbitrary producer data and private alert copy before sending the native payload', async () => {
    const db = dbWithTokens([{
      id: 'token-privacy',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));

    await sendNativePushToEmployee({
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Private event for Ada Lovelace',
      body: 'Call +18015550123 about claim 01742',
      data: {
        url: '/tech/messages',
        phone: '+18015550123',
        provider_id: 'secret-provider-id',
        recovery: 'private',
      },
      eventKey: 'privacy:1',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const expectedRecipient = await stableApnsId('native-recipient:employee-1');
    expect(payload.aps).toEqual({
      alert: {
        title: 'Utah Pros notification',
        body: 'Open Utah Pros for details.',
      },
      sound: 'default',
    });
    expect(payload.data).toEqual({
      url: '/',
      recipient: expectedRecipient,
    });
    expect(payload.data.recipient).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const serializedPayload = fetchImpl.mock.calls[0][1].body;
    expect(serializedPayload).not.toContain('Private event for Ada Lovelace');
    expect(serializedPayload).not.toContain('Call +18015550123 about claim 01742');
    expect(serializedPayload).not.toContain('+18015550123');
    expect(serializedPayload).not.toContain('secret-provider-id');
  });

  it.each([
    ['admin route', '/tech/admin/users', null],
    ['malformed encoding', '/tech/appointment/%2Fprivate', null],
    ['oversized path', `/tech/appointment/${'x'.repeat(2_100)}`, null],
    ['sensitive query', '/tech/conversations?token=private-secret', 'private-secret'],
    ['long signing bearer', '/sign/private-signing-token', 'private-signing-token'],
    ['short signing bearer', '/s/private-signing-code', 'private-signing-code'],
    [
      'credential fragment',
      '/set-password#type=recovery&token_type=bearer'
        + '&access_token=private&refresh_token=private',
      'access_token=private',
    ],
  ])('replaces an unsafe %s before serializing APNs data', async (
    _label,
    route,
    secret,
  ) => {
    const db = dbWithTokens([{
      id: 'token-route',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));

    await sendNativePushToEmployee({
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Private producer title',
      data: { url: route },
      eventKey: `unsafe-route:${_label}`,
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    const payload = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(payload.data.url).toBe('/');
    expect(fetchImpl.mock.calls[0][1].body).not.toContain(route);
    if (secret) {
      expect(fetchImpl.mock.calls[0][1].body).not.toContain(secret);
    }
  });

  it('fails closed before Apple when a durable delivery claim cannot be acquired', async () => {
    const db = dbWithTokens([{
      id: 'token-claimed',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    db.rpc.mockResolvedValue(false);
    const fetchImpl = vi.fn();

    const result = await sendNativePushToEmployee({
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Duplicate',
      eventKey: 'same-source-event',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.results[0].reason).toBe('delivery_already_claimed');
  });

  it('bounds total fanout to five newest tokens', async () => {
    const tokens = Array.from({ length: 9 }, (_, index) => ({
      id: `token-${index}`,
      token: `private-token-${index}`,
      updated_at: `2026-07-28T12:00:0${index}.000Z`,
    }));
    const db = dbWithTokens(tokens);
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));

    const result = await sendNativePushToEmployee({
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Bounded',
      eventKey: 'bounded:1',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(result.attempted).toBe(5);
  });

  it('does not prune a 410 without Apple invalidation time evidence', async () => {
    const db = dbWithTokens([{
      id: 'token-refreshed',
      token: 'private-token',
      updated_at: '2026-07-28T12:00:00.000Z',
    }]);
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ reason: 'Unregistered' }),
      { status: 410 },
    ));

    const result = await sendNativePushToEmployee({
      db,
      env: CONFIG,
      employeeId: 'employee-1',
      title: 'Stale response',
      eventKey: 'stale:1',
      fetchImpl,
      signJwtImpl: vi.fn(async () => 'signed-jwt'),
    });

    expect(db.rpc).not.toHaveBeenCalledWith(
      'prune_stale_native_device_token',
      expect.anything(),
    );
    expect(result.pruned).toBe(0);
  });
});
