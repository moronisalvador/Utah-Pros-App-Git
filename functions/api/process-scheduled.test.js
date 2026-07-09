/**
 * ════════════════════════════════════════════════
 * FILE: process-scheduled.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Phase A hardening of the scheduled-text worker without touching a
 *   real database or Twilio: the scheduler-secret auth gate, the TCPA quiet-hours
 *   deferral (hold the batch overnight, don't text people at 2am), and that a row
 *   another worker already claimed is skipped instead of double-sent.
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
import { describe, it, expect } from 'vitest';
import { checkCronSecret, processQueue } from './process-scheduled.js';

// Injected clock (America/Denver, MDT = UTC-6 in July):
const QUIET_NOW = new Date('2026-07-09T08:00:00Z');    // 02:00 MDT → inside quiet hours
const SENDABLE_NOW = new Date('2026-07-09T21:00:00Z'); // 15:00 MDT → sendable

function makeDb({ pending = [], claim = true, cronSecret = null, conversation, participants, contact } = {}) {
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
    async rpc(fn, params) { calls.rpc.push({ fn, params }); return claim; },
  };
  return { db, calls };
}

const req = (secret) => ({ headers: { get: (h) => (h === 'x-webhook-secret' ? secret : null) } });

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

describe('processQueue — empty queue', () => {
  it('reports zero processed and writes a worker_runs row', async () => {
    const { db, calls } = makeDb({ pending: [] });
    const res = await processQueue(db, {}, { now: SENDABLE_NOW });
    expect(res.processed).toBe(0);
    expect(calls.insert.some((c) => c.table === 'worker_runs')).toBe(true);
  });
});
