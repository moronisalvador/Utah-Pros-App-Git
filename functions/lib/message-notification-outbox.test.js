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
      nativeRetryOnly: false,
      body: {
        ...BASE_ROW.payload,
        notification_event_id: 'outbox-1',
        message_id: undefined,
      },
    });
    expect(store.update).toHaveBeenCalledWith(
      'message_notification_outbox',
      'id=eq.outbox-1&delivery_state=eq.processing&claim_token=eq.claim-1',
      expect.objectContaining({ delivery_state: 'delivered', claim_token: null }),
    );
    expect(result).toMatchObject({ success: true, delivered: 1, claimed: 1 });
  });

  it('uses the durable outbox id when the live claim RPC omits provider and message ids', async () => {
    const store = db();
    const dispatch = vi.fn(async () => ({
      recipients: 1,
      results: [{
        recipient_id: 'employee-private',
        push: {
          native: {
            sent: 0,
            attempted: 0,
            pruned: 0,
            skipped: true,
            reason: 'no_tokens',
          },
        },
      }],
    }));

    const result = await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: dispatch,
    });

    expect(dispatch.mock.calls[0][0].body.notification_event_id).toBe('outbox-1');
    expect(result.native).toEqual({
      recipients: 1,
      sent: 0,
      attempted: 0,
      pruned: 0,
      retryable: 0,
      ambiguous: 0,
      skipped: 1,
      skip_reasons: { no_tokens: 1 },
    });
    expect(JSON.stringify(result.native)).not.toContain('employee-private');
  });

  it('redacts unknown native skip details from operational telemetry', async () => {
    const store = db();
    const result = await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: vi.fn(async () => ({
        recipients: 1,
        results: [{
          push: {
            native: {
              sent: 0,
              attempted: 0,
              skipped: true,
              reason: 'upstream-private-detail',
            },
          },
        }],
      })),
    });

    expect(result.native.skip_reasons).toEqual({ other: 1 });
    expect(JSON.stringify(result.native)).not.toContain('upstream-private-detail');
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

  it('persists a native-only retry after explicit APNs refusal', async () => {
    const store = db();
    const result = await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: vi.fn(async () => ({
        recipients: 1,
        results: [{
          push: {
            native: { sent: 0, attempted: 1, retryable: true },
          },
        }],
      })),
    });

    expect(store.update).toHaveBeenCalledWith(
      'message_notification_outbox',
      expect.any(String),
      expect.objectContaining({
        delivery_state: 'retryable',
        payload: expect.objectContaining({ _native_retry_only: true }),
      }),
    );
    expect(result).toMatchObject({
      success: false,
      retryable: 1,
      native: {
        recipients: 1,
        sent: 0,
        attempted: 1,
        retryable: 1,
      },
    });
  });

  it('replays a persisted native retry without re-requesting other channels', async () => {
    const store = db([{
      ...BASE_ROW,
      payload: { ...BASE_ROW.payload, _native_retry_only: true },
    }]);
    const dispatch = vi.fn(async () => ({ recipients: 1, results: [] }));

    await processMessageNotificationOutbox(store, ENV, {
      now: NOW,
      claimToken: 'claim-1',
      dispatchImpl: dispatch,
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ nativeRetryOnly: true }),
    );
    expect(dispatch.mock.calls[0][0].body).not.toHaveProperty(
      '_native_retry_only',
    );
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
