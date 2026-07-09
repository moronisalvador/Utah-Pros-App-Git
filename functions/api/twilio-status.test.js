/**
 * ════════════════════════════════════════════════
 * FILE: twilio-status.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the pure decision logic behind the Twilio delivery-status webhook
 *   (Phase A hardening): which incoming statuses we are even allowed to store,
 *   the "never move a message backwards" (out-of-order) guard so a late "sent"
 *   can't overwrite a "delivered", the parsing of the segment count and price
 *   Twilio bills us, and the exact update object we build for a given callback.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./twilio-status.js (pure helpers), ./twilio-errors.js
 *
 * NOTES / GOTCHAS:
 *   - Only the pure helpers are unit-tested; the handler's signature check + DB
 *     writes are integration territory. The helpers are exported precisely so the
 *     whitelist / monotonic / metering decisions are testable without Twilio/Supabase.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  WRITABLE_STATUSES,
  shouldApplyStatus,
  parseSegments,
  parsePrice,
  buildStatusUpdate,
  applyErrorSuppression,
} from './twilio-status.js';
import { classifyTwilioError } from '../lib/twilio-errors.js';

// In-memory fake db for the suppression side-effect. `contacts` is the set of
// recipient rows returned for the participant lookup.
function makeDb({ participants = [{ contact_id: 'c1' }], contacts = [] } = {}) {
  const calls = { update: [], insert: [] };
  const db = {
    async select(table) {
      if (table === 'conversation_participants') return participants;
      if (table === 'contacts') return contacts;
      return [];
    },
    async update(table, filter, data) { calls.update.push({ table, filter, data }); return null; },
    async insert(table, data) { calls.insert.push({ table, data }); return Array.isArray(data) ? data : [data]; },
  };
  return { db, calls };
}

describe('WRITABLE_STATUSES (matches the messages.status CHECK)', () => {
  it('contains exactly the DB-allowed statuses and excludes transitional ones', () => {
    for (const s of ['queued', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'received']) {
      expect(WRITABLE_STATUSES.has(s)).toBe(true);
    }
    // Twilio sends these too, but the messages CHECK rejects them — never write them.
    for (const s of ['sending', 'accepted', 'delivering', 'receiving']) {
      expect(WRITABLE_STATUSES.has(s)).toBe(false);
    }
  });
});

describe('shouldApplyStatus (whitelist + monotonic out-of-order guard)', () => {
  it('applies a forward progression', () => {
    expect(shouldApplyStatus('queued', 'sent')).toBe(true);
    expect(shouldApplyStatus('sent', 'delivered')).toBe(true);
    expect(shouldApplyStatus('delivered', 'read')).toBe(true);
    expect(shouldApplyStatus(null, 'sent')).toBe(true);
    expect(shouldApplyStatus(undefined, 'delivered')).toBe(true);
  });

  it('rejects a late/out-of-order status (the core F-8 bug: sent after delivered)', () => {
    expect(shouldApplyStatus('delivered', 'sent')).toBe(false);
    expect(shouldApplyStatus('delivered', 'queued')).toBe(false);
    expect(shouldApplyStatus('read', 'delivered')).toBe(false);
    // A late failure must not un-deliver a confirmed delivery.
    expect(shouldApplyStatus('delivered', 'failed')).toBe(false);
    expect(shouldApplyStatus('read', 'undelivered')).toBe(false);
  });

  it('rejects a duplicate (equal-rank) status as a no-op', () => {
    expect(shouldApplyStatus('sent', 'sent')).toBe(false);
    expect(shouldApplyStatus('delivered', 'delivered')).toBe(false);
  });

  it('never applies a status the messages CHECK forbids', () => {
    expect(shouldApplyStatus('queued', 'sending')).toBe(false);
    expect(shouldApplyStatus('queued', 'accepted')).toBe(false);
    expect(shouldApplyStatus(null, 'delivering')).toBe(false);
    expect(shouldApplyStatus('queued', '')).toBe(false);
    expect(shouldApplyStatus('queued', null)).toBe(false);
  });

  it('records a real failure over an in-flight status', () => {
    expect(shouldApplyStatus('sent', 'failed')).toBe(true);
    expect(shouldApplyStatus('queued', 'undelivered')).toBe(true);
  });
});

describe('parseSegments / parsePrice (Twilio metering capture)', () => {
  it('parses a segment count', () => {
    expect(parseSegments('1')).toBe(1);
    expect(parseSegments('3')).toBe(3);
    expect(parseSegments(2)).toBe(2);
  });
  it('returns null for a missing/blank/non-numeric segment count', () => {
    for (const v of [null, undefined, '', 'x', NaN]) expect(parseSegments(v)).toBe(null);
  });
  it('parses Twilio price (a negative string) as a number', () => {
    expect(parsePrice('-0.00750')).toBeCloseTo(-0.0075, 6);
    expect(parsePrice('0')).toBe(0);
  });
  it('returns null for a missing/blank/non-numeric price', () => {
    for (const v of [null, undefined, '', 'abc']) expect(parsePrice(v)).toBe(null);
  });
});

describe('buildStatusUpdate (the exact patch we write)', () => {
  const nowIso = '2026-07-09T12:00:00.000Z';

  it('applies a forward status + captures metering', () => {
    const u = buildStatusUpdate({
      current: { status: 'sent' }, messageStatus: 'delivered',
      numSegments: '2', price: '-0.0150', nowIso,
    });
    expect(u.status).toBe('delivered');
    expect(u.num_segments).toBe(2);
    expect(u.price).toBeCloseTo(-0.015, 6);
    expect(u.read_at).toBeUndefined();
  });

  it('skips the status write on an out-of-order callback but STILL captures metering', () => {
    const u = buildStatusUpdate({
      current: { status: 'delivered' }, messageStatus: 'sent',
      numSegments: '1', price: '-0.0075', nowIso,
    });
    expect(u.status).toBeUndefined();          // guard held — no backwards move
    expect(u.num_segments).toBe(1);            // metering is order-agnostic factual data
    expect(u.price).toBeCloseTo(-0.0075, 6);
  });

  it('does NOT attach error fields to a message it is not transitioning', () => {
    // A stray failed callback arriving after delivered: keep delivered, drop the error.
    const u = buildStatusUpdate({
      current: { status: 'delivered' }, messageStatus: 'failed',
      errorCode: '30007', errorMessage: 'Carrier filtered', nowIso,
    });
    expect(u.status).toBeUndefined();
    expect(u.error_code).toBeUndefined();
    expect(u.error_message).toBeUndefined();
  });

  it('captures error_code/error_message on an applied failure', () => {
    const u = buildStatusUpdate({
      current: { status: 'sent' }, messageStatus: 'undelivered',
      errorCode: '21610', errorMessage: 'STOP', nowIso,
    });
    expect(u.status).toBe('undelivered');
    expect(u.error_code).toBe('21610');
    expect(u.error_message).toBe('STOP');
  });

  it('stamps read_at on read and clicked_at on an RCS button tap', () => {
    const u = buildStatusUpdate({ current: { status: 'delivered' }, messageStatus: 'read', nowIso });
    expect(u.status).toBe('read');
    expect(u.read_at).toBe(nowIso);
    const c = buildStatusUpdate({ current: { status: 'delivered' }, messageStatus: 'read', buttonText: 'Yes', nowIso });
    expect(c.clicked_at).toBe(nowIso);
  });

  it('returns an empty patch for a transitional status with no metering', () => {
    const u = buildStatusUpdate({ current: { status: 'queued' }, messageStatus: 'sending', nowIso });
    expect(Object.keys(u)).toHaveLength(0);
  });
});

describe('classifyTwilioError drives suppression (F-core contract used by the handler)', () => {
  it('21610/30006 suppress + flag; 30007/30034 do not', () => {
    expect(classifyTwilioError('21610').suppress).toBe(true);
    expect(classifyTwilioError('21610').contactFlag).toBe('opt_out');
    expect(classifyTwilioError('30006').suppress).toBe(true);
    expect(classifyTwilioError('30006').contactFlag).toBe('invalid_number');
    expect(classifyTwilioError('30007').suppress).toBe(false);
    expect(classifyTwilioError('30034').suppress).toBe(false);
  });
});

describe('applyErrorSuppression (contact suppression + idempotency)', () => {
  const message = { id: 'm1', conversation_id: 'conv1' };

  it('21610 opt-out clears opt-in AND sets dnd, and logs consent', async () => {
    const { db, calls } = makeDb({ contacts: [{ id: 'c1', phone: '+15551112222', dnd: false, opt_in_status: true }] });
    await applyErrorSuppression(db, { message, errorCode: '21610' });
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].table).toBe('contacts');
    expect(calls.update[0].data.opt_in_status).toBe(false);
    expect(calls.update[0].data.dnd).toBe(true);
    expect(calls.insert[0].table).toBe('sms_consent_log');
    expect(calls.insert[0].data[0].event_type).toBe('stop_delivery_error');
  });

  it('30006 unreachable sets dnd only (leaves opt_in_status untouched)', async () => {
    const { db, calls } = makeDb({ contacts: [{ id: 'c1', phone: '+15551112222', dnd: false, opt_in_status: true }] });
    await applyErrorSuppression(db, { message, errorCode: '30006' });
    expect(calls.update[0].data.dnd).toBe(true);
    expect(calls.update[0].data).not.toHaveProperty('opt_in_status');
    expect(calls.insert[0].data[0].event_type).toBe('invalid_number');
  });

  it('is idempotent — a retry on an already-suppressed contact writes nothing', async () => {
    // Simulates the retry-after-transient-500 case: status is already terminal,
    // contact already flagged. Must NOT double-write or double-log.
    const { db, calls } = makeDb({ contacts: [{ id: 'c1', phone: '+1', dnd: true, opt_in_status: false }] });
    await applyErrorSuppression(db, { message, errorCode: '21610' });
    expect(calls.update).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });

  it('does nothing for a non-suppressing code (30007 carrier filter)', async () => {
    const { db, calls } = makeDb({ contacts: [{ id: 'c1', dnd: false, opt_in_status: true }] });
    await applyErrorSuppression(db, { message, errorCode: '30007' });
    expect(calls.update).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });
});
