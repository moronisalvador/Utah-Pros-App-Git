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
    delete: vi.fn(async () => null),
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
    const db = dbWithTokens([{ id: 'token-1', token: 'private-token' }]);
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
    const db = dbWithTokens([{ id: 'token-1', token: 'private-token' }]);
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
        + '&apns_environment=eq.sandbox&select=id,token',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options, timeout] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.sandbox.push.apple.com/3/device/private-token');
    expect(options.headers).toMatchObject({
      authorization: 'bearer signed-jwt',
      'apns-topic': 'com.example.upr',
      'apns-push-type': 'alert',
      'apns-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(timeout).toBe(15_000);
    expect(result).toEqual({
      sent: 1,
      attempted: 1,
      pruned: 0,
      results: [{ id: 'token-1', ok: true, status: 200 }],
    });
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it.each([
    [410, 'Unregistered'],
    [400, 'BadDeviceToken'],
  ])('prunes permanent %s failures only inside the matching environment', async (status, reason) => {
    const db = dbWithTokens([{ id: 'token-dead', token: 'private-token' }]);
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ reason }),
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

    expect(db.delete).toHaveBeenCalledWith(
      'device_tokens',
      'id=eq.token-dead&apns_environment=eq.production',
    );
    expect(result.pruned).toBe(1);
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('does not prune transient provider failures', async () => {
    const db = dbWithTokens([{ id: 'token-retry', token: 'private-token' }]);
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ reason: 'TooManyRequests' }),
      { status: 429 },
    ));

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

    expect(db.delete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sent: 0, attempted: 1, pruned: 0 });
  });
});
