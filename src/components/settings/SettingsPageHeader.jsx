/**
 * ════════════════════════════════════════════════
 * FILE: SettingsPageHeader.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The title bar every Settings sub-page shows at the top — a big page title,
 *   an optional one-line description, and an optional slot on the right for
 *   buttons. Shared so all the settings pages line up the same way.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared presentational component)
 *   Rendered by:  the Settings sub-pages (Carriers, Team, Commissions, …)
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none (uses the design-system .page-title / .page-subtitle classes)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Uses the existing design-system classes so it needs no new CSS. Polish
 *     phases may restyle inside their own reserved index.css markers.
 * ════════════════════════════════════════════════
 */
export default function SettingsPageHeader({ title, subtitle, actions }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}
