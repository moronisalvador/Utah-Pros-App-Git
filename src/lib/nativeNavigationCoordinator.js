/**
 * ════════════════════════════════════════════════
 * FILE: nativeNavigationCoordinator.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides when an approved iPhone link may open a screen. It keeps at most
 *   one private link while sign-in finishes and forgets that link if a
 *   different employee takes over.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Callers pass only targets already normalized by the native link policy.
 *     Unknown direct inputs still fail closed.
 *   - Password-recovery fragments are never retained in pending state.
 *   - Notification actions require an already verified employee/owner lease.
 * ════════════════════════════════════════════════
 */

export const NATIVE_FOREGROUND_PUSH_MESSAGE = 'New notification received';

const PUBLIC_STATIC_PATHS = new Set([
  '/login',
  '/set-password',
  '/privacy',
  '/terms',
  '/support',
]);
const PUBLIC_SIGNING_PATH = /^\/(?:sign|s)\/[A-Za-z0-9_-]{1,256}$/;

function normalizedAuthSnapshot({
  employeeId = null,
  leaseEpoch = null,
  leaseOwner = null,
} = {}) {
  const normalizedEmployeeId = typeof employeeId === 'string' && employeeId
    ? employeeId
    : null;
  const normalizedEpoch = typeof leaseEpoch === 'string' && leaseEpoch
    ? leaseEpoch
    : null;
  const normalizedOwner = typeof leaseOwner === 'string' && leaseOwner
    ? leaseOwner
    : null;
  return {
    employeeId: normalizedEmployeeId,
    leaseEpoch: normalizedEpoch,
    leaseOwner: normalizedOwner,
    ready: !!(
      normalizedEmployeeId
      && normalizedEpoch
      && normalizedOwner
    ),
  };
}

function bindingFor(auth) {
  if (!auth.employeeId) return null;
  return {
    employeeId: auth.employeeId,
    leaseEpoch: auth.ready ? auth.leaseEpoch : null,
    leaseOwner: auth.ready ? auth.leaseOwner : null,
  };
}

function bindingCanContinue(binding, auth) {
  if (!binding) return true;
  if (!auth.employeeId || auth.employeeId !== binding.employeeId) return false;
  if (!binding.leaseEpoch || !binding.leaseOwner) return true;
  return (
    auth.ready
    && auth.leaseEpoch === binding.leaseEpoch
    && auth.leaseOwner === binding.leaseOwner
  );
}

function classifyNormalizedTarget(target) {
  if (
    typeof target !== 'string'
    || !target.startsWith('/')
    || target.startsWith('//')
    || target !== target.trim()
  ) {
    return null;
  }

  const pathnameEnd = target.search(/[?#]/);
  const pathname = pathnameEnd < 0
    ? target
    : target.slice(0, pathnameEnd);

  if (pathname === '/set-password' && target.includes('#')) {
    return 'recovery';
  }
  if (
    PUBLIC_STATIC_PATHS.has(pathname)
    || PUBLIC_SIGNING_PATH.test(pathname)
  ) {
    return 'public';
  }
  if (pathname === '/tech' || pathname.startsWith('/tech/')) {
    return 'protected';
  }
  return null;
}

function invokeWithoutLeak(callback, ...args) {
  try {
    callback(...args);
    return true;
  } catch {
    // Native events are optional entry points. A router/runtime failure must
    // not expose the target or disable later listener cleanup.
    return false;
  }
}

/**
 * Coordinate already-normalized targets with one current AuthContext snapshot.
 * This pure state machine keeps link/account races deterministic and testable.
 */
export function createNativeNavigationCoordinator(initialRuntime = {}) {
  let auth = normalizedAuthSnapshot();
  let pending = null;
  let runtime = {
    navigate: () => {},
    notifyForeground: () => {},
    replaceLocation: () => {},
    ...initialRuntime,
  };

  const dispatchPending = () => {
    if (!pending) return false;
    if (!bindingCanContinue(pending.binding, auth)) {
      pending = null;
      return false;
    }
    if (!auth.ready) return false;

    if (!pending.binding) {
      pending.binding = bindingFor(auth);
    } else if (!pending.binding.leaseEpoch) {
      pending.binding = bindingFor(auth);
    }

    const target = pending.target;
    pending = null;
    return invokeWithoutLeak(runtime.navigate, target);
  };

  const routeTarget = (channel, target) => {
    const kind = classifyNormalizedTarget(target);
    if (!kind) return false;

    // A notification belongs to the account that received it. THIS layer never
    // holds one while signed out or while Auth is still verifying: the bounded
    // pre-readiness hold lives one layer up (startNativePushEventListeners),
    // which re-validates the recipient binding at readiness before anything
    // reaches this coordinator. This refusal stays as defense-in-depth.
    if (channel === 'push' && !auth.ready) return false;

    // Every accepted route is newer than a previously waiting route.
    pending = null;

    if (kind === 'recovery') {
      return invokeWithoutLeak(runtime.replaceLocation, target);
    }
    if (kind === 'public') {
      return invokeWithoutLeak(runtime.navigate, target);
    }

    pending = {
      binding: bindingFor(auth),
      channel,
      target,
    };
    dispatchPending();
    return true;
  };

  return {
    clearPending() {
      pending = null;
    },
    receiveAppLink(target) {
      return routeTarget('app_link', target);
    },
    receivePushTarget(target) {
      return routeTarget('push', target);
    },
    receiveForegroundPush() {
      invokeWithoutLeak(runtime.notifyForeground);
    },
    updateAuth(nextAuth) {
      auth = normalizedAuthSnapshot(nextAuth);
      if (!pending) return;
      if (!bindingCanContinue(pending.binding, auth)) {
        pending = null;
        return;
      }
      // An unauthenticated Universal Link may survive sign-in, but from the
      // first employee snapshot onward it belongs only to that employee.
      if (!pending.binding && auth.employeeId) {
        pending.binding = bindingFor(auth);
      }
      dispatchPending();
    },
    updateRuntime(nextRuntime = {}) {
      runtime = {
        ...runtime,
        ...nextRuntime,
      };
    },
  };
}
