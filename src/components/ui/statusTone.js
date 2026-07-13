/**
 * ════════════════════════════════════════════════
 * FILE: statusTone.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little rulebook that turns a status word ("Paid", "Overdue", "Pending")
 *   into one of the five color families the app uses — success / danger / warning
 *   / info / neutral. StatusPill uses it so every screen colors the same status
 *   the same way. It lives in its own file so the pill component stays a
 *   pure-component file (a React fast-refresh requirement).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * Exports:
 *   toneForStatus(status) → 'success'|'danger'|'warning'|'info'|'neutral'
 *
 * NOTES / GOTCHAS:
 *   - Unknown / empty input returns 'neutral' — never an uncolored pill.
 *   - Exact-word match wins; a substring pass handles compound statuses
 *     (e.g. "estimate_approved" → success via "approved").
 * ════════════════════════════════════════════════
 */

const TONE_KEYWORDS = {
  success: ['paid', 'active', 'complete', 'completed', 'approved', 'resolved', 'linked', 'won', 'sent', 'delivered', 'connected', 'enabled', 'live', 'success'],
  danger: ['urgent', 'overdue', 'failed', 'error', 'declined', 'rejected', 'cancelled', 'canceled', 'lost', 'unpaid', 'past_due', 'blocked', 'needs_response', 'disabled'],
  warning: ['pending', 'waiting', 'draft', 'review', 'partial', 'hold', 'on_hold', 'due', 'warning', 'dev_only', 'unregistered'],
  info: ['active_work', 'in_progress', 'scheduled', 'confirmed', 'processing', 'sent_to', 'open', 'new', 'info', 'en_route'],
  neutral: ['closed', 'inactive', 'archived', 'default', 'unknown', 'none', 'paused'],
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

export default toneForStatus;
