/**
 * ════════════════════════════════════════════════
 * FILE: ErrorState.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The panel a screen shows when loading its data FAILED — a short message and a
 *   "Try again" button that re-runs the load. It exists so a failed fetch never
 *   falls through to a blank white page or the "nothing here yet" empty state
 *   (the two highest-impact bugs the UX audit found). Copied in shape from the
 *   proven pattern at TechJobDetail.jsx:330 / Jobs.jsx.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  any page/tab whose load() threw (import from '@/components/ui')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  styles in src/index.css (.ui-error-state)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Render this in the load() catch branch (set a loadError state), NOT the
 *     empty-state (loading-error-states.md §1). Keep already-loaded stale rows
 *     visible above it where you can, rather than replacing them.
 *   - `onRetry` is usually the same silent `load` the page already has. `secondary`
 *     is an optional extra node (e.g. a "Back" button on a detail screen).
 *   - role="alert" so the failure is announced to screen readers.
 * ════════════════════════════════════════════════
 */

export default function ErrorState({
  message = 'Something went wrong loading this.',
  onRetry,
  retryLabel = 'Try again',
  icon = '⚠️',
  secondary,
  className = '',
}) {
  return (
    <div className={`ui-error-state${className ? ' ' + className : ''}`} role="alert">
      {icon != null && <div className="ui-error-state-icon" aria-hidden="true">{icon}</div>}
      <div className="ui-error-state-title">Couldn’t load</div>
      <div className="ui-error-state-msg">{message}</div>
      {(onRetry || secondary) && (
        <div className="ui-error-state-actions">
          {secondary}
          {onRetry && (
            <button type="button" className="btn btn-primary" onClick={onRetry}>{retryLabel}</button>
          )}
        </div>
      )}
    </div>
  );
}
