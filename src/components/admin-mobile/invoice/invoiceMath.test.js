/**
 * ════════════════════════════════════════════════
 * FILE: invoiceMath.test.js  (Admin Mobile — balance calc tests)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the mobile screen computes "what's still owed" exactly like the
 *   desktop invoice page: the adjusted total wins when set, otherwise the
 *   stored total, otherwise the live sum of the line items — minus what's
 *   already been collected.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./invoiceMath
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { invoiceTotals, invoiceStatusKind } from './invoiceMath';

describe('invoiceTotals — balance = (adjusted_total ?? total) − amount_paid', () => {
  it('prefers adjusted_total when set', () => {
    const t = invoiceTotals({ adjusted_total: 900, total: 1000, amount_paid: 250 });
    expect(t).toEqual({ invoiced: 900, collected: 250, balance: 650 });
  });

  it('falls back to total when adjusted_total is null', () => {
    const t = invoiceTotals({ adjusted_total: null, total: 1000, amount_paid: 250 });
    expect(t.invoiced).toBe(1000);
    expect(t.balance).toBe(750);
  });

  it('falls back to the live line total (+tax) when both are null', () => {
    const lines = [{ line_total: 100 }, { line_total: 50.555 }];
    const t = invoiceTotals({ adjusted_total: null, total: null, amount_paid: 0, tax: 10 }, lines);
    expect(t.invoiced).toBe(160.56);
    expect(t.balance).toBe(160.56);
  });

  it('rounds to cents (no float drift)', () => {
    const t = invoiceTotals({ total: 0.3, amount_paid: 0.1 });
    expect(t.balance).toBe(0.2);
  });
});

describe('invoiceStatusKind', () => {
  const now = new Date('2026-07-07T12:00:00');
  const kind = (inv) => invoiceStatusKind(inv, invoiceTotals(inv), now);

  it('paid when balance ≤ half a cent', () => {
    expect(kind({ total: 100, amount_paid: 100, qbo_invoice_id: 'x' })).toBe('paid');
  });
  it('overdue when a balance remains past due_date', () => {
    expect(kind({ total: 100, amount_paid: 10, due_date: '2026-07-01', qbo_invoice_id: 'x' })).toBe('overdue');
  });
  it('draft when never sent/synced', () => {
    expect(kind({ total: 100, amount_paid: 0 })).toBe('draft');
  });
  it('partial when synced with some collected', () => {
    expect(kind({ total: 100, amount_paid: 40, qbo_invoice_id: 'x' })).toBe('partial');
  });
  it('sent when synced with nothing collected', () => {
    expect(kind({ total: 100, amount_paid: 0, qbo_invoice_id: 'x' })).toBe('sent');
  });
});
