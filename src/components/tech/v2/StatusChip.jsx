/**
 * ════════════════════════════════════════════════
 * FILE: StatusChip.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A little colored pill that shows an appointment's status (Scheduled, On My
 *   Way, Working, Paused, Done, Cancelled). The color is the message — readable
 *   from three feet away in sunlight — so status, not division, owns the color
 *   channel in v2. Blue = scheduled, amber = on my way, green = working, red =
 *   paused, gray = done/cancelled.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  v2 schedule + dashboard rows
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  index.css (.tv2-status-chip + --status-* tokens on .tech-layout)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Colors come from the --status-* CSS custom properties defined on
 *     .tech-layout (single source of truth), NOT hardcoded hex — the chip only
 *     picks which token set to apply per status.
 * ════════════════════════════════════════════════
 */
import React from 'react';

// status → { label, token } where token maps to the --status-<token>-* trio.
const STATUS = {
  scheduled:   { label: 'Scheduled', token: 'scheduled' },
  confirmed:   { label: 'Scheduled', token: 'scheduled' },
  en_route:    { label: 'On My Way', token: 'enroute' },
  in_progress: { label: 'Working',   token: 'working' },
  paused:      { label: 'Paused',    token: 'paused' },
  completed:   { label: 'Done',      token: 'completed' },
  cancelled:   { label: 'Cancelled', token: 'completed' },
};

/**
 * @param {{ status: string, className?: string }} props
 */
export default function StatusChip({ status, className = '' }) {
  const cfg = STATUS[status] || STATUS.scheduled;
  const style = {
    background: `var(--status-${cfg.token}-bg)`,
    color: `var(--status-${cfg.token}-color)`,
  };
  return (
    <span className={`tv2-status-chip ${className}`.trim()} style={style}>
      {cfg.label}
    </span>
  );
}
