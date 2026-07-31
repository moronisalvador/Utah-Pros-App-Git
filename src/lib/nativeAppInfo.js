/**
 * ════════════════════════════════════════════════
 * FILE: nativeAppInfo.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the version, build number, and app identity (the "bundle id")
 *   embedded in the installed iOS app. Browser/PWA builds stay passive and
 *   never load the native App plugin.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core, @capacitor/app (native-only dynamic import)
 *   Internal:  none
 *   Data:      reads → installed bundle metadata
 *
 * NOTES / GOTCHAS:
 *   - package.json and web release metadata are intentionally not fallbacks;
 *     they do not identify the installed App Store binary.
 * ════════════════════════════════════════════════
 */

import { Capacitor } from '@capacitor/core';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function getInstalledAppInfo({
  native = Capacitor.isNativePlatform(),
  loadAppPlugin = () => import('@capacitor/app'),
} = {}) {
  if (!native) return { state: 'web' };

  try {
    const { App } = await loadAppPlugin();
    const info = await App.getInfo();
    const version = nonEmpty(info?.version);
    const build = nonEmpty(info?.build);
    if (!version || !build) return { state: 'unavailable' };
    return { state: 'ready', version, build };
  } catch {
    return { state: 'unavailable' };
  }
}

/**
 * The installed app's bundle identifier — ground truth for the APNs topic a
 * push registration belongs to (the production and side-by-side "UPR Dev"
 * apps differ only here). Build-time env is deliberately not a fallback: a
 * configured value can drift from the binary; the OS-reported id cannot.
 */
export async function getInstalledAppBundleId({
  native = Capacitor.isNativePlatform(),
  loadAppPlugin = () => import('@capacitor/app'),
} = {}) {
  if (!native) return null;

  try {
    const { App } = await loadAppPlugin();
    const info = await App.getInfo();
    return nonEmpty(info?.id);
  } catch {
    return null;
  }
}
