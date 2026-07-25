/**
 * ════════════════════════════════════════════════
 * FILE: process-scheduled.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Phase A hardening of the scheduled-text worker without touching a
 *   real database or provider: the scheduler-secret and active-internal-role auth
 *   gates, the TCPA quiet-hours
 *   deferral (hold the batch overnight, don't text people at 2am), and that a row
 *   another worker already claimed is skipped instead of double-sent. It also
 *   proves successful sends and global-kill-switch deferrals go through the
 *   central automated-message safety gate.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./process-scheduled.js (checkCronSecret, processQueue)
 *
 * NOTES / GOTCHAS:
 *   - Uses an in-memory fake db that records calls. `now` is injected so quiet
 *     hours are deterministic (America/Denver = UTC-6 in July).
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

const sendAutomatedMessageMock = vi.hoisted(() => vi.fn());
const requireRoleMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/automated-send.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendAutomatedMessage: sendAutomatedMessageMock,
  };
});

vi.mock('../lib/auth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requireRole: requireRoleMock,
  };
});

import {
  authorizeRequest,
  checkCronSecret,
  processQueue,
} from './process-scheduled.js';

// Injected clock (America/Denver, MDT = UTC-6 in July):
const QUIET_NOW = new Date('2026-07-09T08:00:00Z');    // 02:00 MDT → inside quiet hours
const SENDABLE_NOW = new Date('2026-07-09T21:00:00Z'); // 15:00 MDT → sendable

function makeDb({
  pending = [],
  claim = true,
  cronSecret = null,
  conversation,
  participants,
  contact,
  consentStatus = { allowed: true, code: 'GLOBAL_OPT_IN' },
} = {}) {
  const calls = { select: [], insert: [], update: [], rpc: [] };
  const db = {
    async select(table, query) {
      calls.select.push({ table, query });
      if (table === 'scheduled_messages') return pending;
      if (table === 'integration_config') return cronSecret ? [{ value: cronSecret }] : [];
      if (table === 'conversations') return conversation ? [conversation] : [];
      if (table === 'conversation_participants') return participants || [];
      if (table === 'contacts') return contact ? [contact] : [];
      return [];
    },
    async insert(table, data) { calls.insert.push({ table, data }); return Array.isArray(data) ? data : [data]; },
    async update(table, filter, data) { calls.update.push({ table, filter, data }); return null; },
    async rpc(fn, params) {
      calls.rpc.push({ fn, params });
      if (fn === 'claim_scheduled_message') return claim;
      if (fn === 'get_service_sms_consent_status') return consentStatus;
      return null;
    },
  };
  return { db, calls };
}

const req = (secret) => ({ headers: { get: (h) => (h === 'x-webhook-secret' ? secret : null) } });

beforeEach(() => {
  sendAutomatedMessageMock.mockReset();
  sendAutomatedMessageMock.mockResolvedValue({
    ok: true,
    skipped: false,
    sid: 'SM_scheduled',
    messageId: 'message-1',
  });
  requireRoleMock.mockReset();
  requireRoleMock.mockResolvedValue({
    employee: {
      id: 'employee-1',
      role: 'admin',
      is_active: true,
      is_external: false,
    },
  });
});

describe('checkCronSecret (auth gate)', () => {
  it('accepts the configured scheduler secret', async () => {
    const { db } = makeDb({ cronSecret: 's3cr3t' });
    expect(await checkCronSecret(req('s3cr3t'), db)).toBe(true);
  });
  it('rejects a wrong secret', async () => {
    const { db } = makeDb({ cronSecret: 's3cr3t' });
    expect(await checkCronSecret(req('nope'), db)).toBe(false);
  });
  it('rejects a missing secret without hitting the DB', async () => {
    const { db, calls } = makeDb({ cronSecret: 's3cr3t' });
    expect(await checkCronSecret(req(null), db)).toBe(false);
    expect(calls.select).toHaveLength(0);
  });
  it('rejects when no secret is configured', async () => {
    const { db } = makeDb({ cronSecret: null });
    expect(await checkCronSecret(req('anything'), db)).toBe(false);
  });
});

describe('processQueue — TCPA quiet-hours deferral', () => {
  it('defers the whole batch outside 8am–9pm and never reads the queue', async () => {
    const { db, calls } = makeDb({ pending: [{ id: 's1' }] });
    const res = await processQueue(db, {}, { now: QUIET_NOW });
    expect(res).toMatchObject({ deferred: true, reason: 'quiet_hours', processed: 0 });
    // It short-circuits before ever querying scheduled_messages or claiming.
    expect(calls.select.some((c) => c.table === 'scheduled_messages')).toBe(false);
    expect(calls.rpc).toHaveLength(0);
    // A worker_runs row is still written for observability.
    expect(calls.insert.some((c) => c.table === 'worker_runs')).toBe(true);
  });
});

describe('processQueue — atomic claim guards the double-send', () => {
  it('skips a row it could not claim (another worker won) and sends nothing', async () => {
    const pending = [{ id: 's1', conversation_id: 'c1', body: 'hi', created_by: null }];
    const { db, calls } = makeDb({ pending, claim: false });
    const res = await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(res.processed).toBe(0);
    expect(calls.rpc).toEqual([{ fn: 'claim_scheduled_message', params: { p_id: 's1' } }]);
    // Not claimed → no message row, no scheduled_messages status write.
    expect(calls.insert.some((c) => c.table === 'messages')).toBe(false);
    expect(calls.update.some((c) => c.table === 'scheduled_messages')).toBe(false);
  });

  it('never writes the retired status="processing" value', async () => {
    const pending = [{ id: 's1', conversation_id: 'c1', body: 'hi', created_by: null }];
    const { db, calls } = makeDb({ pending, claim: false });
    await processQueue(db, {}, { now: SENDABLE_NOW });
    const processingWrite = calls.update.find(
      (c) => c.table === 'scheduled_messages' && c.data?.status === 'processing'
    );
    expect(processingWrite).toBeUndefined();
  });
});

describe('processQueue — fails CLOSED on an unresolvable contact', () => {
  it('marks the row failed and sends nothing when the contact row is missing', async () => {
    const pending = [{ id: 's1', conversation_id: 'c1', body: 'hi', created_by: null }];
    const { db, calls } = makeDb({
      pending, claim: true,
      conversation: { id: 'c1' },
      participants: [{ contact_id: 'gone', phone: '+15551110000' }],
      contact: null, // contact lookup returns no row
    });
    const res = await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(res.processed).toBe(0);
    // Never reached the Twilio send / message insert.
    expect(calls.insert.some((c) => c.table === 'messages')).toBe(false);
    // Row marked failed (compliance could not be checked).
    const failed = calls.update.find((c) => c.table === 'scheduled_messages' && c.data?.status === 'failed');
    expect(failed).toBeTruthy();
  });
});

describe('processQueue — global consent only', () => {
  const pending = [{
    id: 's1',
    conversation_id: 'c1',
    body: 'Scheduled update',
    created_by: null,
  }];
  const base = {
    pending,
    claim: true,
    conversation: { id: 'c1' },
    participants: [{ contact_id: 'contact-1', phone: '+15551110000' }],
    contact: {
      id: 'contact-1',
      phone: '+15551110000',
      opt_in_status: false,
      dnd: false,
    },
  };

  it('does not consume staff-only service consent', async () => {
    const { db, calls } = makeDb({
      ...base,
      consentStatus: { allowed: true, code: 'SERVICE_CONSENT' },
    });

    const res = await processQueue(db, {}, { now: SENDABLE_NOW });

    expect(res.processed).toBe(0);
    expect(calls.insert.some((call) => call.table === 'messages')).toBe(false);
    expect(calls.update).toContainEqual(expect.objectContaining({
      table: 'scheduled_messages',
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('fails closed while a durable STOP awaits projection', async () => {
    const { db, calls } = makeDb({
      ...base,
      consentStatus: { allowed: false, code: 'CONTACT_PENDING_STOP' },
    });

    const res = await processQueue(db, {}, { now: SENDABLE_NOW });

    expect(res.processed).toBe(0);
    expect(calls.insert.some((call) => call.table === 'messages')).toBe(false);
    expect(calls.insert).toContainEqual(expect.objectContaining({
      table: 'sms_consent_log',
      data: expect.objectContaining({
        event_type: 'send_blocked_no_consent',
      }),
    }));
  });
});

describe('authorizeRequest (manual role gate)', () => {
  it('lets the scheduler secret bypass session auth', async () => {
    const { db } = makeDb({ cronSecret: 's3cr3t' });

    const result = await authorizeRequest(req('s3cr3t'), {}, db);

    expect(result).toMatchObject({ authorized: true, actor: 'scheduler' });
    expect(requireRoleMock).not.toHaveBeenCalled();
  });

  it('allows an active internal messaging role for a manual trigger', async () => {
    const { db } = makeDb();

    const result = await authorizeRequest(req(null), {}, db);

    expect(result.authorized).toBe(true);
    expect(requireRoleMock).toHaveBeenCalledWith(
      expect.anything(),
      {},
      db,
      ['admin', 'office', 'project_manager'],
    );
  });

  it('rejects an external employee even if the role itself is allowed', async () => {
    requireRoleMock.mockResolvedValue({
      employee: {
        id: 'external-1',
        role: 'admin',
        is_active: true,
        is_external: true,
      },
    });
    const { db } = makeDb();

    const result = await authorizeRequest(req(null), {}, db);

    expect(result).toMatchObject({ authorized: false, status: 403 });
  });

  it('preserves inactive or insufficient-role denial from the shared auth gate', async () => {
    requireRoleMock.mockResolvedValue({
      error: 'Inactive employee',
      status: 403,
    });
    const { db } = makeDb();

    const result = await authorizeRequest(req(null), {}, db);

    expect(result).toEqual({
      authorized: false,
      error: 'Inactive employee',
      status: 403,
    });
  });
});

describe('processQueue — canonical automated-send gate', () => {
  const pending = [{
    id: 's1',
    conversation_id: 'c1',
    body: 'Scheduled update',
    created_by: 'employee-1',
    media_urls: JSON.stringify(['https://example.test/photo.jpg']),
  }];
  const base = {
    pending,
    claim: true,
    conversation: { id: 'c1' },
    participants: [{ contact_id: 'contact-1', phone: '+15551110000' }],
    contact: {
      id: 'contact-1',
      phone: '+15551110000',
      opt_in_status: true,
      dnd: false,
    },
  };

  it('routes the scheduled MMS through the central gate and does not insert a duplicate message', async () => {
    const { db, calls } = makeDb(base);

    const res = await processQueue(db, {}, { now: SENDABLE_NOW });

    expect(res.processed).toBe(1);
    expect(sendAutomatedMessageMock).toHaveBeenCalledWith(
      'sms',
      'contact-1',
      null,
      {},
      {},
      expect.objectContaining({
        body: 'Scheduled update',
        destinationPhone: '+15551110000',
        mediaUrls: ['https://example.test/photo.jpg'],
        conversationId: 'c1',
        sentBy: 'employee-1',
        recordBody: 'Scheduled update',
        markWaitingOnClient: true,
      }),
    );
    expect(calls.insert.some((call) => call.table === 'messages')).toBe(false);
    expect(calls.update).toContainEqual(expect.objectContaining({
      table: 'scheduled_messages',
      data: expect.objectContaining({
        status: 'sent',
        sent_message_id: 'message-1',
        error_message: null,
      }),
    }));
  });

  it('releases the claim and keeps the row pending when the global SMS switch is off', async () => {
    sendAutomatedMessageMock.mockResolvedValue({
      ok: false,
      skipped: true,
      reason: 'sms_disabled',
    });
    const { db, calls } = makeDb(base);

    const res = await processQueue(db, {}, { now: SENDABLE_NOW });

    expect(res.processed).toBe(0);
    expect(calls.insert.some((call) => call.table === 'messages')).toBe(false);
    expect(calls.update).toContainEqual(expect.objectContaining({
      table: 'scheduled_messages',
      data: expect.objectContaining({
        claimed_at: null,
        error_message: 'Deferred: sms_disabled',
      }),
    }));
    expect(calls.update.some(
      (call) => call.table === 'scheduled_messages' && call.data?.status
    )).toBe(false);
  });

  it('marks an ambiguous provider outcome for reconciliation without a second submission', async () => {
    sendAutomatedMessageMock.mockResolvedValue({
      ok: false,
      skipped: false,
      error: 'provider timeout after submission',
      permanent: false,
      ambiguous: true,
    });
    const { db, calls } = makeDb(base);

    const res = await processQueue(db, {}, { now: SENDABLE_NOW });

    expect(sendAutomatedMessageMock).toHaveBeenCalledTimes(1);
    expect(res.processed).toBe(0);
    expect(calls.update).toContainEqual(expect.objectContaining({
      table: 'scheduled_messages',
      data: expect.objectContaining({
        status: 'failed',
        error_message: expect.stringContaining('Ambiguous provider outcome'),
      }),
    }));
  });
});

describe('processQueue — empty queue', () => {
  it('reports zero processed and writes a worker_runs row', async () => {
    const { db, calls } = makeDb({ pending: [] });
    const res = await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(res.processed).toBe(0);
    expect(calls.insert.some((c) => c.table === 'worker_runs')).toBe(true);
  });
});
