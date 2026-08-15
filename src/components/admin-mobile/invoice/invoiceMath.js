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
 *   - "Saved" vs "Sent" is NOT cosmetic: Saved = recorded in QuickBooks, Sent =
 *     actually emailed to the customer. Only invoices.status carries that split
 *     (see 20260709_invoice_saved_status_tier.sql); sent_at does not.
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

/** Status chip for the header: draft | saved | sent | partial | paid | overdue. */
export function invoiceStatusKind(inv, totals, now = new Date()) {
  const { invoiced, collected, balance } = totals;
  if (invoiced > 0 && balance <= 0.005) return 'paid';
  if (balance > 0 && inv?.due_date) {
    const due = new Date(`${String(inv.due_date).slice(0, 10)}T23:59:59`);
    if (!Number.isNaN(due.getTime()) && now > due) return 'overdue';
  }
  // "issued" = has left draft. sent_at is the first save-to-QuickBooks stamp, so it is a
  // correct signal HERE (it means the invoice reached QuickBooks) — it is not an email date.
  const issued = !!inv?.sent_at || !!inv?.qbo_invoice_id;
  if (!issued || inv?.status === 'draft') return 'draft';
  if (collected > 0) return 'partial';
  // Only the status column distinguishes emailed from merely-recorded: 20260709_invoice_
  // saved_status_tier made 'sent' mean "actually emailed to the customer" and reclassified
  // in-QuickBooks-but-never-emailed rows to 'saved'. Matches collTokens/collFormat.
  return inv?.status === 'sent' ? 'sent' : 'saved';
}

export const STATUS_LABELS = {
  draft: 'Draft', saved: 'Saved', sent: 'Sent', partial: 'Partially paid', paid: 'Paid', overdue: 'Overdue',
};

/**
 * Whole Denver business days between an invoice due date and today.
 * Both inputs are date-only strings, so UTC date arithmetic is deliberately
 * used after the Denver "today" value has already been chosen by the caller.
 */
export function invoiceDaysPastDue(dueDate, companyToday) {
  const parseDateOnly = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [, year, month, day] = match;
    const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const check = new Date(time);
    if (check.getUTCFullYear() !== Number(year)
      || check.getUTCMonth() !== Number(month) - 1
      || check.getUTCDate() !== Number(day)) return null;
    return time;
  };
  const due = parseDateOnly(String(dueDate || '').slice(0, 10));
  const today = parseDateOnly(companyToday);
  return due == null || today == null ? null : Math.round((today - due) / 86_400_000);
}

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
