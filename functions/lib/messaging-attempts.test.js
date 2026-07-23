/**
 * ════════════════════════════════════════════════
 * FILE: messaging-attempts.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves stable request IDs claim once, concurrent duplicates reuse the winner,
 *   and changed-content reuse fails closed.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./messaging-attempts.js
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  claimChildMessageAttempt,
  claimMessageAttempt,
  completeMessageAttempt,
  findMessageAttempt,
} from './messaging-attempts.js';

const COMMAND = {
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  conversationId: 'conversation-1',
  actorEmployeeId: 'employee-1',
  recipientAddress: '+15551112222',
  body: 'Rep: hello',
  mediaUrls: [],
  provider: 'twilio',
  requestedChannel: 'sms',
};

function dbWith(existing = null) {
  return {
    select: vi.fn(async () => (existing ? [existing] : [])),
    insert: vi.fn(async (_table, payload) => [{ id: 'attempt-1', ...payload }]),
    update: vi.fn(async () => []),
  };
}

describe('messaging attempts', () => {
  it('does not touch persistence in legacy schema without a request id', async () => {
    const db = dbWith();
    await expect(claimMessageAttempt(db, { ...COMMAND, clientRequestId: null })).resolves.toEqual({
      claimed: true,
      attempt: null,
    });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('records provider-side-effect attempts in foundation mode without a request id', async () => {
    const db = dbWith();
    const result = await claimMessageAttempt(db, {
      ...COMMAND,
      clientRequestId: null,
      foundationSchema: true,
      canonicalBody: 'hello',
      recipientContactId: 'contact-1',
    });
    expect(result.claimed).toBe(true);
    expect(result.attempt).toMatchObject({
      client_request_id: null,
      canonical_body: 'hello',
      recipient_contact_id: 'contact-1',
      state: 'submitting',
    });
  });

  it('claims a new stable request exactly once', async () => {
    const db = dbWith();
    const result = await claimMessageAttempt(db, COMMAND);
    expect(result.claimed).toBe(true);
    expect(result.attempt).toMatchObject({
      id: 'attempt-1',
      client_request_id: COMMAND.clientRequestId,
      requested_channel: 'sms',
      submitted_body: COMMAND.body,
      state: 'submitting',
    });
    expect(result.attempt.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an existing identical request without inserting', async () => {
    const firstDb = dbWith();
    const first = await claimMessageAttempt(firstDb, COMMAND);
    const existingDb = dbWith(first.attempt);

    const repeat = await claimMessageAttempt(existingDb, COMMAND);
    expect(repeat).toEqual({ claimed: false, attempt: first.attempt });
    expect(existingDb.insert).not.toHaveBeenCalled();
  });

  it('finds a completed replay before mutable consent is re-evaluated', async () => {
    const first = await claimMessageAttempt(dbWith(), COMMAND);
    await expect(findMessageAttempt(dbWith(first.attempt), COMMAND))
      .resolves.toEqual(first.attempt);
  });

  it('rejects request-id reuse with changed content', async () => {
    const first = await claimMessageAttempt(dbWith(), COMMAND);
    const db = dbWith(first.attempt);
    await expect(
      claimMessageAttempt(db, { ...COMMAND, body: 'Rep: changed' }),
    ).rejects.toMatchObject({ code: 'CLIENT_REQUEST_CONFLICT' });
  });

  it('rejects request-id reuse after the configured provider changes', async () => {
    const first = await claimMessageAttempt(dbWith(), COMMAND);
    const db = dbWith(first.attempt);
    await expect(
      claimMessageAttempt(db, { ...COMMAND, provider: 'callrail' }),
    ).rejects.toMatchObject({ code: 'CLIENT_REQUEST_CONFLICT' });
  });

  it('recovers the winner after a concurrent unique-conflict insert', async () => {
    const seed = await claimMessageAttempt(dbWith(), COMMAND);
    const db = dbWith();
    db.insert.mockRejectedValueOnce(new Error('duplicate key'));
    db.select
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([seed.attempt]);

    await expect(claimMessageAttempt(db, COMMAND)).resolves.toEqual({
      claimed: false,
      attempt: seed.attempt,
    });
  });

  it('updates completion state with an updated timestamp', async () => {
    const db = dbWith();
    await completeMessageAttempt(db, 'attempt-1', {
      state: 'accepted',
      message_id: 'message-1',
    });
    expect(db.update).toHaveBeenCalledWith(
      'message_send_attempts',
      'id=eq.attempt-1',
      expect.objectContaining({
        state: 'accepted',
        message_id: 'message-1',
        updated_at: expect.any(String),
      }),
    );
  });

  it('claims one durable child per parent and recipient', async () => {
    const db = dbWith();
    const result = await claimChildMessageAttempt(db, 'parent-1', {
      ...COMMAND,
      clientRequestId: null,
      recipientContactId: 'contact-1',
      canonicalBody: 'hello',
    });
    expect(result.attempt).toMatchObject({
      parent_attempt_id: 'parent-1',
      recipient_contact_id: 'contact-1',
      canonical_body: 'hello',
    });
  });
});
