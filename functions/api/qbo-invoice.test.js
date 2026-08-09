/**
 * ════════════════════════════════════════════════
 * FILE: qbo-invoice.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the money amounts sent to QuickBooks are rounded to whole cents.
 *   QuickBooks rejects an invoice line whose Amount has more than two decimal
 *   places, and a quantity × unit-price math can produce a fraction of a cent
 *   (like $33.3333). These tests make sure both the per-line amount and the
 *   no-lines fallback amount come out as clean two-decimal dollars.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qbo-invoice.js (round2, qboLineAmount, qboFallbackAmount —
 *              the pure money-rounding helpers)
 *
 * NOTES / GOTCHAS:
 *   - round2 must match the round2 helper in
 *     src/components/admin-mobile/invoice/invoiceMath.js.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  qboSendPresentation,
  round2,
  qboLineAmount,
  qboFallbackAmount,
  qboInvoiceDateFields,
} from './qbo-invoice.js';

// A value has at most 2 decimal places (what QBO will accept).
const atMostTwoDecimals = (n) => {
  const dec = String(n).split('.')[1];
  return !dec || dec.length <= 2;
};

describe('qbo-invoice money rounding', () => {
  it('round2 snaps to cents, matching invoiceMath.round2', () => {
    expect(round2(100.005)).toBe(100.01);
    expect(round2(33.3333)).toBe(33.33);
    expect(round2(0.1 + 0.2)).toBe(0.3);      // 0.30000000000000004 → 0.3
    expect(round2(null)).toBe(0);
    expect(round2('19.999')).toBe(20);
  });

  it('qboLineAmount pushes a fractional-cent line_total as a 2-decimal Amount', () => {
    const amt = qboLineAmount({ line_total: 33.3333 });
    expect(amt).toBe(33.33);
    expect(atMostTwoDecimals(amt)).toBe(true);
  });

  it('qboLineAmount rounds a fractional qty × unit_price fallback (no line_total)', () => {
    // 3 × 11.111 = 33.333 — a sub-cent amount QBO would reject.
    const amt = qboLineAmount({ quantity: 3, unit_price: 11.111 });
    expect(amt).toBe(33.33);
    expect(atMostTwoDecimals(amt)).toBe(true);
  });

  it('qboLineAmount handles string values from PostgREST', () => {
    const amt = qboLineAmount({ line_total: '250.005' });
    expect(amt).toBe(250.01);
    expect(atMostTwoDecimals(amt)).toBe(true);
  });

  it('qboFallbackAmount rounds adjusted_total to 2 decimals', () => {
    const amt = qboFallbackAmount({ adjusted_total: 1499.999, total: 1000 });
    expect(amt).toBe(1500);
    expect(atMostTwoDecimals(amt)).toBe(true);
  });

  it('qboFallbackAmount falls back to total, then 0 — always 2-decimal', () => {
    expect(qboFallbackAmount({ adjusted_total: null, total: 42.005 })).toBe(42.01);
    expect(qboFallbackAmount({})).toBe(0);
  });
});

describe('qbo-invoice business dates', () => {
  it('sends the stored UPR invoice and due dates to QuickBooks', () => {
    expect(qboInvoiceDateFields({
      invoice_date: '2026-08-03',
      due_date: '2026-08-03',
    })).toEqual({
      TxnDate: '2026-08-03',
      DueDate: '2026-08-03',
    });
  });

  it('uses the invoice date as the due date when no separate due date exists', () => {
    expect(qboInvoiceDateFields({
      invoice_date: '2026-06-10T00:00:00.000Z',
    })).toEqual({
      TxnDate: '2026-06-10',
      DueDate: '2026-06-10',
    });
  });

  it('does not invent malformed provider dates', () => {
    expect(qboInvoiceDateFields({
      invoice_date: 'not-a-date',
      due_date: '',
    })).toEqual({});
  });
});

describe('qbo-invoice customer-facing presentation', () => {
  const DERIVED = 'Date of loss: 7/1/2026 · Job: W-2606-008 · Claim: CLM-1 · Service Address: 1 Main';

  it('keeps the derived memo when staff have written nothing', () => {
    const { customerMemo, billEmailCc } = qboSendPresentation({}, DERIVED);
    expect(customerMemo).toBe(DERIVED);
    expect(billEmailCc).toEqual({});
  });

  it('lets a staff-authored message replace what the customer reads', () => {
    const { customerMemo } = qboSendPresentation({ customer_message: 'Thanks for choosing us.' }, DERIVED);
    expect(customerMemo).toBe('Thanks for choosing us.');
  });

  it('treats a whitespace-only message as unwritten rather than blanking the memo', () => {
    expect(qboSendPresentation({ customer_message: '   ' }, DERIVED).customerMemo).toBe(DERIVED);
  });

  it('adds a CC only when one is set', () => {
    expect(qboSendPresentation({ send_cc_email: 'office@example.com' }, DERIVED).billEmailCc)
      .toEqual({ BillEmailCc: { Address: 'office@example.com' } });
    // An empty BillEmailCc would CLEAR a CC already on the QuickBooks customer.
    expect(qboSendPresentation({ send_cc_email: '   ' }, DERIVED).billEmailCc).toEqual({});
    expect(qboSendPresentation({ send_cc_email: null }, DERIVED).billEmailCc).toEqual({});
  });

  it('is deterministic, so a rebuilt intent still byte-matches a frozen attempt', () => {
    const inv = { customer_message: 'Hello', send_cc_email: 'a@b.com' };
    expect(JSON.stringify(qboSendPresentation(inv, DERIVED)))
      .toBe(JSON.stringify(qboSendPresentation({ ...inv }, DERIVED)));
  });
});
