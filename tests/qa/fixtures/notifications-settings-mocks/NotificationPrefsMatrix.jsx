/**
 * ════════════════════════════════════════════════
 * FILE: NotificationPrefsMatrix.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Displays a harmless placeholder for notification preferences while the
 *   browser check focuses on the real device Push controls above it.
 *
 * WHERE IT LIVES:
 *   Route:        local QA fixture only
 *   Rendered by:  src/components/tech/settings/NotificationsSection.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      reads  → synthetic fixture state only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This file is loaded only through an exact alias in the local QA runner.
 * ════════════════════════════════════════════════
 */
export default function NotificationPrefsMatrix() {
  return <div>Synthetic preference matrix</div>;
}
