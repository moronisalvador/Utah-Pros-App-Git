/**
 * ════════════════════════════════════════════════
 * FILE: webPushClient.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the browser fixture focused on the native Push controls and prevents
 *   it from asking the browser for permission or creating a subscription.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → synthetic fixture state only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This file does not prove PWA Web Push behavior.
 * ════════════════════════════════════════════════
 */
export function isPushSupported() {
  return false;
}
export async function getExistingSubscription() {
  return null;
}
export async function getVapidPublicKey() {
  return null;
}
export function pushPermission() {
  return 'default';
}
export async function enablePush() {
  return { ok: false };
}
export async function disablePush() {
  return { ok: false };
}
