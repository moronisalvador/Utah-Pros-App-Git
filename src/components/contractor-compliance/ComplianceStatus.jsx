/**
 * ════════════════════════════════════════════════
 * FILE: ComplianceStatus.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns a compliance warning word into the same clearly colored label everywhere it appears.
 *   It does not decide whether a contractor is ready; it only presents the answer it was given.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  Contractor Compliance dashboard and detail pages
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  src/components/ui
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - New status words need an explicit label and tone here so unknown states do not look healthy.
 * ════════════════════════════════════════════════
 */
import { StatusPill } from '@/components/ui';

const LABELS = {
  ready: 'Ready', missing: 'Missing', needs_review: 'Needs review', expiring: 'Expiring',
  expired: 'Expired', gap: 'Coverage gap', inactive: 'Inactive', pending_review: 'Needs review',
  valid: 'Valid', rejected: 'Rejected', stale_previous_year: 'Previous year',
  not_ready: 'Not ready', handed_off: 'Handed off', reconciled: 'Reconciled',
};
const TONES = {
  ready: 'success', missing: 'danger', needs_review: 'warning', pending_review: 'warning',
  expiring: 'warning', expired: 'danger', gap: 'danger', inactive: 'neutral',
  valid: 'success', rejected: 'danger', stale_previous_year: 'warning',
  not_ready: 'neutral', handed_off: 'info', reconciled: 'success',
};

export default function ComplianceStatus({ status, className = '' }) {
  return <StatusPill status={status || 'missing'} label={LABELS[status] || status || 'Missing'} tone={TONES[status] || 'neutral'} dot className={className} />;
}
