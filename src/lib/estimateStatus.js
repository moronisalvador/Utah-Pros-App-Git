/**
 * ════════════════════════════════════════════════
 * FILE: estimateStatus.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides the one word that describes where an estimate stands: is it still a
 *   draft, is it recorded in QuickBooks but not yet emailed, has it actually been
 *   emailed to the customer, or has it already become an invoice. Every screen that
 *   shows an estimate's status asks this file, so the phone and the desktop can
 *   never disagree about whether a customer has seen their estimate.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain rule module, not a screen)
 *   Rendered by:  n/a — imported by the estimate list surfaces
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *              (callers pass a get_estimates() row, which already returns
 *               qbo_emailed_at — no RPC or migration change was needed)
 *
 * NOTES / GOTCHAS:
 *   - "Sent" means EMAILED (`qbo_emailed_at`), not "exists in QuickBooks".
 *     Before this module, three list surfaces called an estimate Sent as soon as it
 *     had a `qbo_estimate_id`. Measured live on 2026-08-07: of 57 estimates in
 *     QuickBooks only 11 had ever been emailed, so 46 were telling the office a
 *     customer had received an estimate they never got — and the Sent filter tab
 *     buried them among the genuinely-sent ones, so nobody followed up.
 *   - This is the same three-tier lifecycle invoices already use
 *     (`20260709_invoice_saved_status_tier.sql` → `collTokens.invoiceStatusKind`).
 *     Estimates simply never got the fix; this ports it.
 *   - TIER vs KIND. `estimateStatusTier` is the pure lifecycle and is what filters
 *     use. `estimateStatusKind` overlays `error` on top for display. They are split
 *     so a sync-errored estimate still lands in a filter tab instead of vanishing
 *     from every one of them.
 * ════════════════════════════════════════════════
 */

/** Display kinds, in the order the rules are applied. */
export const ESTIMATE_STATUS_KINDS = Object.freeze([
  'converted', 'error', 'sent', 'saved', 'draft',
]);

/** Lifecycle tiers — no `error`, because a sync error is a condition, not a stage. */
export const ESTIMATE_STATUS_TIERS = Object.freeze([
  'converted', 'sent', 'saved', 'draft',
]);

/**
 * The pure lifecycle position of an estimate. Use this for FILTERING.
 *
 *   draft     — not in QuickBooks yet
 *   saved     — recorded in QuickBooks, not emailed to the customer
 *   sent      — emailed to the customer (`qbo_emailed_at`)
 *   converted — already turned into an invoice
 *
 * @param {object} r a `get_estimates()` row
 * @returns {'converted'|'sent'|'saved'|'draft'}
 */
export function estimateStatusTier(r) {
  if (r?.converted_invoice_id) return 'converted';
  if (!r?.qbo_estimate_id) return 'draft';
  return r?.qbo_emailed_at ? 'sent' : 'saved';
}

/**
 * The word to SHOW for an estimate. Same as the tier, except a QuickBooks sync
 * error outranks everything below `converted` — the office needs to see it.
 *
 * @param {object} r a `get_estimates()` row
 * @returns {'converted'|'error'|'sent'|'saved'|'draft'}
 */
export function estimateStatusKind(r) {
  if (r?.converted_invoice_id) return 'converted';
  if (r?.qbo_sync_error) return 'error';
  return estimateStatusTier(r);
}

const ESTIMATE_STATUS_LABEL = Object.freeze({
  converted: 'Converted',
  error: 'Sync error',
  sent: 'Sent',
  saved: 'Saved',
  draft: 'Draft',
});

/** Human label for a kind. Unknown kinds render as '' rather than throwing. */
export const estimateStatusLabel = (kind) => ESTIMATE_STATUS_LABEL[kind] || '';

/**
 * Does this estimate belong in the given filter tab?
 * `mode` is 'all' or one of ESTIMATE_STATUS_TIERS. Filtering on the tier (not the
 * kind) is deliberate: a sync-errored estimate stays findable under Saved or Sent
 * instead of disappearing from every tab.
 */
export function matchesEstimateFilter(r, mode) {
  if (!mode || mode === 'all') return true;
  return estimateStatusTier(r) === mode;
}

/** The segmented-control options every estimate list shows, in order. */
export const ESTIMATE_FILTER_OPTIONS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'saved', label: 'Saved' },
  { value: 'sent', label: 'Sent' },
  { value: 'converted', label: 'Converted' },
]);
