/**
 * ════════════════════════════════════════════════
 * FILE: NativeUpdateHealthGate.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves native update acceptance stays closed while account startup is
 *   incomplete, failed, or expired. Only a completed healthy startup passes.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  NativeUpdateHealthGate
 *   Data:      none
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/nativeUpdater', () => ({
  markBundleReady: vi.fn(),
}));

import { isNativeUpdateHealthVerified } from './NativeUpdateHealthGate.jsx';

describe('native update application health checkpoint', () => {
  it('accepts only an explicitly completed and healthy auth startup', () => {
    expect(isNativeUpdateHealthVerified({
      loading: false,
      error: null,
      sessionExpired: false,
    })).toBe(true);

    for (const state of [
      { loading: true, error: null, sessionExpired: false },
      { loading: false, error: new Error('boot failed'), sessionExpired: false },
      { loading: false, error: null, sessionExpired: true },
      { loading: undefined, error: null, sessionExpired: false },
    ]) {
      expect(isNativeUpdateHealthVerified(state)).toBe(false);
    }
  });
});
