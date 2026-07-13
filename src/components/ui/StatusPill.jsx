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
 * ════════════════════════════════════════════════
 */

const TONE_KEYWORDS = {
  success: ['paid', 'active', 'complete', 'completed', 'approved', 'resolved', 'linked', 'won', 'sent', 'delivered', 'connected', 'enabled', 'live', 'success'],
  danger: ['urgent', 'overdue', 'failed', 'error', 'declined', 'rejected', 'cancelled', 'canceled', 'lost', 'unpaid', 'past_due', 'blocked', 'needs_response', 'disabled'],
  warning: ['pending', 'waiting', 'draft', 'review', 'partial', 'hold', 'on_hold', 'due', 'warning', 'dev_only', 'unregistered'],
  info: ['active_work', 'in_progress', 'scheduled', 'confirmed', 'processing', 'sent_to', 'open', 'new', 'info', 'en_route'],
  neutral: ['closed', 'inactive', 'archived', 'cancelled', 'default', 'unknown', 'none', 'paused'],
};

/** Classify a raw status string into one of the five semantic tones. */
export function toneForStatus(status) {
  if (!status) return 'neutral';
  const s = String(status).toLowerCase().trim().replace(/\s+/g, '_');
  for (const [tone, words] of Object.entries(TONE_KEYWORDS)) {
    if (words.includes(s)) return tone;
  }
  // substring fallback (e.g. "estimate_approved" → success via "approved")
  for (const [tone, words] of Object.entries(TONE_KEYWORDS)) {
    if (words.some((w) => s.includes(w))) return tone;
  }
  return 'neutral';
}

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
