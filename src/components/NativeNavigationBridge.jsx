/**
 * ════════════════════════════════════════════════
 * FILE: NativeNavigationBridge.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Opens approved links and notification taps in the iPhone app. It waits for
 *   the signed-in employee to be fully verified before opening private field
 *   screens, and forgets an old employee's waiting link during account changes.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, @capacitor/core
 *   Internal:  contexts/AuthContext, lib/nativeAppLinks,
 *              lib/pushNotifications, lib/toast
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Listener modules validate and normalize every target before it reaches
 *     this bridge. Unknown direct inputs still fail closed.
 *   - Password-recovery fragments are sent straight to location.replace().
 *     They are never queued, logged, placed in router state, or persisted.
 *   - A notification tap before sign-in verification waits inside the push
 *     listener lifecycle (memory only, newest tap wins) and navigates only if
 *     its recipient binding matches the employee verified at readiness. The
 *     listener effect therefore must not restart on employee change — auth
 *     updates flow through the lifecycle's updateAuth instead.
 * ════════════════════════════════════════════════
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { startNativeAppLinkListeners } from '@/lib/nativeAppLinks';
import {
  createNativeNavigationCoordinator,
  NATIVE_FOREGROUND_PUSH_MESSAGE,
} from '@/lib/nativeNavigationCoordinator';
import { startNativePushEventListeners } from '@/lib/pushNotifications';
import { toast } from '@/lib/toast';

function settleLifecycleReady(lifecycle) {
  try {
    Promise.resolve(lifecycle?.ready).catch(() => {});
  } catch {
    // Listener readiness is additive; route rendering must keep working.
  }
}

function stopLifecycle(lifecycle) {
  try {
    Promise.resolve(lifecycle?.stop?.()).catch(() => {});
  } catch {
    // Cleanup remains best-effort and must never throw during React unmount.
  }
}

export default function NativeNavigationBridge({ enabled = false }) {
  const navigate = useNavigate();
  const { employee, pwaOwnerLease } = useAuth();
  const [coordinator] = useState(createNativeNavigationCoordinator);
  const authStateRef = useRef({ employeeId: null, ready: false });
  const pushLifecycleRef = useRef(null);

  useLayoutEffect(() => {
    coordinator.updateRuntime({
      navigate,
      notifyForeground: () => toast(NATIVE_FOREGROUND_PUSH_MESSAGE),
      replaceLocation: (target) => window.location.replace(target),
    });
  }, [coordinator, navigate]);

  useLayoutEffect(() => {
    const employeeId = employee?.id || null;
    const leaseEpoch = pwaOwnerLease?.epoch || null;
    const leaseOwner = pwaOwnerLease?.owner || null;
    authStateRef.current = {
      employeeId,
      ready: !!(employeeId && leaseEpoch && leaseOwner),
    };
    // Coordinator first: when a held tap re-resolves at readiness, the
    // coordinator must already hold the same verified snapshot it dispatches
    // under.
    coordinator.updateAuth({ employeeId, leaseEpoch, leaseOwner });
    pushLifecycleRef.current?.updateAuth?.(authStateRef.current);
  }, [
    coordinator,
    employee?.id,
    pwaOwnerLease?.epoch,
    pwaOwnerLease?.owner,
  ]);

  useEffect(() => {
    let native = false;
    try {
      native = enabled === true && Capacitor.isNativePlatform() === true;
    } catch {
      native = false;
    }
    if (!native) {
      coordinator.clearPending();
      return undefined;
    }

    let accepting = true;
    const appLinks = startNativeAppLinkListeners({
      onTarget: (target) => {
        if (accepting) coordinator.receiveAppLink(target);
      },
    });
    const pushEvents = startNativePushEventListeners({
      employeeId: authStateRef.current.employeeId,
      onForeground: () => {
        if (accepting) coordinator.receiveForegroundPush();
      },
      onTarget: (target) => {
        if (accepting) coordinator.receivePushTarget(target);
      },
    });
    pushLifecycleRef.current = pushEvents;
    pushEvents.updateAuth?.(authStateRef.current);
    settleLifecycleReady(appLinks);
    settleLifecycleReady(pushEvents);

    return () => {
      accepting = false;
      if (pushLifecycleRef.current === pushEvents) {
        pushLifecycleRef.current = null;
      }
      coordinator.clearPending();
      stopLifecycle(appLinks);
      stopLifecycle(pushEvents);
    };
    // `enabled` must stay render-stable (it is the module constant IS_NATIVE at
    // the mount site). If this effect ever re-ran mid-session, layout effects
    // fire before passive cleanup, so the OLD lifecycle would consume a held
    // tap that stop() then aborts — fail-safe (nothing navigates), but the tap
    // would be lost silently.
  }, [coordinator, enabled]);

  return null;
}
