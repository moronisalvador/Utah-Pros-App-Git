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

  it('an absent partIndex leaves the request fingerprint byte-identical', async () => {
    // JSON.stringify drops an undefined key, so every fingerprint minted
    // before the multi-photo split must stay unchanged — a drifted
    // fingerprint would turn every in-flight replay into a
    // CLIENT_REQUEST_CONFLICT.
    const plain = await claimMessageAttempt(dbWith(), COMMAND);
    const explicitUndefined = await claimMessageAttempt(
      dbWith(),
      { ...COMMAND, partIndex: undefined },
    );
    expect(explicitUndefined.attempt.request_fingerprint)
      .toBe(plain.attempt.request_fingerprint);
    const part = await claimMessageAttempt(dbWith(), { ...COMMAND, partIndex: 1 });
    expect(part.attempt.request_fingerprint)
      .not.toBe(plain.attempt.request_fingerprint);
  });

  it('claims split parts by content fingerprint so one recipient can hold several children', async () => {
    const db = dbWith();
    const partCommand = (partIndex) => ({
      ...COMMAND,
      clientRequestId: null,
      recipientContactId: null,
      partIndex,
      body: `Rep T. (${partIndex}/2)`,
      mediaUrls: [`upr-storage://message-attachments/outbound/conv/photo-${partIndex}.jpg`],
      provider: 'callrail',
      requestedChannel: 'mms',
    });
    const first = await claimChildMessageAttempt(db, 'parent-1', partCommand(1));
    const second = await claimChildMessageAttempt(db, 'parent-1', partCommand(2));
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(true);
    // The partial unique index on (parent_attempt_id, recipient_contact_id)
    // admits one child per contact — split children must carry NULL there.
    expect(first.attempt.recipient_contact_id).toBeNull();
    expect(second.attempt.recipient_contact_id).toBeNull();
    expect(first.attempt.request_fingerprint)
      .not.toBe(second.attempt.request_fingerprint);
    // The existence probe filters on the part's own fingerprint, not the
    // per-recipient identity that would collide across parts.
    for (const call of db.select.mock.calls) {
      expect(call[1]).toContain('request_fingerprint=eq.');
      expect(call[1]).not.toContain('recipient_contact_id=eq.');
    }
  });

  it('replays an identical split part instead of inserting a duplicate', async () => {
    const partCommand = {
      ...COMMAND,
      clientRequestId: null,
      recipientContactId: null,
      partIndex: 2,
      body: 'Rep T. (2/3)',
      mediaUrls: ['upr-storage://message-attachments/outbound/conv/photo-2.jpg'],
      provider: 'callrail',
      requestedChannel: 'mms',
    };
    const first = await claimChildMessageAttempt(dbWith(), 'parent-1', partCommand);
    const db = dbWith(first.attempt);
    const repeat = await claimChildMessageAttempt(db, 'parent-1', partCommand);
    expect(repeat).toEqual({ claimed: false, attempt: first.attempt });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
