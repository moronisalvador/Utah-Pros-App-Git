/**
 * ════════════════════════════════════════════════
 * FILE: qboReceivePaymentRollout.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the grouped QuickBooks receive-payment interface dark unless the
 *   current web deployment explicitly opts into showing it. This is only a UI
 *   rollout switch; the Worker independently enforces authorization and its
 *   own default-off provider gate.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → Vite build environment only
 *              writes → none
 * ════════════════════════════════════════════════
 */

export function isQboReceivePaymentUiEnabled(env = import.meta.env) {
  return env?.VITE_QBO_RECEIVE_PAYMENT_UI_ENABLED === 'true';
}
