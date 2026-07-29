/**
 * ════════════════════════════════════════════════
 * FILE: nativeLoginVerification.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that native biometric verification runs only at a supported manual
 *   sign-in and that web or unsupported devices never receive a native prompt.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  nativeLoginVerification.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - These tests inject every bridge dependency. They do not claim physical
 *     Face ID or iOS lifecycle coverage.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  NATIVE_LOGIN_CHECK_MESSAGE,
  NATIVE_LOGIN_VERIFICATION_MESSAGE,
  verifyNativeLogin,
} from './nativeLoginVerification.js';

describe('verifyNativeLogin', () => {
  it('does not inspect or prompt for biometrics in a browser build', async () => {
    const checkAvailable = vi.fn();
    const verify = vi.fn();

    await expect(verifyNativeLogin({
      native: false,
      checkAvailable,
      verify,
    })).resolves.toEqual({ state: 'skipped', reason: 'web' });

    expect(checkAvailable).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('allows password sign-in when native biometrics are unavailable', async () => {
    const verify = vi.fn();

    await expect(verifyNativeLogin({
      native: true,
      checkAvailable: vi.fn().mockResolvedValue(false),
      verify,
    })).resolves.toEqual({
      state: 'skipped',
      reason: 'biometric_unavailable',
    });

    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    ['probe rejection', vi.fn().mockRejectedValue(new Error('bridge failed'))],
    ['malformed probe result', vi.fn().mockResolvedValue('false')],
  ])('blocks sign-in after biometric %s', async (_label, checkAvailable) => {
    const verify = vi.fn();

    await expect(verifyNativeLogin({
      native: true,
      checkAvailable,
      verify,
    })).rejects.toThrow(NATIVE_LOGIN_CHECK_MESSAGE);

    expect(verify).not.toHaveBeenCalled();
  });

  it('accepts a supported native sign-in after biometric verification', async () => {
    const verify = vi.fn().mockResolvedValue(true);

    await expect(verifyNativeLogin({
      native: true,
      checkAvailable: vi.fn().mockResolvedValue(true),
      verify,
    })).resolves.toEqual({
      state: 'verified',
      reason: 'biometric_verified',
    });

    expect(verify).toHaveBeenCalledWith('Confirm Face ID to sign in to UPR');
  });

  it.each([
    ['cancel', vi.fn().mockResolvedValue(false)],
    ['bridge error', vi.fn().mockRejectedValue(new Error('bridge failed'))],
  ])('blocks sign-in after biometric %s', async (_label, verify) => {
    await expect(verifyNativeLogin({
      native: true,
      checkAvailable: vi.fn().mockResolvedValue(true),
      verify,
    })).rejects.toThrow(NATIVE_LOGIN_VERIFICATION_MESSAGE);
  });
});
