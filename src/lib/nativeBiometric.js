// Biometric auth wrapper. No-op on web.
// V1 scope: biometric "gate" on top of the existing localStorage-based
// Supabase session. Token stays where it is today; Face ID just unlocks
// access to the UI on cold-launch. Future hardening: move the refresh
// token into iOS Keychain with a custom Supabase storage adapter.

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
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

export function setBiometricEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(KEY, 'true');
    else localStorage.removeItem(KEY);
  } catch { /* storage may be disabled in some contexts */ }
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

// Privacy screen (background blur / screenshot prevention) is deferred —
// @capacitor-community/privacy-screen isn't updated for Capacitor 8 yet.
// Keeping the export as a no-op so callers don't need a conditional.
export async function enablePrivacyScreen() { /* pending compatible plugin */ }
