/**
 * ════════════════════════════════════════════════
 * FILE: notification-test.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the owner notification diagnostic cannot target another employee or
 *   choose arbitrary content, verifies each fixed delivery channel, and checks
 *   safe typed-event delivery without contacting a real provider or database.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./notification-test.js
 *   Data:      none; every database/provider boundary is a fake
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleNotificationTest,
  runNotificationTest,
} from './notification-test.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE = {
  id: 'owner-employee',
  email: 'owner@example.com',
  role: 'admin',
  is_external: false,
};

function request(body) {
  return new Request('https://dev.utahpros.app/api/notification-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function dbHarness() {
  return {
    rpc: vi.fn(async (fn) => {
      if (fn === 'claim_notification_delivery_diagnostic') {
        return { claimed: true, state: 'pending' };
      }
      if (fn === 'complete_notification_delivery_diagnostic') {
        return { completed: true };
      }
      return null;
    }),
    select: vi.fn(),
    delete: vi.fn(),
  };
}

function configureTypedCatalog(db, {
  typeKey = 'lead.new',
  label = 'New lead',
  enabled = true,
  override = null,
  subscriptions = [],
} = {}) {
  db.select.mockImplementation(async (table) => {
    if (table === 'notification_types') {
      return [{ type_key: typeKey, label, enabled }];
    }
    if (table === 'notification_presentation_overrides') {
      return override ? [override] : [];
    }
    if (table === 'push_subscriptions') return subscriptions;
    return [];
  });
}

describe('POST /api/notification-test', () => {
  it('requires the owner gate before any diagnostic side effect', async () => {
    const runTestImpl = vi.fn();
    const result = await handleNotificationTest({
      request: request({ channel: 'bell', request_id: REQUEST_ID }),
      env: {},
      db: dbHarness(),
      requireOwnerImpl: vi.fn().mockResolvedValue({
        error: 'Insufficient role',
        status: 403,
      }),
      runTestImpl,
    });

    expect(result).toEqual({
      status: 403,
      data: { error: 'Insufficient role' },
    });
    expect(runTestImpl).not.toHaveBeenCalled();
  });

  it.each([
    { channel: 'sms', request_id: REQUEST_ID },
    { channel: 'bell', request_id: 'not-a-uuid' },
    { channel: 'bell', request_id: REQUEST_ID, employee_id: 'victim' },
    { channel: 'bell', request_id: REQUEST_ID, title: 'arbitrary' },
    { channel: 'bell', request_id: REQUEST_ID, route: '/billing' },
    { channel: 'email', request_id: REQUEST_ID, type_key: 'lead.new' },
    { channel: 'bell', request_id: REQUEST_ID, type_key: 'future.unknown' },
  ])('rejects unsupported channels and caller-selected scope: %o', async (body) => {
    const runTestImpl = vi.fn();
    const result = await handleNotificationTest({
      request: request(body),
      env: {},
      db: dbHarness(),
      requireOwnerImpl: vi.fn().mockResolvedValue({ employee: EMPLOYEE }),
      runTestImpl,
    });

    expect(result.status).toBe(400);
    expect(runTestImpl).not.toHaveBeenCalled();
  });

  it('passes only the authenticated owner and fixed request scope to the runner', async () => {
    const db = dbHarness();
    const runTestImpl = vi.fn().mockResolvedValue({
      channel: 'email',
      ok: true,
      sent: 1,
      attempted: 1,
      pruned: 0,
    });
    const result = await handleNotificationTest({
      request: request({ channel: 'email', request_id: REQUEST_ID }),
      env: { marker: true },
      db,
      requireOwnerImpl: vi.fn().mockResolvedValue({ employee: EMPLOYEE }),
      runTestImpl,
    });

    expect(result.status).toBe(200);
    expect(runTestImpl).toHaveBeenCalledWith({
      db,
      env: { marker: true },
      employee: EMPLOYEE,
      channel: 'email',
      requestId: REQUEST_ID,
    });
  });

  it('passes one allowlisted catalog type without accepting copy or a recipient', async () => {
    const db = dbHarness();
    const runTestImpl = vi.fn().mockResolvedValue({
      channel: 'native_push',
      type_key: 'lead.new',
      ok: true,
      sent: 1,
      attempted: 1,
      pruned: 0,
    });
    const result = await handleNotificationTest({
      request: request({
        channel: 'native_push',
        request_id: REQUEST_ID,
        type_key: 'lead.new',
      }),
      env: { APNS_ENV: 'sandbox' },
      db,
      requireOwnerImpl: vi.fn().mockResolvedValue({ employee: EMPLOYEE }),
      runTestImpl,
    });

    expect(result.status).toBe(200);
    expect(runTestImpl).toHaveBeenCalledWith({
      db,
      env: { APNS_ENV: 'sandbox' },
      employee: EMPLOYEE,
      channel: 'native_push',
      requestId: REQUEST_ID,
      typeKey: 'lead.new',
    });
  });
});

describe('runNotificationTest', () => {
  let db;

  beforeEach(() => {
    db = dbHarness();
  });

  it('writes one fixed bell row addressed only to the owner', async () => {
    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'bell',
      requestId: REQUEST_ID,
    });

    expect(result).toMatchObject({
      channel: 'bell',
      ok: true,
      sent: 1,
      settled: true,
    });
    expect(db.rpc).toHaveBeenCalledWith('create_notification', {
      p_type: 'owner.notification_test',
      p_title: 'UPR bell test',
      p_body: 'In-app bell notifications are working for your account.',
      p_link: '/dev-tools?tab=advanced&sub=notifications',
      p_entity_type: null,
      p_entity_id: null,
      p_job_id: null,
      p_payload: { diagnostic_request_id: REQUEST_ID },
      p_recipient_id: EMPLOYEE.id,
      p_type_key: null,
    });
  });

  it('replays a completed request without repeating any delivery side effect', async () => {
    const stored = {
      channel: 'web_push',
      ok: true,
      sent: 1,
      attempted: 1,
      pruned: 0,
    };
    db.rpc.mockResolvedValue({
      claimed: false,
      state: 'complete',
      result: stored,
    });
    const sendWebPushImpl = vi.fn();

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'web_push',
      requestId: REQUEST_ID,
      sendWebPushImpl,
    });

    expect(result).toEqual({
      ...stored,
      replayed: true,
      settled: true,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(sendWebPushImpl).not.toHaveBeenCalled();
  });

  it('no-ops an in-progress replay instead of risking a duplicate side effect', async () => {
    db.rpc.mockResolvedValue({
      claimed: false,
      state: 'pending',
      result: null,
    });
    const sendEmailImpl = vi.fn();

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'email',
      requestId: REQUEST_ID,
      sendEmailImpl,
    });

    expect(result).toMatchObject({
      channel: 'email',
      ok: false,
      reason: 'delivery_in_progress',
      replayed: true,
      settled: false,
    });
    expect(sendEmailImpl).not.toHaveBeenCalled();
  });

  it('fails closed before delivery when the durable claim is unavailable', async () => {
    db.rpc.mockRejectedValue(new Error('claim RPC missing'));
    const sendEmailImpl = vi.fn();

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'email',
      requestId: REQUEST_ID,
      sendEmailImpl,
    });

    expect(result).toMatchObject({
      channel: 'email',
      ok: false,
      reason: 'claim_unavailable',
    });
    expect(sendEmailImpl).not.toHaveBeenCalled();
  });

  it('sends fixed browser push only to the owner subscriptions and prunes expiry', async () => {
    db.select.mockResolvedValue([
      { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' },
      { id: 'sub-2', endpoint: 'https://push.example/2', p256dh: 'p2', auth: 'a2' },
    ]);
    const sendWebPushImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201 })
      .mockResolvedValueOnce({ ok: false, status: 410 });

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'web_push',
      requestId: REQUEST_ID,
      loadVapidConfigImpl: vi.fn().mockResolvedValue({ ok: true, publicKey: 'public' }),
      sendWebPushImpl,
      fetchImpl: vi.fn(),
    });

    expect(db.select).toHaveBeenCalledWith(
      'push_subscriptions',
      `employee_id=eq.${EMPLOYEE.id}&select=id,endpoint,p256dh,auth&limit=20`,
    );
    expect(sendWebPushImpl).toHaveBeenCalledTimes(2);
    expect(db.delete).toHaveBeenCalledWith('push_subscriptions', 'id=eq.sub-2');
    expect(result).toEqual({
      channel: 'web_push',
      ok: true,
      sent: 1,
      attempted: 2,
      pruned: 1,
      settled: true,
    });
  });

  it('writes one synthetic typed bell using server-owned sample copy and owner scope', async () => {
    configureTypedCatalog(db);

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'bell',
      requestId: REQUEST_ID,
      typeKey: 'lead.new',
    });

    const claimCall = db.rpc.mock.calls.find(
      ([fn]) => fn === 'claim_notification_delivery_diagnostic',
    );
    const derivedRequestId = claimCall[1].p_request_id;
    expect(derivedRequestId).not.toBe(REQUEST_ID);
    expect(derivedRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(db.rpc).toHaveBeenCalledWith('create_notification', {
      p_type: 'lead.new',
      p_title: 'New lead · Jordan Lee',
      p_body: 'Source: Website form',
      p_link: '/dev-tools?tab=advanced&sub=notifications',
      p_entity_type: null,
      p_entity_id: null,
      p_job_id: null,
      p_payload: {
        diagnostic_request_id: derivedRequestId,
        diagnostic_type_key: 'lead.new',
      },
      p_recipient_id: EMPLOYEE.id,
      p_type_key: 'lead.new',
    });
    expect(result).toMatchObject({
      channel: 'bell',
      type_key: 'lead.new',
      label: 'New lead',
      title: 'New lead · Jordan Lee',
      ok: true,
      sent: 1,
      settled: true,
    });
  });

  it('can present a registered type even when its real-event master switch is disabled', async () => {
    configureTypedCatalog(db, { enabled: false });

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'bell',
      requestId: REQUEST_ID,
      typeKey: 'lead.new',
    });

    expect(db.rpc).toHaveBeenCalledWith(
      'create_notification',
      expect.objectContaining({
        p_recipient_id: EMPLOYEE.id,
        p_type_key: 'lead.new',
      }),
    );
    expect(result).toMatchObject({
      channel: 'bell',
      type_key: 'lead.new',
      ok: true,
      sent: 1,
      settled: true,
    });
  });

  it('uses a validated live override and unique tag for one typed PWA delivery', async () => {
    configureTypedCatalog(db, {
      override: {
        enabled: true,
        title_template: 'Test lead · {{customer_name}}',
        body_template: 'From {{lead_source}}',
        route_id: 'field.home',
        contract_version: 1,
      },
      subscriptions: [
        { id: 'sub-1', endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' },
      ],
    });
    const sendWebPushImpl = vi.fn().mockResolvedValue({ ok: true, status: 201 });

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'web_push',
      requestId: REQUEST_ID,
      typeKey: 'lead.new',
      loadVapidConfigImpl: vi.fn().mockResolvedValue({ ok: true, publicKey: 'public' }),
      sendWebPushImpl,
      fetchImpl: vi.fn(),
    });

    const payload = JSON.parse(sendWebPushImpl.mock.calls[0][1]);
    expect(payload).toMatchObject({
      title: 'Test lead · Jordan Lee',
      body: 'From Website form',
      url: '/dev-tools?tab=advanced&sub=notifications',
      data: { url: '/dev-tools?tab=advanced&sub=notifications' },
    });
    expect(payload.tag).toMatch(/^upr-type-test:lead\.new:/);
    expect(result).toMatchObject({
      channel: 'web_push',
      type_key: 'lead.new',
      ok: true,
      sent: 1,
      settled: true,
    });
  });

  it('uses the stable request identity for the fixed native owner test', async () => {
    const sendNativePushImpl = vi.fn().mockResolvedValue({
      sent: 1,
      attempted: 1,
      pruned: 0,
    });

    const result = await runNotificationTest({
      db,
      env: { APNS_ENV: 'sandbox' },
      employee: EMPLOYEE,
      channel: 'native_push',
      requestId: REQUEST_ID,
      sendNativePushImpl,
    });

    expect(sendNativePushImpl).toHaveBeenCalledWith({
      db,
      env: { APNS_ENV: 'sandbox' },
      employeeId: EMPLOYEE.id,
      typeKey: 'owner.native_push_test',
      eventKey: `owner-native-push-test:${REQUEST_ID}`,
    });
    expect(result).toMatchObject({ channel: 'native_push', ok: true, sent: 1 });
  });

  it('uses the real catalog key and a namespaced occurrence for typed native delivery', async () => {
    configureTypedCatalog(db);
    const sendNativePushImpl = vi.fn().mockResolvedValue({
      sent: 1,
      attempted: 1,
      pruned: 0,
    });

    const result = await runNotificationTest({
      db,
      env: { APNS_ENV: 'sandbox' },
      employee: EMPLOYEE,
      channel: 'native_push',
      requestId: REQUEST_ID,
      typeKey: 'lead.new',
      sendNativePushImpl,
    });

    expect(sendNativePushImpl).toHaveBeenCalledTimes(1);
    const input = sendNativePushImpl.mock.calls[0][0];
    expect(input).toMatchObject({
      db,
      env: { APNS_ENV: 'sandbox' },
      employeeId: EMPLOYEE.id,
      typeKey: 'lead.new',
      notificationBody: {
        payload: { diagnostic_type_key: 'lead.new' },
      },
    });
    expect(input.eventKey).toMatch(/^owner-native-type-test:/);
    expect(input.eventKey).not.toContain(REQUEST_ID);
    expect(result).toMatchObject({
      channel: 'native_push',
      type_key: 'lead.new',
      ok: true,
      sent: 1,
      settled: true,
    });
  });

  it('replays one typed event without re-contacting its provider', async () => {
    configureTypedCatalog(db);
    const stored = {
      channel: 'native_push',
      ok: true,
      sent: 1,
      attempted: 1,
      pruned: 0,
    };
    db.rpc.mockResolvedValue({
      claimed: false,
      state: 'complete',
      result: stored,
    });
    const sendNativePushImpl = vi.fn();

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'native_push',
      requestId: REQUEST_ID,
      typeKey: 'lead.new',
      sendNativePushImpl,
    });

    expect(sendNativePushImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ...stored,
      type_key: 'lead.new',
      replayed: true,
      settled: true,
    });
  });

  it('sends fixed transactional copy to the owner email with provider idempotency', async () => {
    const sendEmailImpl = vi.fn().mockResolvedValue({ ok: true });

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'email',
      requestId: REQUEST_ID,
      sendEmailImpl,
    });

    expect(sendEmailImpl).toHaveBeenCalledWith({}, {
      to: EMPLOYEE.email,
      from: 'UPR - Notifications <restoration@utahpros.app>',
      subject: 'UPR email notification test',
      text: 'Email notifications are working for your account.',
      html: '<p>Email notifications are working for your account.</p>',
      idempotencyKey: `owner-notification-test/email/${REQUEST_ID}`,
    });
    expect(result).toMatchObject({ channel: 'email', ok: true, sent: 1 });
  });

  it('fails closed when the owner has no email address', async () => {
    const sendEmailImpl = vi.fn();
    const result = await runNotificationTest({
      db,
      env: {},
      employee: { ...EMPLOYEE, email: null },
      channel: 'email',
      requestId: REQUEST_ID,
      sendEmailImpl,
    });

    expect(sendEmailImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      channel: 'email',
      ok: false,
      reason: 'no_email',
    });
  });

  it.each([
    ['native_push', 'sendNativePushImpl'],
    ['email', 'sendEmailImpl'],
  ])('normalizes a thrown %s provider failure without exposing details', async (channel, seam) => {
    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel,
      requestId: REQUEST_ID,
      [seam]: vi.fn().mockRejectedValue(new Error('provider secret detail')),
    });

    expect(result).toMatchObject({
      channel,
      ok: false,
      reason: 'delivery_failed',
    });
    expect(JSON.stringify(result)).not.toContain('provider secret detail');
  });

  it('keeps a claimed request pending when its result cannot be durably recorded', async () => {
    db.rpc.mockImplementation(async (fn) => {
      if (fn === 'claim_notification_delivery_diagnostic') {
        return { claimed: true, state: 'pending' };
      }
      if (fn === 'complete_notification_delivery_diagnostic') {
        throw new Error('database response lost');
      }
      return null;
    });
    const sendEmailImpl = vi.fn().mockResolvedValue({ ok: true });

    const result = await runNotificationTest({
      db,
      env: {},
      employee: EMPLOYEE,
      channel: 'email',
      requestId: REQUEST_ID,
      sendEmailImpl,
    });

    expect(sendEmailImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      channel: 'email',
      ok: false,
      reason: 'delivery_outcome_unconfirmed',
      settled: false,
    });
  });
});
