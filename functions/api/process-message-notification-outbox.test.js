import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, process: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/message-notification-outbox.js', () => ({
  processMessageNotificationOutbox: (...args) => h.process(...args),
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: vi.fn(async () => undefined),
}));

import { onRequestPost } from './process-message-notification-outbox.js';

function db(secret = 'cron-secret') {
  return {
    select: vi.fn(async (table) => (
      table === 'integration_config' && secret ? [{ value: secret }] : []
    )),
  };
}

beforeEach(() => {
  h.db = db();
  h.process = vi.fn(async () => ({
    success: true,
    delivered: 1,
    retryable: 0,
    deadLettered: 0,
    claimed: 1,
  }));
});

describe('message notification outbox route', () => {
  it('rejects callers without the shared cron secret', async () => {
    const response = await onRequestPost({
      request: { headers: { get: () => null } },
      env: { MESSAGING_SCHEMA_MODE: 'foundation' },
    });
    expect(response.status).toBe(401);
    expect(h.process).not.toHaveBeenCalled();
  });

  it('runs only after the shared cron secret is verified', async () => {
    const response = await onRequestPost({
      request: {
        headers: {
          get: (name) => name === 'x-webhook-secret' ? 'cron-secret' : null,
        },
      },
      env: { MESSAGING_SCHEMA_MODE: 'foundation' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, delivered: 1 });
    expect(h.process).toHaveBeenCalledWith(
      h.db,
      expect.objectContaining({ MESSAGING_SCHEMA_MODE: 'foundation' }),
      expect.objectContaining({ dispatchImpl: expect.any(Function) }),
    );
  });
});
