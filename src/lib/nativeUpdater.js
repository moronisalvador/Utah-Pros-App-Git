/**
 * ════════════════════════════════════════════════
 * FILE: nativeUpdater.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps native over-the-air update operations behind an explicit, reviewed
 *   opt-in and refuses to accept a bundle until its caller proves the complete
 *   application health checkpoint passed.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @capgo/capacitor-updater
 *   Internal:  none
 *   Data:      reads native updater metadata only when OTA is explicitly enabled
 *
 * NOTES / GOTCHAS:
 *   - Production currently keeps CapacitorUpdater.autoUpdate=false and
 *     VITE_NATIVE_OTA_ENABLED=false. No boot path acknowledges a bundle.
 *   - A future OTA release lane must define and test the health checkpoint, then
 *     call markBundleReady({ healthVerified: true }) exactly once.
 * ════════════════════════════════════════════════
 */
//
// Capgo ships React/CSS/HTML updates to installed iOS apps without an App Store
// resubmit. The native plugin auto-checks on app resume and downloads matching
// channel bundles in the background. Next cold launch applies the new bundle.

import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

const isNative = () => Capacitor.isNativePlatform();

export function isNativeOtaEnabled(env = import.meta.env) {
  return env?.VITE_NATIVE_OTA_ENABLED === 'true';
}

export function isNativeUpdateHealthVerified({
  loading,
  error,
  sessionExpired,
  routeHealthy,
}) {
  return loading === false
    && error == null
    && sessionExpired === false
    && routeHealthy === true;
}

/**
 * Accept a pending OTA bundle only after a separately defined health checkpoint.
 * Merely importing modules or mounting React is intentionally insufficient.
 */
export async function markBundleReady({
  healthVerified = false,
  env = import.meta.env,
  updater = CapacitorUpdater,
} = {}) {
  if (!isNative()) return { ok: false, reason: 'not_native' };
  if (!isNativeOtaEnabled(env)) {
    return { ok: false, reason: 'ota_disabled' };
  }
  if (healthVerified !== true) {
    return { ok: false, reason: 'health_unverified' };
  }
  try {
    await updater.notifyAppReady();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'acknowledgement_failed',
      error: err,
    };
  }
}

// Optional future manual check. Disabled OTA never contacts the updater.
export async function checkForUpdate({
  env = import.meta.env,
  updater = CapacitorUpdater,
} = {}) {
  if (!isNative() || !isNativeOtaEnabled(env)) return null;
  try {
    const latest = await updater.getLatest();
    return latest;
  } catch {
    return null;
  }
}

// Read the current bundle info — useful for "version" display in an About screen.
export async function getCurrentBundleInfo({
  env = import.meta.env,
  updater = CapacitorUpdater,
} = {}) {
  if (!isNative() || !isNativeOtaEnabled(env)) return null;
  try {
    return await updater.current();
  } catch {
    return null;
  }
}
