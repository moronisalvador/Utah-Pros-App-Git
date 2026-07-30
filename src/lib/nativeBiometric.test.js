/**
 * ════════════════════════════════════════════════
 * FILE: nativeBiometric.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the native biometric availability bridge distinguishes confirmed
 *   missing/enrollment states from bridge failures and malformed responses.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  nativeBiometric.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Injected bridge functions keep these tests from presenting a real prompt.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from 'vitest';
import {
  biometricAuthenticateOptions,
  checkBiometricAvailable,
} from './nativeBiometric.js';

describe('checkBiometricAvailable', () => {
  it('does not call the bridge outside native', async () => {
    const check = vi.fn();

    await expect(checkBiometricAvailable({ native: false, check })).resolves.toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('accepts an explicit available response', async () => {
    await expect(checkBiometricAvailable({
      native: true,
      check: vi.fn().mockResolvedValue({ isAvailable: true, code: '' }),
    })).resolves.toBe(true);
  });

  it.each([
    'biometryNotAvailable',
    'biometryNotEnrolled',
  ])('accepts confirmed unavailable state %s', async (code) => {
    await expect(checkBiometricAvailable({
      native: true,
      check: vi.fn().mockResolvedValue({ isAvailable: false, code }),
    })).resolves.toBe(false);
  });

  it.each([
    ['bridge rejection', vi.fn().mockRejectedValue(new Error('bridge failed'))],
    ['malformed response', vi.fn().mockResolvedValue({ isAvailable: false })],
  ])('fails closed on %s', async (_label, check) => {
    await expect(checkBiometricAvailable({
      native: true,
      check,
    })).rejects.toThrow();
  });

  it('fails closed when the availability probe times out', async () => {
    await expect(checkBiometricAvailable({
      native: true,
      check: vi.fn(() => new Promise(() => {})),
      timeoutMs: 1,
    })).rejects.toThrow('timed out');
  });
});

describe('biometricAuthenticateOptions', () => {
  it('uses enrolled biometry only and never offers the device passcode', () => {
    expect(biometricAuthenticateOptions('Confirm login')).toEqual({
      reason: 'Confirm login',
      cancelTitle: 'Cancel',
      allowDeviceCredential: false,
    });
  });
});
