/**
 * ════════════════════════════════════════════════
 * FILE: backNav.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One small helper for "go back" buttons. It checks whether the app itself
 *   has a previous screen to return to. If it does, Back returns there; if
 *   not — the screen was opened cold, e.g. from a notification tap or a saved
 *   link — Back goes to a sensible fallback screen instead of doing nothing.
 *
 * DEPENDS ON:
 *   Packages:  none (react-router's navigate function is passed in)
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - React Router v7 stamps an `idx` counter on window.history.state for every
 *     in-app history entry; idx > 0 means there is an in-app screen behind this
 *     one. useNavDirection.js already relies on the same read.
 *   - The fallback navigates with { replace: true } so the dead-end entry is
 *     replaced rather than buried — Back after a fallback never bounces the
 *     user forward onto the screen they just escaped.
 * ════════════════════════════════════════════════
 */

/** True when the router has an in-app history entry behind the current one. */
export function canGoBack() {
  return typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0;
}

/**
 * History-aware back: pop to the previous in-app screen when one exists,
 * otherwise go to `fallback` (replacing the dead-end entry).
 * @param {(to: string|number, opts?: object) => void} navigate react-router navigate
 * @param {string} fallback route to use when there is no in-app history
 */
export function goBackOr(navigate, fallback) {
  if (canGoBack()) navigate(-1);
  else navigate(fallback, { replace: true });
}
