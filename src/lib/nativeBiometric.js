/**
 * ════════════════════════════════════════════════
 * FILE: nativeBiometric.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Wraps the native biometric bridge and stores whether this installation
 *   opted into launch-time Face ID, Touch ID, or device-passcode verification.
 *   Browser builds remain passive.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @aparajita/capacitor-biometric-auth
 *   Internal:  nativeBiometricGate.js consumes the tri-state preference
 *   Data:      reads/writes → localStorage key upr.biometric.enabled
 *
 * NOTES / GOTCHAS:
 *   - This gate sits on top of the existing Supabase session; it does not move
 *     refresh tokens into Keychain.
 *   - An unreadable preference is distinct from "disabled" so an enrolled
 *     native session can fail closed instead of exposing the app.
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

export function isBiometricEnabled() {
  return readBiometricPreference().enabled;
}

/**
 * Read enrollment without collapsing blocked/corrupt storage into "disabled".
 * An unreadable policy must fail closed when a stored native session exists.
 */
export function readBiometricPreference(storage) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return {
      enabled: target?.getItem(KEY) === 'true',
      readable: !!target,
    };
  } catch {
    return { enabled: false, readable: false };
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

// Ceiling on how long a hung native authenticate() call can block the app's
// BiometricGate. A real Face ID/passcode prompt resolves in a few seconds;
// this is generous enough to never fire during normal use, and short enough
// that a stuck native bridge falls through to sign-out → login instead of
// freezing the launch screen forever (the failure mode this guards against).
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
