/**
 * ════════════════════════════════════════════════
 * FILE: EmptyState.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The friendly "nothing here yet" panel a list shows when a load SUCCEEDED but
 *   there are zero rows — an icon, a title, a one-line explanation, and an
 *   optional action button (e.g. "Create one"). It is deliberately the SUCCESS
 *   empty state only: a failed load must show <ErrorState>, never this (that
 *   confusion — an outage reading as "no jobs" — is exactly what the states law
 *   in loading-error-states.md forbids).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  any list/tab after a successful zero-row load (import from '@/components/ui')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  styles in src/index.css (.ui-empty-state)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Render this ONLY after a successful load with zero rows (loading-error-states.md §2).
 *   - `action` is any node (usually a <button className="btn btn-primary">). On tech
 *     surfaces the empty state should show upcoming work, not a dead end (tech-mobile-ux.md).
 * ════════════════════════════════════════════════
 */

export default function EmptyState({ icon, title, sub, action, className = '' }) {
  return (
    <div className={`ui-empty-state${className ? ' ' + className : ''}`}>
      {icon != null && <div className="ui-empty-state-icon" aria-hidden="true">{icon}</div>}
      {title && <div className="ui-empty-state-title">{title}</div>}
      {sub && <div className="ui-empty-state-sub">{sub}</div>}
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
