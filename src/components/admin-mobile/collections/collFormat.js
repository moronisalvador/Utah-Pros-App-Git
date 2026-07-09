/**
 * ════════════════════════════════════════════════
 * FILE: collFormat.js  (admin-mobile Collections — pure math + view builders)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The number-crunching and formatting brain behind the mobile Collections
 *   screen. It turns raw invoice / estimate / payment rows from the database into
 *   the tidy little pieces each list row shows (a title, a one-line detail, a
 *   dollar amount, a status word, and where tapping the row should go). It also
 *   works out the accounts-receivable "aging" summary — how much money is owed and
 *   how old that debt is — and the start/end dates for a chosen time window.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain helper module)
 *   Rendered by:  n/a — imported by the admin-mobile Collections tab components
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/components/admin-mobile/href (adminInvoiceHref, adminEstimateHref —
 *              the frozen route builders; imported directly, not via the barrel,
 *              so this pure module never pulls in the auth/Supabase seam)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The aging boundaries, bucket keys, day-math, formatters and the invoice
 *     status rule are MIRRORED from the desktop single-source-of-truth
 *     (src/components/collections/collTokens.js) rather than imported: that tree
 *     is frozen for this wave ("read to mirror logic, never import"). The tests
 *     pin these to the same boundaries so the mobile view can never drift from
 *     the desktop A/R aging.
 *   - AGING_BUCKETS + bucketKey are the reused desktop definitions (P2 acceptance
 *     criterion). Any change to the desktop boundaries must be mirrored here.
 *   - Deep-link hrefs come from Foundation's href helper (the frozen route
 *     contract) — never hardcode "/tech/admin/..." paths.
 * ════════════════════════════════════════════════
 */
import { adminInvoiceHref, adminEstimateHref } from '@/components/admin-mobile/href';

// ─── SECTION: Tab model + financial gate (finding F-2) ──────────────
// The Collections tab bar. `fin: true` marks a FINANCIAL tab (AR aging, Payments
// ledger) whose RPCs are NOT server-gated — those tabs are dropped entirely when
// canAccess('overview_financials') is false, so they never mount and their RPCs
// are never fetched (skips both render AND fetch). visibleCollectionsTabs is the
// single source of that decision so it can be unit-tested without a DOM.
export const COLLECTIONS_TABS = [
  { value: 'ar', label: 'AR aging', fin: true },
  { value: 'invoices', label: 'Invoices', fin: false },
  { value: 'estimates', label: 'Estimates', fin: false },
  { value: 'payments', label: 'Payments', fin: true },
];
// The period switch applies to these tabs only (mirrors the desktop design).
export const PERIOD_TABS = ['ar', 'invoices'];

export function visibleCollectionsTabs(canFin) {
  return COLLECTIONS_TABS.filter((t) => canFin === true || !t.fin);
}

// ─── SECTION: Formatters + date helpers (mirror of desktop collTokens) ──────────────
export const fmt$ = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
export const fmt$2 = (n) =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (v) =>
  v ? new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';

export const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export function divLabel(division) {
  const d = String(division || '').replace(/_/g, ' ').trim();
  if (!d) return '';
  if (d.toLowerCase() === 'water') return 'Water';
  return d.replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseTs(v) {
  if (!v) return null;
  const t = new Date(v + (String(v).includes('T') ? '' : 'T00:00:00')).getTime();
  return Number.isNaN(t) ? null : t;
}

// daysPastDue: positive = overdue by N, 0 = due today, negative = due in N, null = no due date.
export function daysPastDue(dueDate, today = midnight()) {
  if (!dueDate) return null;
  const t = parseTs(dueDate);
  return t == null ? null : Math.floor((today.getTime() - t) / 86400000);
}

// ─── SECTION: Aging buckets (reused desktop AGING_BUCKETS — P2 criterion) ──────────────
// Mirror of collTokens.AGING_BUCKETS / bucketKey. bucketKey maps days-past-due →
// bucket; null/≤0 (undated or not-yet-due) = 'current'.
export const AGING_BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'b30',     label: '1–30 days' },
  { key: 'b60',     label: '31–60 days' },
  { key: 'b90',     label: '61–90 days' },
  { key: 'b90p',    label: '90+ days' },
];
export function bucketKey(d) {
  if (d == null || d <= 0) return 'current';
  if (d <= 30) return 'b30';
  if (d <= 60) return 'b60';
  if (d <= 90) return 'b90';
  return 'b90p';
}

// Invoice status word from balances/dates (mirror of collTokens.invoiceStatusKind):
// paid → overdue → partial → draft → saved → sent. The lifecycle tier
// (draft/saved/sent) comes from the status column + qbo_invoice_id: draft = not in
// QBO or edited since the last push; saved = recorded in QBO, not emailed; sent =
// emailed to the customer.
export function invoiceStatusKind(r, today = midnight()) {
  const total = Number(r.total || 0), paid = Number(r.amount_paid || 0), bal = Number(r.balance || 0);
  if (total > 0 && bal <= 0.005) return 'paid';
  const d = daysPastDue(r.due_date, today);
  if (bal > 0 && d != null && d > 0) return 'overdue';
  if (paid > 0) return 'partial';
  if (!r.qbo_invoice_id || r.status === 'draft') return 'draft';
  return r.status === 'sent' ? 'sent' : 'saved';
}

const STATUS_LABEL = { paid: 'Paid', overdue: 'Overdue', draft: 'Draft', partial: 'Partial', saved: 'Saved', sent: 'Sent' };
export const statusLabel = (kind) => STATUS_LABEL[kind] || '';

// Estimate status word (mirror of EstimatesList.estStatus): converted → sync error → sent → draft.
export function estimateStatusKind(r) {
  if (r.converted_invoice_id) return 'converted';
  if (r.qbo_sync_error) return 'error';
  if (r.qbo_estimate_id) return 'sent';
  return 'draft';
}
const EST_STATUS_LABEL = { converted: 'Converted', error: 'Sync error', sent: 'Sent', draft: 'Draft' };
export const estimateStatusLabel = (kind) => EST_STATUS_LABEL[kind] || '';

// ─── SECTION: Period windows (for get_payments_received + list filtering) ──────────────
// The four standard admin-mobile periods (Foundation's ADMIN_PERIODS) → date bounds.
// Mirror of the desktop dashUtils.periodBounds math; no 'All' (a mobile simplification —
// the four bounded windows keep the period-based cash RPC well-defined).
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// periodWindow: {start,end} Date pair (local midnight → end-of-today) for a period value.
export function periodWindow(period) {
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  let start;
  if (period === 'qtd') start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else if (period === 'ytd') start = new Date(now.getFullYear(), 0, 1);
  else if (period === 'last30') { start = new Date(now); start.setDate(start.getDate() - 29); }
  else start = new Date(now.getFullYear(), now.getMonth(), 1); // mtd (default)
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

// periodBoundsISO: {p_start,p_end} 'YYYY-MM-DD' strings for get_payments_received.
export function periodBoundsISO(period) {
  const { start, end } = periodWindow(period);
  return { p_start: toISO(start), p_end: toISO(end) };
}

// inPeriod: is a row's date inside the window? Undated rows always pass (drafts show).
export function inPeriod(dateVal, period) {
  const { start, end } = periodWindow(period);
  if (!dateVal) return true;
  const t = parseTs(dateVal);
  if (t == null) return true;
  if (t < start.getTime()) return false;
  if (t > end.getTime()) return false;
  return true;
}

// ─── SECTION: A/R aging summary (mirror of ARDashboard's `k`) ──────────────
// Sums open balances (balance > 0.005) into outstanding / overdue / per-bucket totals.
export function summarizeAr(rows = [], today = midnight()) {
  const open = rows.filter((r) => Number(r.balance || 0) > 0.005);
  const aging = {};
  AGING_BUCKETS.forEach((b) => { aging[b.key] = { amount: 0, count: 0 }; });
  let outstanding = 0, overdue = 0, overdueCount = 0;
  open.forEach((r) => {
    const bal = Number(r.balance || 0);
    outstanding += bal;
    const d = daysPastDue(r.due_date, today);
    if (d != null && d > 0) { overdue += bal; overdueCount += 1; }
    const cell = aging[bucketKey(d)];
    cell.amount += bal; cell.count += 1;
  });
  return { outstanding, overdue, overdueCount, openCount: open.length, aging };
}

// ─── SECTION: Row-view builders (RPC row → list-row display + deep-link) ──────────────
// Each returns the small bundle a tab maps onto <AmListRow>. `href` is the frozen
// deep-link (F's href helper); `search` is a lowercased haystack for the search box.

export function arRowView(r, today = midnight()) {
  const bal = Number(r.balance || 0);
  const d = daysPastDue(r.due_date, today);
  let age = null;
  if (bal > 0.005) {
    if (d == null) age = null;
    else if (d > 0) age = `${d}d overdue`;
    else if (d === 0) age = 'Due today';
    else age = `Due in ${-d}d`;
  }
  const docNo = r.qbo_doc_number || r.invoice_number || '—';
  const claimJob = [r.claim_number, r.job_number].filter(Boolean).join(' · ');
  return {
    id: r.invoice_id,
    href: adminInvoiceHref(r.invoice_id),
    title: r.client_name || '—',
    docNo,
    detail: [docNo, claimJob, divLabel(r.division)].filter(Boolean).join(' · '),
    amount: fmt$2(r.balance),
    status: invoiceStatusKind(r, today),
    age,
    overdue: bal > 0.005 && d != null && d > 0,
    bucket: bal > 0.005 ? bucketKey(d) : null,
    search: `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.invoice_number || ''} ${r.qbo_doc_number || ''} ${r.division || ''}`.toLowerCase(),
  };
}

export function invoiceRowView(r, today = midnight()) {
  const docNo = r.qbo_doc_number || r.invoice_number || '—';
  const claimJob = [r.claim_number, r.job_number].filter(Boolean).join(' · ');
  return {
    id: r.invoice_id,
    href: adminInvoiceHref(r.invoice_id),
    title: r.client_name || '—',
    docNo,
    detail: [docNo, claimJob, divLabel(r.division)].filter(Boolean).join(' · '),
    amount: fmt$2(r.balance),
    total: fmt$2(r.total),
    status: invoiceStatusKind(r, today),
    search: `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.invoice_number || ''} ${r.qbo_doc_number || ''} ${r.division || ''}`.toLowerCase(),
  };
}

export function estimateRowView(r) {
  const docNo = r.qbo_doc_number || r.estimate_number || 'Draft';
  const claimJob = [r.claim_number, r.job_number].filter(Boolean).join(' · ');
  return {
    id: r.estimate_id,
    href: adminEstimateHref(r.estimate_id),
    title: r.client_name || '—',
    docNo,
    detail: [docNo, claimJob, divLabel(r.division)].filter(Boolean).join(' · '),
    amount: fmt$2(r.amount),
    status: estimateStatusKind(r),
    search: `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.estimate_number || ''} ${r.qbo_doc_number || ''} ${r.division || ''}`.toLowerCase(),
  };
}

export function paymentRowView(r) {
  const docNo = r.qbo_doc_number || r.invoice_number || null;
  const method = r.payment_method ? String(r.payment_method).replace(/_/g, ' ') : '';
  const claimJob = [r.claim_number, r.job_number].filter(Boolean).join(' · ');
  return {
    id: r.payment_id,
    // Payments deep-link into the invoice they cleared against (P3 route) when known.
    href: r.invoice_id ? adminInvoiceHref(r.invoice_id) : null,
    title: r.client_name || '—',
    date: fmtDate(r.payment_date),
    detail: [claimJob, docNo, method].filter(Boolean).join(' · '),
    amount: fmt$2(r.amount),
    synced: !!r.qbo_payment_id,
    syncError: !!r.qbo_sync_error,
    search: `${r.client_name || ''} ${r.claim_number || ''} ${r.job_number || ''} ${r.invoice_number || ''} ${r.qbo_doc_number || ''} ${r.reference_number || ''} ${r.division || ''}`.toLowerCase(),
  };
}

// Newest-created-first comparator (matches the desktop lists). Null dates sort last.
export const byCreatedDesc = (a, b) =>
  (b.created_at ? new Date(b.created_at).getTime() : 0) - (a.created_at ? new Date(a.created_at).getTime() : 0);
