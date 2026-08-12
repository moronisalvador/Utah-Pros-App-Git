/**
 * ════════════════════════════════════════════════
 * FILE: estimateActions.test.js  (Admin Mobile — P4a helper tests)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves how the mobile estimate screen reads the result of turning an estimate
 *   into an invoice, especially the "that invoice already has lines, tap again to
 *   append" case. It also proves the friendly total and status shown on screen.
 *
 * HOW TO RUN:
 *   `npm test` (vitest) — pure functions, no DB or render.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./estimateActions.js
 *   Data:      reads → none · writes → none
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { interpretConvertResult, deriveEstimateView } from './estimateActions.js';

describe('interpretConvertResult — convert_estimate_to_invoice return handling', () => {
  it('flags needs_confirm and surfaces the existing line count (two-click append path)', () => {
    const r = interpretConvertResult({ needs_confirm: true, existing_line_count: 3 });
    expect(r).toEqual({ needsConfirm: true, existingLineCount: 3, invoiceId: null });
  });

  it('unwraps a 1-element array return and reads needs_confirm from it', () => {
    const r = interpretConvertResult([{ needs_confirm: true, existing_line_count: 2 }]);
    expect(r.needsConfirm).toBe(true);
    expect(r.existingLineCount).toBe(2);
  });

  it('returns the new invoice id on a successful convert', () => {
    expect(interpretConvertResult({ invoice_id: 'inv-9' })).toEqual({
      needsConfirm: false,
      existingLineCount: 0,
      invoiceId: 'inv-9',
    });
  });

  it('unwraps a 1-element array on the success path too', () => {
    expect(interpretConvertResult([{ invoice_id: 'inv-9' }]).invoiceId).toBe('inv-9');
  });

  it('is safe on an empty/null return (no invoice, no confirm)', () => {
    expect(interpretConvertResult(null)).toEqual({ needsConfirm: false, existingLineCount: 0, invoiceId: null });
    expect(interpretConvertResult([])).toEqual({ needsConfirm: false, existingLineCount: 0, invoiceId: null });
  });

  it('missing existing_line_count coerces to 0 rather than NaN', () => {
    expect(interpretConvertResult({ needs_confirm: true }).existingLineCount).toBe(0);
  });
});

describe('deriveEstimateView — status/total view-model', () => {
  it('a draft (not in QBO, not converted) reads Draft and sums line totals', () => {
    const v = deriveEstimateView({ estimate_number: 'E-100' }, [{ line_total: 100 }, { line_total: 50.5 }]);
    expect(v.statusLabel).toBe('Draft');
    expect(v.statusKind).toBe('neutral');
    expect(v.synced).toBe(false);
    expect(v.total).toBe(150.5);
    expect(v.docNumber).toBe('E-100');
  });

  it('synced-but-not-emailed reads Saved; emailed reads Sent (info)', () => {
    expect(deriveEstimateView({ qbo_estimate_id: 'q1' }).statusLabel).toBe('Saved');
    const sent = deriveEstimateView({ qbo_estimate_id: 'q1', qbo_emailed_at: '2026-07-07T00:00:00Z' });
    expect(sent.statusLabel).toBe('Sent');
    expect(sent.statusKind).toBe('info');
  });

  it('a converted estimate reads Converted (success) and prefers the QBO doc number', () => {
    const v = deriveEstimateView({ converted_invoice_id: 'inv-1', qbo_estimate_id: 'q1', qbo_doc_number: '1042' });
    expect(v.statusLabel).toBe('Converted');
    expect(v.statusKind).toBe('success');
    expect(v.converted).toBe(true);
    expect(v.docNumber).toBe('1042');
  });

  it('falls back to computing line totals from qty × unit_price when line_total is absent', () => {
    const v = deriveEstimateView({}, [{ quantity: 2, unit_price: 25 }]);
    expect(v.total).toBe(50);
  });
});
