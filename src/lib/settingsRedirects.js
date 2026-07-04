/**
 * ════════════════════════════════════════════════
 * FILE: settingsRedirects.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The list of old settings URLs that were retired when the Settings area was
 *   reorganized, and where each one now permanently sends you. App.jsx builds a
 *   redirect route from each entry, so an old bookmark, an emailed link, or a
 *   stored notification link keeps working forever.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data module)
 *   Rendered by:  n/a — imported by src/App.jsx (and the redirect test)
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - PERMANENT: notifications.link rows already store /tech-feedback, so these
 *     mappings must not be removed. Settings Overhaul Phase F.
 *   - `from` paths are relative (no leading slash) because they mount inside the
 *     SettingsLayout route group; `to` paths are absolute.
 * ════════════════════════════════════════════════
 */
export const SETTINGS_REDIRECTS = [
  { from: 'admin',                    to: '/settings/team' },
  { from: 'admin/integrations',       to: '/settings/integrations' },
  { from: 'admin/demo-sheet-builder', to: '/settings/scope-sheets' },
  { from: 'tech-feedback',            to: '/settings/feedback' },
  { from: 'payments/settings',        to: '/settings/payments' },
];
