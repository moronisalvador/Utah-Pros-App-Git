/**
 * ════════════════════════════════════════════════
 * FILE: nativeBiometricGate.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether a native cold launch may reveal the app. An enrolled
 *   biometric policy fails closed: unavailable biometrics, verification errors,
 *   and cleanup/sign-out failures never expose the stored authenticated session.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  App.jsx supplies the native/auth/device cleanup operations
 *   Data:      none directly
 *
 * NOTES / GOTCHAS:
 *   - This module is dependency-injected so every failure branch is unit tested
 *     without invoking Face ID, Supabase, Push, or a physical device.
 *   - Cleanup runs before local sign-out while the old session can still remove
 *     server-owned Push registrations. A requested reset is returned only after
 *     sign-out succeeds.
 * ════════════════════════════════════════════════
 */

function normalizePreference(preference) {
  if (
    preference
    && typeof preference === 'object'
    && 'enabled' in preference
  ) {
    return {
      enabled: preference.enabled === true,
      readable: preference.readable !== false,
    };
  }
  return { enabled: preference === true, readable: true };
}

async function revokeEnrolledSession({
  session,
  reason,
  cleanup,
  signOut,
}) {
  let cleanupResult = null;
  let cleanupError = null;
  try {
    cleanupResult = await cleanup(session);
  } catch (error) {
    cleanupError = error;
  }

  try {
    const result = await signOut({ scope: 'local' });
    if (result?.error) throw result.error;
  } catch (error) {
    return {
      state: 'locked',
      reason: 'sign_out_failed',
      cause: error,
      verificationReason: reason,
      cleanupError,
    };
  }

  return {
    state: 'open',
    reason: 'signed_out',
    signedOut: true,
    verificationReason: reason,
    cleanupError,
    reloadRequired: cleanupResult?.reloadRequired === true,
  };
}

/**
 * Resolve one native launch.
 *
 * `state: "open"` means render the child tree. When `signedOut` is true, that
 * tree must resolve to Login rather than an authenticated route.
 * `state: "locked"` means render only the retry surface.
 */
export async function evaluateNativeBiometricLaunch({
  native,
  getSession,
  readPreference,
  checkAvailable,
  verify,
  cleanup,
  signOut,
  isCurrent = () => true,
}) {
  if (!native) return { state: 'open', reason: 'web' };
  if (!isCurrent()) return { state: 'locked', reason: 'cancelled' };

  let session;
  try {
    const result = await getSession();
    session = result?.data?.session || null;
  } catch (error) {
    return {
      state: 'locked',
      reason: 'session_check_failed',
      cause: error,
    };
  }
  if (!isCurrent()) return { state: 'locked', reason: 'cancelled' };

  if (!session) return { state: 'open', reason: 'no_session' };

  let preference;
  try {
    preference = normalizePreference(readPreference());
  } catch (error) {
    return {
      state: 'locked',
      reason: 'policy_unreadable',
      cause: error,
    };
  }
  if (!preference.readable) {
    return { state: 'locked', reason: 'policy_unreadable' };
  }
  if (!preference.enabled) {
    return { state: 'open', reason: 'not_enrolled' };
  }
  if (!isCurrent()) return { state: 'locked', reason: 'cancelled' };

  let available = false;
  try {
    available = await checkAvailable();
  } catch {
    available = false;
  }
  if (!isCurrent()) return { state: 'locked', reason: 'cancelled' };
  if (!available) {
    return revokeEnrolledSession({
      session,
      reason: 'biometric_unavailable',
      cleanup,
      signOut,
    });
  }

  let verified = false;
  try {
    verified = await verify();
  } catch {
    verified = false;
  }
  if (!isCurrent()) return { state: 'locked', reason: 'cancelled' };
  if (!verified) {
    return revokeEnrolledSession({
      session,
      reason: 'verification_failed',
      cleanup,
      signOut,
    });
  }

  return { state: 'open', reason: 'verified' };
}
