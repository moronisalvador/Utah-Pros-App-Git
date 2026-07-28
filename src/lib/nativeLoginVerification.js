/**
 * ════════════════════════════════════════════════
 * FILE: nativeLoginVerification.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Applies the native Face ID / Touch ID check at the manual sign-in boundary.
 *   A retained authenticated session is not challenged again on app reopen.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core
 *   Internal:  nativeBiometric.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Password sign-in remains available when the device has no enrolled
 *     biometry. A presented biometric challenge must succeed or sign-in stops.
 *   - Dependencies are injectable so cancellation, bridge failure, and web
 *     passthrough behavior can be verified without invoking a native prompt.
 * ════════════════════════════════════════════════
 */

import { Capacitor } from '@capacitor/core';
import {
  checkBiometricAvailable,
  verifyBiometric,
} from './nativeBiometric.js';

export const NATIVE_LOGIN_VERIFICATION_MESSAGE = (
  'Face ID verification was canceled. Try signing in again.'
);

export async function verifyNativeLogin({
  native = Capacitor.isNativePlatform(),
  checkAvailable = checkBiometricAvailable,
  verify = verifyBiometric,
} = {}) {
  if (!native) return { state: 'skipped', reason: 'web' };

  let available = false;
  try {
    available = await checkAvailable();
  } catch {
    available = false;
  }
  if (!available) {
    return { state: 'skipped', reason: 'biometric_unavailable' };
  }

  let verified = false;
  try {
    verified = await verify('Confirm Face ID to sign in to UPR');
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new Error(NATIVE_LOGIN_VERIFICATION_MESSAGE);
  }

  return { state: 'verified', reason: 'biometric_verified' };
}
