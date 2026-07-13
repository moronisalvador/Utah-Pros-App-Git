/**
 * ════════════════════════════════════════════════
 * FILE: StatusPill.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little colored badge that shows a status — "Paid", "Overdue", "Pending",
 *   "Active". It picks the right color family (green / red / amber / blue / gray)
 *   from the status word so every screen shows the same status the same color,
 *   and it reads its colors from the shared design tokens (so dark mode and any
 *   future re-tone are a one-place change, never a per-badge edit).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  any list/card/detail that shows a status (import from '@/components/ui')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  styles in src/index.css (.ui-status-pill + the semantic --success/--danger/… tokens)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Replaces the 158 inline status pills + the inline-hex "Status Color Palette"
 *     recipe that UPR-Design-System.md used to prescribe. W3 migrates the call sites.
 *   - Pass an explicit `tone` ('success'|'danger'|'warning'|'info'|'neutral') to be
 *     exact, OR a `status` string and let toneForStatus() classify it. Unknown
 *     strings fall back to 'neutral' — never an uncolored/broken pill.
 *   - `dot` adds a leading status dot (the .status-badge idiom). `label` overrides
 *     the visible text (defaults to the humanized status).
 *   - The status→tone classifier lives in ./statusTone.js (kept separate so this
 *     stays a pure-component file for React fast-refresh).
 * ════════════════════════════════════════════════
 */

import { toneForStatus } from './statusTone';

function humanize(status) {
  return String(status || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function StatusPill({ status, tone, label, dot = false, className = '', ...rest }) {
  const resolvedTone = tone || toneForStatus(status);
  const text = label != null ? label : humanize(status);
  return (
    <span
      className={`ui-status-pill${className ? ' ' + className : ''}`}
      data-tone={resolvedTone}
      {...rest}
    >
      {dot && <span className="ui-status-pill-dot" aria-hidden="true" />}
      {text}
    </span>
  );
}
