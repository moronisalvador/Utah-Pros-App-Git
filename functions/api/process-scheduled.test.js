/**
 * Scheduled-worker contract tests: authentication, consent gates, token-fenced
 * queue mutations, and the single-reservation provider boundary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendAutomatedMessageMock = vi.hoisted(() => vi.fn());
const requireOwnerMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/automated-send.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendAutomatedMessage: sendAutomatedMessageMock,
}));

vi.mock('../lib/auth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  requireOwner: requireOwnerMock,
}));

import { authorizeRequest, checkCronSecret, processQueue } from './process-scheduled.js';

const QUIET_NOW = new Date('2026-07-09T08:00:00Z');
const SENDABLE_NOW = new Date('2026-07-09T21:00:00Z');
const req = (secret = null) => ({
  headers: { get: (name) => (name === 'x-webhook-secret' ? secret : null) },
});

function makeDb({
  pending = [],
  claim = true,
  cronSecret = null,
  conversation = { id: 'c1' },
  participants = [{ contact_id: 'contact-1', phone: '+15551110000' }],
  contact = { id: 'contact-1', phone: '+15551110000', opt_in_status: true, dnd: false },
  creatorCapability = true,
  creatorAccess = true,
  manualCapability = true,
  consentStatus = { allowed: true, code: 'GLOBAL_OPT_IN' },
  reservation = { outcome: 'reserved', attempt_id: 'attempt-1' },
  reconcile = { status: 'sent', message_id: 'message-1' },
} = {}) {
  const calls = { select: [], insert: [], update: [], rpc: [] };
  const db = {
    async select(table, query) {
      calls.select.push({ table, query });
      if (table === 'scheduled_messages') return pending;
      if (table === 'integration_config') return cronSecret ? [{ value: cronSecret }] : [];
      if (table === 'conversations') return conversation ? [conversation] : [];
      if (table === 'conversation_participants') return participants;
      if (table === 'contacts') return contact ? [contact] : [];
      if (table === 'employees') return [{ id: 'employee-1', full_name: 'Scheduler' }];
      return [];
    },
    async insert(table, data) { calls.insert.push({ table, data }); return [data]; },
    async update(table, filter, data) { calls.update.push({ table, filter, data }); },
    async rpc(fn, params) {
      calls.rpc.push({ fn, params });
      if (fn === 'claim_scheduled_message_v2') return claim;
      if (fn === 'messaging_employee_has_conversations_capability') {
        return params.p_employee_id === 'manual-owner' ? manualCapability : creatorCapability;
      }
      if (fn === 'messaging_employee_can_access_conversation') return creatorAccess;
      if (fn === 'get_service_sms_consent_status') return consentStatus;
      if (fn === 'reserve_scheduled_message_delivery') return reservation;
      if (fn === 'reconcile_scheduled_message_delivery') return reconcile;
      if (fn === 'release_scheduled_message_claim' || fn === 'fail_scheduled_message_claim') return true;
      return null;
    },
  };
  return { db, calls };
}

function due(overrides = {}) {
  return [{
    id: 's1', conversation_id: 'c1', body: ' Scheduled update ',
    created_by: 'employee-1', media_urls: JSON.stringify(['https://example.test/photo.jpg']),
    ...overrides,
  }];
}

beforeEach(() => {
  sendAutomatedMessageMock.mockReset();
  sendAutomatedMessageMock.mockResolvedValue({
    ok: true, skipped: false, sid: 'SM_scheduled', messageId: 'message-1', deliveryAttemptId: 'attempt-1',
  });
  requireOwnerMock.mockReset();
  requireOwnerMock.mockResolvedValue({
    employee: { id: 'manual-owner', email: 'moroni@utah-pros.com', role: 'admin' },
  });
});

describe('scheduler and manual authorization', () => {
  it('accepts only the configured scheduler secret and does not query for a missing header', async () => {
    const { db, calls } = makeDb({ cronSecret: 's3cr3t' });
    await expect(checkCronSecret(req('s3cr3t'), db)).resolves.toBe(true);
    await expect(checkCronSecret(req('wrong'), db)).resolves.toBe(false);
    await expect(checkCronSecret(req(), db)).resolves.toBe(false);
    expect(calls.select.filter(({ table }) => table === 'integration_config')).toHaveLength(2);
  });

  it('lets the scheduler secret bypass owner and Messages checks', async () => {
    const { db, calls } = makeDb({ cronSecret: 's3cr3t' });
    await expect(authorizeRequest(req('s3cr3t'), {}, db)).resolves.toEqual({ authorized: true, actor: 'scheduler' });
    expect(requireOwnerMock).not.toHaveBeenCalled();
    expect(calls.rpc).toHaveLength(0);
  });

  it('denies a non-owner manual caller before any Messages or queue effect', async () => {
    requireOwnerMock.mockResolvedValue({ error: 'Insufficient role', status: 403 });
    const { db, calls } = makeDb();
    await expect(authorizeRequest(req(), {}, db)).resolves.toEqual({
      authorized: false, error: 'Insufficient role', status: 403,
    });
    expect(calls.rpc).toHaveLength(0);
    expect(calls.select.some(({ table }) => table === 'scheduled_messages')).toBe(false);
  });

  it('denies an owner whose manual Messages capability is absent, with no queue effect', async () => {
    const { db, calls } = makeDb({ manualCapability: false });
    await expect(authorizeRequest(req(), {}, db)).resolves.toEqual({
      authorized: false, error: 'Messaging access is not granted', status: 403,
    });
    expect(calls.rpc).toEqual([{
      fn: 'messaging_employee_has_conversations_capability', params: { p_employee_id: 'manual-owner' },
    }]);
    expect(calls.select.some(({ table }) => table === 'scheduled_messages')).toBe(false);
  });
});

describe('processQueue safety gates', () => {
  it('defers the whole queue during quiet hours without a claim or provider call', async () => {
    const { db, calls } = makeDb({ pending: due() });
    await expect(processQueue(db, {}, { now: QUIET_NOW })).resolves.toMatchObject({ deferred: true, reason: 'quiet_hours' });
    expect(calls.select.some(({ table }) => table === 'scheduled_messages')).toBe(false);
    expect(calls.rpc).toHaveLength(0);
    expect(sendAutomatedMessageMock).not.toHaveBeenCalled();
  });

  it('uses the v2 token-fenced claim and performs no direct scheduled_messages update', async () => {
    const { db, calls } = makeDb({ pending: due(), claim: false });
    await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0]).toMatchObject({
      fn: 'claim_scheduled_message_v2', params: { p_id: 's1', p_claim_token: expect.any(String) },
    });
    expect(calls.rpc.some(({ fn }) => fn === 'claim_scheduled_message')).toBe(false);
    expect(calls.update).toEqual([]);
    expect(sendAutomatedMessageMock).not.toHaveBeenCalled();
  });

  it.each([
    ['existing', { status: 'sent', message_id: 'existing-message' }, 1, 0],
    ['in-flight', { status: 'in_flight' }, 0, 0],
    ['submitting', { status: 'failed', error: 'still submitting' }, 0, 1],
    ['ambiguous', { status: 'failed', error: 'ambiguous provider result' }, 0, 1],
    ['accepted', { status: 'sent', message_id: 'accepted-message' }, 1, 0],
  ])('reconciles an already-linked %s attempt without a second send', async (_state, reconcile, processed, failed) => {
    const { db, calls } = makeDb({ pending: due({ delivery_attempt_id: 'attempt-existing' }), reconcile });
    const result = await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(result.processed).toBe(processed);
    expect(result.failed).toBe(failed);
    expect(calls.rpc).toEqual([{
      fn: 'reconcile_scheduled_message_delivery', params: { p_id: 's1' },
    }]);
    expect(sendAutomatedMessageMock).not.toHaveBeenCalled();
    expect(calls.update).toEqual([]);
  });

  it('does not fail or resubmit a fresh reservation while another worker is at the provider boundary', async () => {
    const pending = due();
    const { db, calls } = makeDb({
      pending,
      reconcile: { status: 'in_flight', delivery_attempt_id: 'attempt-1' },
    });
    let providerCompleted = false;
    const originalRpc = db.rpc.bind(db);
    db.rpc = async (fn, params) => {
      const result = await originalRpc(fn, params);
      if (fn === 'reserve_scheduled_message_delivery') {
        pending[0].delivery_attempt_id = 'attempt-1';
      }
      if (fn === 'reconcile_scheduled_message_delivery' && providerCompleted) {
        return { status: 'sent', message_id: 'message-1' };
      }
      return result;
    };

    let providerEntered;
    const enteredProvider = new Promise((resolve) => { providerEntered = resolve; });
    let releaseProvider;
    const providerBarrier = new Promise((resolve) => { releaseProvider = resolve; });
    sendAutomatedMessageMock.mockImplementation(async (
      _channel,
      _contactId,
      _template,
      _variables,
      _env,
      extra,
    ) => {
      const reserved = await extra.reserveDelivery();
      providerEntered();
      await providerBarrier;
      providerCompleted = true;
      return {
        ok: true,
        skipped: false,
        deliveryAttemptId: reserved.attemptId,
        messageId: 'message-1',
      };
    });

    const firstRun = processQueue(db, {}, { now: SENDABLE_NOW });
    await enteredProvider;
    const concurrentRun = await processQueue(db, {}, { now: SENDABLE_NOW });

    expect(concurrentRun).toMatchObject({ processed: 0, failed: 0 });
    expect(sendAutomatedMessageMock).toHaveBeenCalledTimes(1);
    expect(calls.rpc.filter(({ fn }) => fn === 'claim_scheduled_message_v2')).toHaveLength(1);

    releaseProvider();
    await expect(firstRun).resolves.toMatchObject({ processed: 1, failed: 0 });
    expect(sendAutomatedMessageMock).toHaveBeenCalledTimes(1);
  });
});

describe('processQueue creator and participant revalidation', () => {
  it.each([
    ['capability', false, true],
    ['membership', true, false],
  ])('fails the token-fenced claim when creator %s access was revoked', async (_kind, creatorCapability, creatorAccess) => {
    const { db, calls } = makeDb({ pending: due(), creatorCapability, creatorAccess });
    await expect(processQueue(db, {}, { now: SENDABLE_NOW })).resolves.toMatchObject({ processed: 0, failed: 1 });
    const claim = calls.rpc.find(({ fn }) => fn === 'claim_scheduled_message_v2');
    expect(calls.rpc).toContainEqual({
      fn: 'fail_scheduled_message_claim',
      params: expect.objectContaining({ p_id: 's1', p_claim_token: claim.params.p_claim_token }),
    });
    expect(sendAutomatedMessageMock).not.toHaveBeenCalled();
    expect(calls.update).toEqual([]);
  });

  it.each([
    ['no active customer', []],
    ['participant with no usable phone', [
      { contact_id: 'contact-1', phone: '   ' },
    ]],
    ['multiple active customers', [
      { contact_id: 'contact-1', phone: '+15551110000' },
      { contact_id: 'contact-2', phone: '+15551110001' },
    ]],
  ])('requires exactly one active participant: %s', async (_name, participants) => {
    const { db, calls } = makeDb({ pending: due(), participants });
    await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(calls.rpc.some(({ fn }) => fn === 'fail_scheduled_message_claim')).toBe(true);
    expect(sendAutomatedMessageMock).not.toHaveBeenCalled();
  });
});

describe('processQueue consent and delivery reservation', () => {
  it('fails closed on service-only consent and records the consent block through a token RPC', async () => {
    const { db, calls } = makeDb({ pending: due(), consentStatus: { allowed: true, code: 'SERVICE_CONSENT' } });
    await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(calls.insert).toContainEqual(expect.objectContaining({
      table: 'sms_consent_log', data: expect.objectContaining({ event_type: 'send_blocked_no_consent' }),
    }));
    expect(calls.rpc.some(({ fn }) => fn === 'fail_scheduled_message_claim')).toBe(true);
    expect(sendAutomatedMessageMock).not.toHaveBeenCalled();
    expect(calls.update).toEqual([]);
  });

  it('releases the token-fenced claim when the central SMS kill switch defers the send', async () => {
    sendAutomatedMessageMock.mockResolvedValue({ ok: false, skipped: true, reason: 'sms_disabled' });
    const { db, calls } = makeDb({ pending: due() });
    await processQueue(db, {}, { now: SENDABLE_NOW });
    const claim = calls.rpc.find(({ fn }) => fn === 'claim_scheduled_message_v2');
    expect(calls.rpc).toContainEqual({
      fn: 'release_scheduled_message_claim',
      params: expect.objectContaining({ p_id: 's1', p_claim_token: claim.params.p_claim_token, p_error_message: 'Deferred: sms_disabled' }),
    });
    expect(calls.update).toEqual([]);
  });

  it('reserves exactly one provider delivery after the central gates and reconciles it', async () => {
    let reserveResult;
    sendAutomatedMessageMock.mockImplementation(async (_channel, _contactId, _template, _variables, _env, extra) => {
      reserveResult = await extra.reserveDelivery({ phone: extra.destinationPhone, body: extra.body, mediaUrls: extra.mediaUrls });
      return { ok: true, skipped: false, deliveryAttemptId: reserveResult.attemptId, messageId: 'message-1' };
    });
    const { db, calls } = makeDb({ pending: due() });
    const result = await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(result.processed).toBe(1);
    expect(sendAutomatedMessageMock).toHaveBeenCalledWith('sms', 'contact-1', null, {}, {}, expect.objectContaining({
      body: 'Scheduler: Scheduled update', destinationPhone: '+15551110000',
      mediaUrls: ['https://example.test/photo.jpg'], reserveDelivery: expect.any(Function), maxProviderAttempts: 1,
    }));
    expect(reserveResult).toEqual({ shouldSubmit: true, attemptId: 'attempt-1', reason: null });
    const reserve = calls.rpc.find(({ fn }) => fn === 'reserve_scheduled_message_delivery');
    expect(reserve).toMatchObject({ params: {
      p_id: 's1', p_recipient_contact_id: 'contact-1', p_recipient_address: '+15551110000',
      p_submitted_body: 'Scheduler: Scheduled update', p_canonical_body: 'Scheduled update',
      p_media_urls: ['https://example.test/photo.jpg'], p_claim_token: expect.any(String),
    }});
    expect(calls.rpc.some(({ fn }) => fn === 'reconcile_scheduled_message_delivery')).toBe(true);
    expect(calls.update).toEqual([]);
  });
});
