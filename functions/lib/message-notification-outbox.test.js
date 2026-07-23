import { describe, expect, it, vi } from 'vitest';

import {
  MESSAGE_NOTIFICATION_OUTBOX_LIMITS,
  processMessageNotificationOutbox,
} from './message-notification-outbox.js';

const NOW = new Date('2026-07-23T20:00:00.000Z');
const BASE_ROW = {
  id: 'outbox-1',
  type_key: 'message.inbound',
  payload: {
    title: 'New text from Jane',
    body: 'Hello',
    link: '/conversations',
  },
  delivery_state: 'processing',
  delivery_attempts: 1,
  claim_token: 'claim-1',
};
const ENV = { MESSAGING_SCHEMA_MODE: 'foundation' };

function db(rows = [BASE_ROW]) {
  return {
    rpc: vi.fn(async () => rows),
    update: vi.fn(async () => [{ id: 'outbox-1' }]),
  };
}

describe('message notification outbox', () => {
  it('atomically claims due rows including a stale-lease cutoff and marks delivery', async () => {
    const store = db();
    const dispatch = vi.fn(async () => ({ recipients: 1, results: [] }));
    const result = await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: dispatch,
    });

    expect(store.rpc).toHaveBeenCalledWith('claim_message_notification_outbox', {
      p_limit: 20,
      p_now: NOW.toISOString(),
      p_stale_before: new Date(
        NOW.getTime() - MESSAGE_NOTIFICATION_OUTBOX_LIMITS.leaseMs,
      ).toISOString(),
      p_claim_token: 'claim-1',
    });
    expect(dispatch).toHaveBeenCalledWith({
      db: store,
      env: ENV,
      typeKey: 'message.inbound',
      body: BASE_ROW.payload,
    });
    expect(store.update).toHaveBeenCalledWith(
      'message_notification_outbox',
      'id=eq.outbox-1&delivery_state=eq.processing&claim_token=eq.claim-1',
      expect.objectContaining({ delivery_state: 'delivered', claim_token: null }),
    );
    expect(result).toMatchObject({ success: true, delivered: 1, claimed: 1 });
  });

  it('retries a transient dispatch failure with bounded backoff', async () => {
    const store = db();
    const result = await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: vi.fn(async () => {
        throw new Error('temporary');
      }),
    });

    expect(store.update).toHaveBeenCalledWith(
      'message_notification_outbox',
      expect.any(String),
      expect.objectContaining({
        delivery_state: 'retryable',
        next_attempt_at: '2026-07-23T20:01:00.000Z',
        last_error: 'temporary',
      }),
    );
    expect(result).toMatchObject({ success: false, retryable: 1 });
  });

  it('dead-letters the fifth failed dispatch', async () => {
    const store = db([{ ...BASE_ROW, delivery_attempts: 5 }]);
    const result = await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: vi.fn(async () => {
        throw new Error('still failing');
      }),
    });

    expect(store.update).toHaveBeenCalledWith(
      'message_notification_outbox',
      expect.any(String),
      expect.objectContaining({
        delivery_state: 'dead_letter',
        next_attempt_at: null,
        failed_at: NOW.toISOString(),
      }),
    );
    expect(result).toMatchObject({ success: false, deadLettered: 1 });
  });

  it('dead-letters an invalid payload without calling the dispatcher', async () => {
    const store = db([{ ...BASE_ROW, payload: 'not json' }]);
    const dispatch = vi.fn();
    await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: dispatch,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.update).toHaveBeenCalledWith(
      'message_notification_outbox',
      expect.any(String),
      expect.objectContaining({ delivery_state: 'dead_letter' }),
    );
  });

  it('does not touch the database before foundation schema mode is enabled', async () => {
    const store = db();
    const result = await processMessageNotificationOutbox(store, {
      MESSAGING_SCHEMA_MODE: 'legacy',
    }, {
      dispatchImpl: vi.fn(),
    });
    expect(result.error).toBe('MESSAGING_SCHEMA_NOT_READY');
    expect(store.rpc).not.toHaveBeenCalled();
  });
});
