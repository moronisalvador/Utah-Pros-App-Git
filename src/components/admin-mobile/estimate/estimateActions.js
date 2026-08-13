/**
 * ════════════════════════════════════════════════
 * FILE: estimateActions.js  (Admin Mobile — estimate view helpers, P4a)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The small, pure "brain" behind the mobile estimate screen — no screen, no
 *   database, just the calculations. It reads the answer returned when we turn
 *   an estimate into an invoice (including the "are you sure?" case), and works
 *   out the friendly status and total shown at the top. It is split out so these
 *   rules can be tested without opening the screen.
 *
 * USED BY:
 *   AdminEstimateDetail.jsx (the mobile estimate screen).
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none (pure functions)
 *
 * NOTES / GOTCHAS:
 *   - convert_estimate_to_invoice returns {needs_confirm:true, existing_line_count}
 *     when the target invoice already has lines and p_force was false — the two-click
 *     "append" flow keys off that. The RPC may return a row or a 1-element array.
 * ════════════════════════════════════════════════
 */

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// ─── SECTION: Helpers ──────────────

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
