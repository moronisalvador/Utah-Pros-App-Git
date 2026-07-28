/**
 * ════════════════════════════════════════════════
 * FILE: nativeBiometric.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Wraps the native biometric bridge used at manual sign-in. It also clears
 *   the retired launch-gate preference during account/device cleanup.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @aparajita/capacitor-biometric-auth
 *   Internal:  nativeLoginVerification.js, accountDeviceCleanup.js
 *   Data:      reads/writes → localStorage key upr.biometric.enabled
 *
 * NOTES / GOTCHAS:
 *   - Biometry is not a stored-session launch gate. Normal app reopens trust
 *     the existing authenticated session and do not prompt again.
 *   - The legacy preference writer remains only so secure account cleanup can
 *     remove stale enrollment left by older installed builds.
 *   - The iOS app-switcher privacy shield is native AppDelegate code. This
 *     module makes no screenshot-prevention claim.
 * ════════════════════════════════════════════════
 */

import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';

const isNative = () => Capacitor.isNativePlatform();
const KEY = 'upr.biometric.enabled';

export async function checkBiometricAvailable() {
  if (!isNative()) return false;
  try {
    const info = await BiometricAuth.checkBiometry();
    return !!info?.isAvailable;
  } catch {
    return false;
  }
}

export function setBiometricEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(KEY, 'true');
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    // Storage may be disabled in some contexts. Callers that own an account
    // transition can now distinguish this from a completed preference clear.
    return false;
  }
}

// Ceiling on how long a hung native authenticate() call can block manual
// sign-in. A real Face ID/passcode prompt resolves in a few seconds.
const AUTH_TIMEOUT_MS = 20000;

// Shows the iOS Face ID / Touch ID / passcode prompt.
// Returns true on success, false on cancel, failure, or timeout.
export async function verifyBiometric(reason = 'Unlock UPR') {
  if (!isNative()) return true;
  try {
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('verifyBiometric timed out')), AUTH_TIMEOUT_MS);
    });
    await Promise.race([
      BiometricAuth.authenticate({
        reason,
        cancelTitle: 'Cancel',
        allowDeviceCredential: true, // fall back to device passcode if Face ID unavailable
        iosFallbackTitle: 'Use Passcode',
      }),
      timeout,
    ]);
    return true;
  } catch (err) {
    if (err?.message === 'verifyBiometric timed out') {
      console.warn('verifyBiometric: native call did not resolve within', AUTH_TIMEOUT_MS, 'ms — treating as failed');
    }
    return false;
  }
}
