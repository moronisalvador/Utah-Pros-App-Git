/**
 * ════════════════════════════════════════════════
 * FILE: TabLoading.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A tiny centered "Loading…" placeholder shown while a settings/admin panel
 *   fetches its data. Extracted so every panel shares one look instead of each
 *   inventing its own spinner.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a shared presentational component)
 *   Rendered by:  the settings sub-pages (and any panel that loads async data)
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Byte-identical to the original DevTools-local TabLoading. DevTools keeps
 *     its own local copy for now; it can adopt this export in the anytime-lane
 *     DevTools split.
 * ════════════════════════════════════════════════
 */
export default function TabLoading({ label = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
      {label}
    </div>
  );
}
