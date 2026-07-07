/**
 * ════════════════════════════════════════════════
 * FILE: invoiceMath.js  (Admin Mobile — invoice money math + display helpers)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small calculators the mobile invoice screen uses: how much the invoice is
 *   for, how much has been collected, what's still owed, and what status chip
 *   to show (draft / sent / partially paid / paid / overdue). Plus formatters
 *   for dollars and dates so every number reads the same way.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none (pure functions)
 *
 * NOTES / GOTCHAS:
 *   - invoiceTotals mirrors the desktop calc (src/pages/InvoiceEditor.jsx):
 *     invoiced = adjusted_total ?? total ?? live line total; balance =
 *     invoiced − amount_paid. amount_paid is trigger-maintained — read-only.
 *   - statusKind mirrors collTokens.invoiceStatusKind (read to replicate,
 *     never imported — src/components/collections/** is frozen for this wave).
 * ════════════════════════════════════════════════
 */

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Invoiced / collected / balance — the desktop calc, reused verbatim. */
export function invoiceTotals(inv, lines = []) {
  const liveTotal = round2(
    lines.reduce((s, l) => s + Number(l.line_total || 0), 0) + Number(inv?.tax || 0),
  );
  const invoiced = Number(inv?.adjusted_total ?? inv?.total ?? liveTotal);
  const collected = Number(inv?.amount_paid || 0);
  return { invoiced, collected, balance: round2(invoiced - collected) };
}

/** Status chip for the header: draft | sent | partial | paid | overdue. */
export function invoiceStatusKind(inv, totals, now = new Date()) {
  const { invoiced, collected, balance } = totals;
  if (invoiced > 0 && balance <= 0.005) return 'paid';
  if (balance > 0 && inv?.due_date) {
    const due = new Date(`${String(inv.due_date).slice(0, 10)}T23:59:59`);
    if (!Number.isNaN(due.getTime()) && now > due) return 'overdue';
  }
  const sent = !!inv?.sent_at || !!inv?.qbo_invoice_id;
  if (!sent || inv?.status === 'draft') return 'draft';
  if (collected > 0) return 'partial';
  return 'sent';
}

export const STATUS_LABELS = {
  draft: 'Draft', sent: 'Sent', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue',
};

/** "$1,234.56" — always two decimals, tabular-friendly. */
export const fmtMoney = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Jul 7, 2026" from a date or ISO string (date-only strings stay local-safe). */
export function fmtDate(v) {
  if (!v) return '—';
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
