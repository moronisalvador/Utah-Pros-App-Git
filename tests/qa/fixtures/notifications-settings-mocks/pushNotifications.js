/**
 * ════════════════════════════════════════════════
 * FILE: pushNotifications.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Supplies loading, failure, or ready device Push states selected by the
 *   fixture URL without touching a phone, Apple, local storage, or a database.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → synthetic fixture URL and browser counters
 *              writes → synthetic browser counters only
 *
 * NOTES / GOTCHAS:
 *   - The pending loading state intentionally never resolves.
 *   - This fixture cannot prove permission prompts or real Push delivery.
 * ════════════════════════════════════════════════
 */
export function canRegisterPush() {
  return true;
}
export function isNativePushEnrollmentEnabled() {
  return true;
}
export function isNativePushUserEnabled() {
  return true;
}
export function hasNativePushDeviceBinding() {
  return true;
}
export async function getNativePushStatus() {
  window.__nativeStatusCalls = (window.__nativeStatusCalls || 0) + 1;
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (mode === 'loading') return new Promise(() => {});
  if (mode === 'error') throw new Error('synthetic status failure');
  return {
    available: true,
    bound: true,
    enabled: true,
    intentEnabled: true,
    pending: false,
    permission: 'granted',
  };
}
export async function enableNativePushForEmployee() {
  return { ok: true };
}
export async function disableNativePushForDevice() {
  return { ok: true };
}
