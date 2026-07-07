/**
 * ════════════════════════════════════════════════
 * FILE: estimateActions.js  (Admin Mobile — estimate view helpers, P4a)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small, pure "brain" behind the mobile estimate screen — no screen, no
 *   database, just the calculations. It builds the exact message we send to
 *   QuickBooks to email an estimate, it reads back the answer QuickBooks gives
 *   when we turn an estimate into an invoice (including the "are you sure?"
 *   case), and it works out the friendly status/total we show at the top. It's
 *   split out so it can be tested on its own without opening the screen.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain helper module)
 *   Rendered by:  n/a — imported by AdminEstimateDetail.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none (pure functions)
 *
 * NOTES / GOTCHAS:
 *   - buildEstimateSendPayload omits send_to when there's no email, so the
 *     /api/qbo-estimate worker falls back to the contact's own email (its
 *     documented default) instead of receiving an empty string.
 *   - convert_estimate_to_invoice returns {needs_confirm:true, existing_line_count}
 *     when the target invoice already has lines and p_force was false — the two-click
 *     "append" flow keys off that. The RPC may return a row or a 1-element array.
 * ════════════════════════════════════════════════
 */

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ─── SECTION: Helpers ──────────────

/**
 * Build the POST /api/qbo-estimate body that asks QuickBooks to EMAIL the
 * estimate to the customer. `send_to` is included only when a non-empty email
 * is given; otherwise the worker defaults to the contact's email on file.
 */
export function buildEstimateSendPayload(estimateId, sendTo) {
  const to = (sendTo || '').trim();
  return { estimate_id: estimateId, action: 'send', ...(to ? { send_to: to } : {}) };
}

/**
 * Normalize the convert_estimate_to_invoice RPC return into a plain shape the
 * page can branch on: the "needs a second click to append" case, or the
 * success case carrying the new invoice id.
 */
export function interpretConvertResult(res) {
  const r = Array.isArray(res) ? res[0] : res;
  if (!r) return { needsConfirm: false, existingLineCount: 0, invoiceId: null };
  if (r.needs_confirm) {
    return { needsConfirm: true, existingLineCount: Number(r.existing_line_count || 0), invoiceId: null };
  }
  return { needsConfirm: false, existingLineCount: 0, invoiceId: r.invoice_id || null };
}

/**
 * Presentational view-model derived from an estimate row + its line items:
 * whether it's in QuickBooks, whether it's been converted, the running total,
 * the doc number to show, and a human status label + color kind.
 */
export function deriveEstimateView(est, lines = []) {
  const synced = !!est?.qbo_estimate_id;
  const converted = !!est?.converted_invoice_id;
  const subtotal = (lines || []).reduce(
    (s, l) => s + Number(l.line_total != null ? l.line_total : Number(l.quantity || 0) * Number(l.unit_price || 0)),
    0,
  );
  const total = round2(subtotal);
  const docNumber = est?.qbo_doc_number || est?.estimate_number || 'New estimate';
  const statusLabel = converted ? 'Converted' : !synced ? 'Draft' : est?.qbo_emailed_at ? 'Sent' : 'Saved';
  const statusKind = { Converted: 'success', Sent: 'info', Saved: 'neutral', Draft: 'neutral' }[statusLabel] || 'neutral';
  return { synced, converted, subtotal, total, docNumber, statusLabel, statusKind };
}
