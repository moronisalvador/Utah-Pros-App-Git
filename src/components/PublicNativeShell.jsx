/**
 * ════════════════════════════════════════════════
 * FILE: PublicNativeShell.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Wraps the screens a person can reach WITHOUT signing in — the login page,
 *   the signature page, set-password, and the privacy/terms/support pages — so
 *   they leave room for the iPhone's camera notch and home bar, and so the
 *   clock and battery stay readable against whatever colour that screen is.
 *   In a web browser it does nothing at all.
 *
 * WHERE IT LIVES:
 *   Route:        wraps every public route in the native route tree
 *   Rendered by:  src/App.jsx (NativeRoutes)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/nativeAppearance (pushStatusBarSurface/restoreStatusBarBase)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Public routes sit OUTSIDE `.tech-layout`, which is the only element that
 *     applied a top inset. None of them consumed one, so on a Dynamic Island
 *     device the signing header collided with the Island.
 *   - `surface` is the colour of the chrome BEHIND the status strip, so the
 *     icons can be chosen to stay legible: login and signing are dark, the
 *     legal and set-password pages are light.
 *   - Safe-area padding is applied in CSS scoped to the native root marker, not
 *     here, so the PWA cannot pick it up. env() is 0 in a browser anyway, but
 *     the marker makes that a structural guarantee rather than a coincidence.
 *   - This is the SECOND top-inset owner in the app, and deliberately so:
 *     `.tech-layout` owns the authenticated shell, this owns the public one, and
 *     they never nest. tests/qa/unit/safe-area-single-owner.test.js pins both.
 * ════════════════════════════════════════════════
 */
import { useEffect } from 'react';
import { pushStatusBarSurface, restoreStatusBarBase } from '@/lib/nativeAppearance';

export default function PublicNativeShell({ surface = 'light', children }) {
  useEffect(() => {
    // No-ops on web (nativeAppearance guards every call on isNativePlatform).
    pushStatusBarSurface(surface);
    // Hand the strip back to the theme, not to a hardcoded style — see STAT-01.
    return () => restoreStatusBarBase();
  }, [surface]);

  return (
    <div className="public-native-shell" data-surface={surface}>
      {children}
    </div>
  );
}
