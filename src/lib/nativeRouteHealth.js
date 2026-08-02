/**
 * ════════════════════════════════════════════════
 * FILE: nativeRouteHealth.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Latches any React route-render failure during native startup so a broken
 *   over-the-air bundle cannot be acknowledged as healthy.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ErrorBoundary, NativeUpdateHealthGate
 *   Data:      in-memory launch state only
 *
 * NOTES / GOTCHAS:
 *   - Once failed, the current JavaScript launch stays failed. A user-visible
 *     retry may recover the screen, but it must not accept that OTA bundle.
 * ════════════════════════════════════════════════
 */
let nativeRouteFailed = false;

export function reportNativeRouteFailure() {
  nativeRouteFailed = true;
}

export function isNativeRouteHealthy() {
  return nativeRouteFailed === false;
}

export function resetNativeRouteHealthForTest() {
  nativeRouteFailed = false;
}
