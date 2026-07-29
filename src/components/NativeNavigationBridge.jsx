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
 *   - A notification action is accepted only for an already verified account;
 *     unlike a Universal Link, it can never wait across sign-in.
 * ════════════════════════════════════════════════
 */
import {
  useEffect,
  useLayoutEffect,
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

  useLayoutEffect(() => {
    coordinator.updateRuntime({
      navigate,
      notifyForeground: () => toast(NATIVE_FOREGROUND_PUSH_MESSAGE),
      replaceLocation: (target) => window.location.replace(target),
    });
  }, [coordinator, navigate]);

  useLayoutEffect(() => {
    coordinator.updateAuth({
      employeeId: employee?.id || null,
      leaseEpoch: pwaOwnerLease?.epoch || null,
      leaseOwner: pwaOwnerLease?.owner || null,
    });
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
      employeeId: employee?.id || null,
      onForeground: () => {
        if (accepting) coordinator.receiveForegroundPush();
      },
      onTarget: (target) => {
        if (accepting) coordinator.receivePushTarget(target);
      },
    });
    settleLifecycleReady(appLinks);
    settleLifecycleReady(pushEvents);

    return () => {
      accepting = false;
      coordinator.clearPending();
      stopLifecycle(appLinks);
      stopLifecycle(pushEvents);
    };
  }, [coordinator, employee?.id, enabled]);

  return null;
}
