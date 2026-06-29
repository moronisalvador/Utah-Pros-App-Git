/**
 * ════════════════════════════════════════════════
 * FILE: arSnapshot.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Turns the invoices currently shown on the A/R page into a small, tidy summary
 *   that the A/R Copilot (the chat bubble) can read. It adds up the money owed, the
 *   money past due, and the aging breakdown — exactly the numbers on the screen — so
 *   the AI never has to do the math itself. It also ranks who to chase first and
 *   lists the on-screen invoices in a slimmed-down form. The result is plain numbers,
 *   not formatted text; the chat worker turns them into the prompt.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (pure helper module)
 *   Rendered by:  used by src/components/collections/ARChatBubble.jsx
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./collTokens (daysPastDue, bucketKey, invoiceStatusKind)
 *   Data:      reads → none directly (operates on rows already loaded by ARDashboard)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The aggregates (outstanding / overdue / buckets) are computed from the OPEN
 *     period set (`rows`) so they equal the on-screen Outstanding / Overdue / aging
 *     figures. The per-invoice list comes from `filteredRows` (already filtered +
 *     sorted) so it matches exactly what the user is looking at, and is capped to
 *     keep the prompt small (default 60).
 *   - Aging boundaries come from collTokens (bucketKey / AGING_BUCKETS) — the same
 *     source ARDashboard uses — so the AI's buckets never drift from the screen.
 *   - Carries RAW numbers (rounded to cents), never formatted strings. Whoever shows
 *     them (the prompt) does the formatting.
 * ════════════════════════════════════════════════
 */

import { daysPastDue, bucketKey, invoiceStatusKind, AGING_BUCKETS } from './collTokens';

// ─── SECTION: Helpers ──────────────
const AGING_KEYS = AGING_BUCKETS.map((b) => b.key); // ['current','b30','b60','b90','b90p']
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const bal = (r) => Number(r.balance || 0);

// Days a row is past due (positive) or 0 when undated / not yet due — used for ranking.
function overdueDays(r, today) {
  const d = daysPastDue(r.due_date, today);
  return d != null && d > 0 ? d : 0;
}

// Collections priority: bigger balances and older debt rise to the top. ageWeight grows
// with months overdue and is capped so a very old tiny invoice can't outrank a large fresh
// one. Exported so the ranking is reusable/testable.
export function priorityScore(r, today) {
  const ageWeight = 1 + Math.min(overdueDays(r, today) / 30, 4); // 1 (current) … 5 (5+ months)
  return bal(r) * ageWeight;
}

// One slim invoice record for the prompt — just enough for the AI to reason and to drill
// down (contact_id → lookup_customer, id → get_invoice_detail).
function slim(r, today) {
  return {
    id: r.invoice_id,
    number: r.qbo_doc_number || r.invoice_number || null,
    client: r.client_name || null,
    claim: r.claim_number || null,
    contact_id: r.contact_id || null,
    balance: round2(r.balance),
    age_days: daysPastDue(r.due_date, today), // + overdue, 0 today, - future, null undated
    bucket: bucketKey(daysPastDue(r.due_date, today)),
    division: r.division || null,
    status: invoiceStatusKind(r, today),
    sync_error: !!r.qbo_sync_error,
  };
}

// ─── SECTION: Snapshot builder ──────────────
/**
 * Build the A/R snapshot the Copilot reads each turn.
 * @param {object} args
 * @param {Array}  args.rows         the OPEN period set (ARDashboard `k.open`) — drives totals/buckets
 * @param {Array}  args.filteredRows the on-screen rows (ARDashboard `sorted`) — drives the invoice list
 * @param {Date}   args.today        midnight today (ARDashboard `today`)
 * @param {object} args.viewState    { period, search, mode, filters, sort } — echoed for awareness
 * @param {object} [opts]            { maxInvoices = 60 }
 */
export function buildArSnapshot({ rows = [], filteredRows = [], today, viewState = {} }, opts = {}) {
  const maxInvoices = opts.maxInvoices ?? 60;
  const open = rows.filter((r) => bal(r) > 0.005);

  // Aggregates — mirror ARDashboard's `k` exactly.
  const buckets = {};
  AGING_KEYS.forEach((k) => { buckets[k] = { amount: 0, count: 0 }; });
  let total_outstanding = 0, total_overdue = 0, overdue_count = 0, qbo_error_count = 0;
  open.forEach((r) => {
    const b = bal(r);
    total_outstanding += b;
    const d = daysPastDue(r.due_date, today);
    if (d != null && d > 0) { total_overdue += b; overdue_count += 1; }
    if (r.qbo_sync_error) qbo_error_count += 1;
    const cell = buckets[bucketKey(d)];
    cell.amount += b; cell.count += 1;
  });
  AGING_KEYS.forEach((k) => { buckets[k].amount = round2(buckets[k].amount); });

  // Who to call first — top 10 of the open set by priority.
  const top_debtors = [...open]
    .sort((a, b) => priorityScore(b, today) - priorityScore(a, today))
    .slice(0, 10)
    .map((r) => {
      const s = slim(r, today);
      return { invoice_id: s.id, number: s.number, client: s.client, claim: s.claim,
        contact_id: s.contact_id, balance: s.balance, age_days: s.age_days,
        bucket: s.bucket, division: s.division, status: s.status, sync_error: s.sync_error };
    });

  // The on-screen invoice list (already filtered + sorted), capped.
  const invoices = filteredRows.slice(0, maxInvoices).map((r) => slim(r, today));

  return {
    generated_at: new Date().toISOString(),
    totals: {
      total_outstanding: round2(total_outstanding),
      open_count: open.length,
      total_overdue: round2(total_overdue),
      overdue_count,
      qbo_error_count,
    },
    buckets,
    top_debtors,
    invoices: {
      shown: invoices.length,
      total: filteredRows.length,
      truncated: filteredRows.length > invoices.length,
      list: invoices,
    },
    view_state: {
      period: viewState.period ?? null,
      search: viewState.search ?? '',
      mode: viewState.mode ?? null,
      bucket: viewState.bucket ?? null,
      filters: viewState.filters ?? null,
      sort: viewState.sort ?? null,
    },
  };
}
