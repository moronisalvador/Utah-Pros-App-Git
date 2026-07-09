/**
 * ════════════════════════════════════════════════
 * FILE: collFormat.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the mobile Collections math and list-building is correct: the A/R
 *   aging buckets land money in the right age band (matching the desktop
 *   definitions), each list row is built with the right title / amount / status,
 *   and — most importantly — every row deep-links to the frozen admin-mobile
 *   route via the shared href helper (never a hardcoded path).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./collFormat.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  AGING_BUCKETS, bucketKey, summarizeAr, invoiceStatusKind,
  arRowView, invoiceRowView, estimateRowView, paymentRowView,
  periodBoundsISO, inPeriod, fmt$2,
  visibleCollectionsTabs, COLLECTIONS_TABS, PERIOD_TABS,
} from './collFormat.js';

// A fixed "today" so day-math is deterministic regardless of when the suite runs.
const TODAY = new Date('2026-07-07T00:00:00');

// Build an invoice N days past its due date (negative N = due in the future).
const inv = (id, daysOverdue, balance = 100, extra = {}) => {
  const due = new Date(TODAY); due.setDate(due.getDate() - daysOverdue);
  const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  return { invoice_id: id, balance, total: balance, due_date: iso, ...extra };
};

describe('bucketKey — reused desktop aging boundaries', () => {
  it('maps day-counts to the five desktop buckets at the exact boundaries', () => {
    expect(bucketKey(null)).toBe('current'); // no due date
    expect(bucketKey(-5)).toBe('current');   // not yet due
    expect(bucketKey(0)).toBe('current');    // due today
    expect(bucketKey(1)).toBe('b30');
    expect(bucketKey(30)).toBe('b30');
    expect(bucketKey(31)).toBe('b60');
    expect(bucketKey(60)).toBe('b60');
    expect(bucketKey(61)).toBe('b90');
    expect(bucketKey(90)).toBe('b90');
    expect(bucketKey(91)).toBe('b90p');
    expect(bucketKey(400)).toBe('b90p');
  });

  it('exposes the five desktop bucket keys in order', () => {
    expect(AGING_BUCKETS.map((b) => b.key)).toEqual(['current', 'b30', 'b60', 'b90', 'b90p']);
  });
});

describe('summarizeAr — outstanding / overdue / aging totals', () => {
  it('sums only open balances and files each into the right age band', () => {
    const rows = [
      inv('a', -3, 100),   // current (due in 3 days)
      inv('b', 10, 200),   // b30
      inv('c', 45, 300),   // b60
      inv('d', 120, 400),  // b90p
      inv('e', 20, 0),     // paid off — excluded from open/aging
    ];
    const k = summarizeAr(rows, TODAY);
    expect(k.outstanding).toBe(1000);          // 100+200+300+400 (paid excluded)
    expect(k.openCount).toBe(4);
    expect(k.overdue).toBe(900);               // b/c/d are past due
    expect(k.overdueCount).toBe(3);
    expect(k.aging.current.amount).toBe(100);
    expect(k.aging.b30.amount).toBe(200);
    expect(k.aging.b60.amount).toBe(300);
    expect(k.aging.b90p.amount).toBe(400);
    expect(k.aging.b90.amount).toBe(0);
  });

  it('returns all-zero totals for no rows', () => {
    const k = summarizeAr([], TODAY);
    expect(k.outstanding).toBe(0);
    expect(k.overdue).toBe(0);
    expect(k.openCount).toBe(0);
  });
});

describe('invoiceStatusKind — status word', () => {
  it('reads paid / overdue / partial', () => {
    expect(invoiceStatusKind({ total: 100, balance: 0 }, TODAY)).toBe('paid');
    expect(invoiceStatusKind(inv('x', 5, 100, { sent_at: '2026-06-01' }), TODAY)).toBe('overdue');
    expect(invoiceStatusKind({ total: 100, balance: 50, amount_paid: 50, qbo_invoice_id: 'q1' }, TODAY)).toBe('partial');
  });
  it('splits the lifecycle tier: draft → saved → sent', () => {
    // Not in QuickBooks yet → draft.
    expect(invoiceStatusKind({ total: 100, balance: 100 }, TODAY)).toBe('draft');
    // In QuickBooks, no status / status='saved' → saved (recorded, not emailed).
    expect(invoiceStatusKind({ total: 100, balance: 100, qbo_invoice_id: 'q1' }, TODAY)).toBe('saved');
    expect(invoiceStatusKind({ total: 100, balance: 100, qbo_invoice_id: 'q1', status: 'saved' }, TODAY)).toBe('saved');
    // In QuickBooks but edited since the last push (status reset to draft) → draft.
    expect(invoiceStatusKind({ total: 100, balance: 100, qbo_invoice_id: 'q1', status: 'draft' }, TODAY)).toBe('draft');
    // Emailed to the customer → sent.
    expect(invoiceStatusKind({ total: 100, balance: 100, qbo_invoice_id: 'q1', status: 'sent' }, TODAY)).toBe('sent');
  });
});

describe('row-view builders — list render + href deep-links', () => {
  it('arRowView: title, amount, overdue age, and invoice deep-link', () => {
    const v = arRowView(inv('inv-1', 10, 250, { client_name: 'Acme', qbo_doc_number: '1042', claim_number: 'C-9' }), TODAY);
    expect(v.title).toBe('Acme');
    expect(v.amount).toBe(fmt$2(250));
    expect(v.age).toBe('10d overdue');
    expect(v.overdue).toBe(true);
    expect(v.href).toBe('/tech/admin/invoice/inv-1'); // frozen route contract
    expect(v.detail).toContain('1042');
    expect(v.detail).toContain('C-9');
  });

  it('invoiceRowView: deep-links to the invoice detail route', () => {
    const v = invoiceRowView({ invoice_id: 'i77', client_name: 'Bob', balance: 40, total: 40 }, TODAY);
    expect(v.href).toBe('/tech/admin/invoice/i77');
    expect(v.title).toBe('Bob');
  });

  it('estimateRowView: deep-links to the estimate detail route + reads status', () => {
    const v = estimateRowView({ estimate_id: 'e12', client_name: 'Cara', amount: 999, qbo_estimate_id: 'qe1' });
    expect(v.href).toBe('/tech/admin/estimate/e12');
    expect(v.status).toBe('sent');
    expect(v.amount).toBe(fmt$2(999));
  });

  it('paymentRowView: links into the cleared invoice when known, else null', () => {
    expect(paymentRowView({ payment_id: 'p1', invoice_id: 'i9', amount: 75 }).href).toBe('/tech/admin/invoice/i9');
    expect(paymentRowView({ payment_id: 'p2', amount: 75 }).href).toBeNull();
  });
});

describe('visibleCollectionsTabs — financial gate (finding F-2)', () => {
  it('EXCLUDES the financial tabs (AR aging + Payments) when overview_financials is absent', () => {
    const vals = visibleCollectionsTabs(false).map((t) => t.value);
    expect(vals).toEqual(['invoices', 'estimates']); // fin tabs dropped → never mount → never fetch
    expect(vals).not.toContain('ar');
    expect(vals).not.toContain('payments');
  });

  it('INCLUDES all four tabs when overview_financials is granted', () => {
    expect(visibleCollectionsTabs(true).map((t) => t.value)).toEqual(['ar', 'invoices', 'estimates', 'payments']);
  });

  it('treats a non-true canFin as deny (must be strictly true)', () => {
    expect(visibleCollectionsTabs(undefined).map((t) => t.value)).toEqual(['invoices', 'estimates']);
    expect(visibleCollectionsTabs('yes').map((t) => t.value)).toEqual(['invoices', 'estimates']);
  });

  it('marks exactly AR aging + Payments as financial, and scopes the period switch to AR + Invoices', () => {
    expect(COLLECTIONS_TABS.filter((t) => t.fin).map((t) => t.value)).toEqual(['ar', 'payments']);
    expect(PERIOD_TABS).toEqual(['ar', 'invoices']);
  });
});

describe('period windows', () => {
  it('periodBoundsISO returns YYYY-MM-DD start/end strings', () => {
    const { p_start, p_end } = periodBoundsISO('mtd');
    expect(p_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('inPeriod: undated rows always pass; a far-past date fails a MTD window', () => {
    expect(inPeriod(null, 'mtd')).toBe(true);
    expect(inPeriod('2000-01-01', 'mtd')).toBe(false);
  });
});
