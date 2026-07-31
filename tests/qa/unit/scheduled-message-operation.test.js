/**
 * ════════════════════════════════════════════════
 * FILE: scheduled-message-operation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that retrying an identical scheduled text after a lost response
 *   reuses its database id, while an edited request gets a fresh id.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: src/lib/scheduledMessageOperation.js
 *   Data:     none
 *
 * NOTES / GOTCHAS:
 *   - This models a commit-response-loss retry; the database RPC separately
 *     proves that reusing the id is payload-checked and idempotent.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  clearScheduledMessageOperation,
  getScheduledMessageOperation,
} from '../../../src/lib/scheduledMessageOperation.js';
import {
  PWA_ACCOUNT_EPOCH_KEY,
  PWA_ACCOUNT_OWNER_KEY,
} from '../../../src/lib/resumeRestore.js';

const REQUEST = {
  conversationId: 'conversation-1',
  body: 'Drying update',
  sendAt: '2026-08-01T18:00:00.000Z',
};

describe('scheduled-message browser operation id', () => {
  it('reuses one id after an ambiguous commit response and clears it only on success', () => {
    const operations = new Map();
    const createId = vi.fn()
      .mockReturnValueOnce('schedule-id-1')
      .mockReturnValueOnce('schedule-id-2');

    const firstAttempt = getScheduledMessageOperation(
      operations,
      REQUEST,
      { createId },
    );
    const retryAfterLostResponse = getScheduledMessageOperation(
      operations,
      REQUEST,
      { createId },
    );

    expect(retryAfterLostResponse).toEqual(firstAttempt);
    expect(createId).toHaveBeenCalledTimes(1);

    clearScheduledMessageOperation(operations, firstAttempt);
    expect(getScheduledMessageOperation(operations, REQUEST, { createId }).id)
      .toBe('schedule-id-2');
  });

  it('reuses the owner-scoped id after a Capacitor WebView restart', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    const ownerLease = {
      owner: 'v1.abcdefghijkl',
      epoch: 'e1.abcde',
    };
    storage.setItem(PWA_ACCOUNT_OWNER_KEY, ownerLease.owner);
    storage.setItem(PWA_ACCOUNT_EPOCH_KEY, ownerLease.epoch);
    const createId = vi.fn().mockReturnValue('durable-schedule-id');

    const firstAttempt = getScheduledMessageOperation(
      new Map(),
      REQUEST,
      { createId, ownerLease, storage },
    );
    const retryAfterRestart = getScheduledMessageOperation(
      new Map(),
      REQUEST,
      { createId, ownerLease, storage },
    );

    expect(retryAfterRestart.id).toBe(firstAttempt.id);
    expect(createId).toHaveBeenCalledTimes(1);

    clearScheduledMessageOperation(
      new Map([[firstAttempt.key, firstAttempt.id]]),
      firstAttempt,
      { storage },
    );
    expect(storage.getItem(firstAttempt.storageKey)).toBeNull();
  });

  it.each([
    ['conversation', { conversationId: 'conversation-2' }],
    ['body', { body: 'Drying update changed' }],
    ['send time', { sendAt: '2026-08-01T19:00:00.000Z' }],
  ])('uses a new id when the %s changes', (_field, change) => {
    const operations = new Map();
    let sequence = 0;
    const createId = () => `schedule-id-${++sequence}`;

    const original = getScheduledMessageOperation(
      operations,
      REQUEST,
      { createId },
    );
    const changed = getScheduledMessageOperation(
      operations,
      { ...REQUEST, ...change },
      { createId },
    );

    expect(changed.id).not.toBe(original.id);
  });
});
