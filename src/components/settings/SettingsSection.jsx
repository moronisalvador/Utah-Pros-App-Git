/**
 * ════════════════════════════════════════════════
 * FILE: SettingsSection.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A titled block used inside a Settings page — a section heading, an optional
 *   description line, an optional right-side actions slot, and the section's
 *   content below. Shared so the different settings screens group their controls
 *   the same way.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared presentational component)
 *   Rendered by:  the Settings sub-pages
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Token-based inline styles, no new CSS. Polish phases may migrate these to
 *     classes inside their own reserved index.css markers.
 * ════════════════════════════════════════════════
 */
export default function SettingsSection({ title, description, actions, children }) {
  return (
    <section style={{ marginBottom: 'var(--space-5)' }}>
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: description ? 4 : 'var(--space-3)' }}>
          {title && <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h2>}
          {actions && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>{actions}</div>}
        </div>
      )}
      {description && <p style={{ margin: '0 0 var(--space-3)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{description}</p>}
      {children}
    </section>
  );
}
