/**
 * ════════════════════════════════════════════════
 * FILE: NativeUpdateHealthGate.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Tells the native updater that a newly installed web bundle is safe only
 *   after account startup has finished and the selected native screen has
 *   rendered. It stays invisible and does nothing in browser or disabled builds.
 *
 * WHERE IT LIVES:
 *   Route:        all native routes
 *   Rendered by:  src/App.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  contexts/AuthContext, lib/nativeUpdater
 *   Data:      reads  → none
 *              writes → native updater readiness metadata only
 *
 * NOTES / GOTCHAS:
 *   - It must remain inside NativeRoutes' Suspense boundary so a lazy screen
 *     finishes loading before the bundle can be accepted.
 *   - A failed acknowledgement is intentionally not retried in the same launch.
 * ════════════════════════════════════════════════
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  isNativeUpdateHealthVerified,
  markBundleReady,
} from '@/lib/nativeUpdater';

export default function NativeUpdateHealthGate() {
  const { loading, error, sessionExpired } = useAuth();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return undefined;
    if (!isNativeUpdateHealthVerified({ loading, error, sessionExpired })) {
      return undefined;
    }

    attemptedRef.current = true;
    let cancelled = false;
    let secondFrame;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(async () => {
        if (cancelled) return;
        const result = await markBundleReady({ healthVerified: true });
        if (!result.ok && result.reason !== 'ota_disabled' && result.reason !== 'not_native') {
          console.error(
            '[NativeUpdater] Bundle readiness acknowledgement failed:',
            result.reason,
          );
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
    };
  }, [error, loading, sessionExpired]);

  return null;
}
