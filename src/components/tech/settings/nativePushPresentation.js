/**
 * ════════════════════════════════════════════════
 * FILE: nativePushPresentation.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Converts the native Push status into truthful Settings copy keys. It keeps
 *   pending, blocked, and unknown permission states from being called "On."
 *
 * DEPENDS ON:
 *   Internal: settings locale keys
 *   Data:     none
 *
 * NOTES / GOTCHAS:
 *   - A stored intent/binding is not proof that iOS currently permits delivery.
 *   - Pending cleanup takes precedence over every stale local marker.
 *   - Device actions select exactly one channel; there is no fallback.
 * ════════════════════════════════════════════════
 */

export function getNativePushPresentation({
  activationReady,
  bound,
  effectiveEnabled,
  intentEnabled,
  pending,
  permission,
}) {
  if (!activationReady) {
    return {
      hintKey: 'notifications.nativePendingHint',
      statusKey: 'notifications.statusNativePending',
    };
  }
  if (pending) {
    return {
      hintKey: 'notifications.nativeCleanupPendingHint',
      statusKey: 'notifications.statusNativeCleanupPending',
    };
  }
  if (intentEnabled && bound && permission === 'denied') {
    return {
      hintKey: 'notifications.blockedHint',
      statusKey: 'notifications.statusNativeBlocked',
    };
  }
  if (effectiveEnabled) {
    return {
      hintKey: 'notifications.nativeManagedHint',
      statusKey: 'notifications.statusOn',
    };
  }
  if (intentEnabled && bound) {
    return {
      hintKey: 'notifications.nativePermissionCheckingHint',
      statusKey: 'notifications.statusNativeChecking',
    };
  }
  return {
    hintKey: 'notifications.nativeOffHint',
    statusKey: 'notifications.statusOff',
  };
}

export function runDevicePushAction({
  isNativeApp,
  nativeAction,
  webAction,
}) {
  return isNativeApp ? nativeAction() : webAction();
}
