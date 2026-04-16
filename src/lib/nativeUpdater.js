// Capgo OTA updater wrapper. No-op on web.
//
// Capgo ships React/CSS/HTML updates to installed iOS apps without an App Store
// resubmit. The native plugin auto-checks on app resume and downloads matching
// channel bundles in the background. Next cold launch applies the new bundle.
//
// CRITICAL: notifyAppReady() must be called shortly after the app boots.
// If we don't call it, Capgo assumes the update crashed and rolls back to the
// previous bundle on next launch. That's the safety net against shipping a
// broken bundle — we just have to honour it.

import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

const isNative = () => Capacitor.isNativePlatform();

// Call this once after the React tree has mounted successfully.
// Tells Capgo "this bundle works" so it doesn't roll back.
export async function markBundleReady() {
  if (!isNative()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // Non-native build or plugin missing — safe to ignore
  }
}

// Optional: manually trigger a check. autoUpdate already runs this on resume,
// so normal flow doesn't need it. Useful for a "check for updates" button.
export async function checkForUpdate() {
  if (!isNative()) return null;
  try {
    const latest = await CapacitorUpdater.getLatest();
    return latest;
  } catch {
    return null;
  }
}

// Read the current bundle info — useful for "version" display in an About screen.
export async function getCurrentBundleInfo() {
  if (!isNative()) return null;
  try {
    return await CapacitorUpdater.current();
  } catch {
    return null;
  }
}
