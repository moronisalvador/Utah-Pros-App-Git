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
import { round2, qboLineAmount, qboFallbackAmount } from './qbo-invoice.js';

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
