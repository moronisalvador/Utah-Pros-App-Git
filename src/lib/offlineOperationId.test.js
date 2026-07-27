/**
 * ════════════════════════════════════════════════
 * FILE: offlineOperationId.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves offline operation IDs remain RFC 4122 v4 UUIDs without randomUUID
 *   and fail visibly when the browser has no secure randomness.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  offlineOperationId
 *   Data:      none
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createOfflineOperationId,
  isOfflineOperationId,
} from './offlineOperationId.js';

describe('offline operation identity', () => {
  it('uses a valid native randomUUID', () => {
    const id = createOfflineOperationId({
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
    });
    expect(id).toBe('11111111-2222-4333-8444-555555555555');
    expect(isOfflineOperationId(id)).toBe(true);
  });

  it('creates an RFC 4122 v4 UUID when randomUUID is absent', () => {
    const getRandomValues = vi.fn((bytes) => {
      bytes.set([
        0, 1, 2, 3, 4, 5, 6, 7,
        8, 9, 10, 11, 12, 13, 14, 15,
      ]);
      return bytes;
    });
    const id = createOfflineOperationId({ getRandomValues });

    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(isOfflineOperationId(id)).toBe(true);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('falls back when randomUUID returns a malformed value', () => {
    const id = createOfflineOperationId({
      randomUUID: () => `${Date.now()}-${Math.random()}`,
      getRandomValues: (bytes) => {
        bytes.fill(7);
        return bytes;
      },
    });
    expect(isOfflineOperationId(id)).toBe(true);
  });

  it('fails before persistence when secure randomness is unavailable', () => {
    expect(() => createOfflineOperationId({}))
      .toThrow(/secure offline operation identity is unavailable/i);
  });
});
