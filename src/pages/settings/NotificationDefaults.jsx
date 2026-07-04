/**
 * ════════════════════════════════════════════════
 * FILE: NotificationDefaults.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Notification Defaults" settings screen — set the company-wide default
 *   delivery channels for each kind of notification (what a new employee starts
 *   with before they customize their own preferences).
 *
 * WHERE IT LIVES:
 *   Route:        /settings/notification-defaults
 *   Rendered by:  src/App.jsx (inside SettingsLayout, behind AdminRoute)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/admin/NotificationDefaultsTab
 *   Data:      reads/writes → notification defaults (handled inside
 *              NotificationDefaultsTab)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Admin.jsx "Notifications" tab
 *     (Settings Overhaul Phase F). The tab component moves verbatim — this is a
 *     thin route wrapper around it.
 * ════════════════════════════════════════════════
 */
import NotificationDefaultsTab from '@/components/admin/NotificationDefaultsTab';

export default function NotificationDefaults() {
  return <NotificationDefaultsTab />;
}
