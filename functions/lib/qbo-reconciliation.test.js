/**
 * ════════════════════════════════════════════════
 * FILE: qbo-reconciliation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that accounting items needing a person are saved with a stable name
 *   and are closed only when that same item later has a clear result.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./qbo-reconciliation.js
 *   Data:      reads  → none
 *              writes → none (test doubles only)
 *
 * NOTES / GOTCHAS:
 *   - This is a local worker test; it makes no QuickBooks or Supabase calls.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import {
  reconcilePaymentResults,
  reconciliationEventId,
  reconciliationItem,
  recordReconciliation,
  resolveReconciliation,
} from './qbo-reconciliation.js';

describe('QBO manual reconciliation ledger', () => {
  it('normalizes only fail-closed manual reasons into deterministic synthetic event ids', () => {
    const item = reconciliationItem('Invoice', 'QB-9', { skipped: 'combined-invoice-manual-reconciliation' });
    expect(item).toEqual({ entity: 'Invoice', qboId: 'QB-9', reason: 'combined-invoice' });
    expect(reconciliationEventId(item)).toBe('reconcile:Invoice:QB-9');
    const unmapped = reconciliationItem('Invoice', '6086', {
      skipped: 'unmapped-qbo-invoice-manual-reconciliation',
    });
    expect(unmapped).toEqual({ entity: 'Invoice', qboId: '6086', reason: 'unmapped-qbo-invoice' });
    expect(reconciliationEventId(unmapped)).toBe('reconcile:Invoice:6086');
    expect(reconciliationItem('Estimate', 'E1', { skipped: 'already-converted' })).toBeNull();
  });

  it('upserts a bounded, non-PII durable marker and resolves the same synthetic id later', async () => {
    const db = { upsert: vi.fn(async () => []), update: vi.fn(async () => []) };
    const item = { entity: 'Estimate', qboId: '5812', reason: 'staff-decision-conflict' };

    await recordReconciliation(db, item);
    expect(db.upsert).toHaveBeenCalledWith('qbo_events', expect.objectContaining({
      id: 'reconcile:Estimate:5812', status: 'needs_reconciliation',
      error: 'reconciliation_required: staff-decision-conflict; Estimate=5812',
    }));

    await resolveReconciliation(db, 'Estimate', '5812');
    expect(db.update).toHaveBeenCalledWith('qbo_events', 'id=eq.reconcile:Estimate:5812', expect.objectContaining({
      status: 'processed', error: null,
    }));
  });

  it('allows a bounded internal conflict context without accepting arbitrary object data', async () => {
    const db = { upsert: vi.fn(async () => []) };
    await recordReconciliation(db, {
      entity: 'InvoiceLinkConflict', qboId: 'upr:i1:attempted:q1:current:q2', reason: 'qbo-invoice-mismatch',
      context: { upr_invoice_id: 'i1', attempted_qbo_invoice_id: 'q1', current_qbo_invoice_id: 'q2', ignored: null },
    });
    expect(db.upsert).toHaveBeenCalledWith('qbo_events', expect.objectContaining({
      error: 'reconciliation_required: qbo-invoice-mismatch; InvoiceLinkConflict=upr:i1:attempted:q1:current:q2; upr_invoice_id=i1; attempted_qbo_invoice_id=q1; current_qbo_invoice_id=q2',
    }));
  });

  it('scopes an unmapped invoice marker to its realm and payment until that same payment succeeds', async () => {
    const db = { upsert: vi.fn(async () => []), update: vi.fn(async () => []) };

    await reconcilePaymentResults(db, 'realm-1', 'payment-1', [{
      qboInvoiceId: '6086',
      skipped: 'unmapped-qbo-invoice-manual-reconciliation',
    }]);
    expect(db.upsert).toHaveBeenCalledWith('qbo_events', expect.objectContaining({
      id: 'reconcile:Payment:realm-1:payment-1',
      error: 'reconciliation_required: unmapped-qbo-invoice; Payment=realm-1:payment-1; qbo_invoice_id=6086',
    }));

    db.update.mockClear();
    await reconcilePaymentResults(db, 'realm-1', 'payment-2', [{ qboInvoiceId: '6086', recorded: true }]);
    expect(db.update).not.toHaveBeenCalledWith(
      'qbo_events',
      'id=eq.reconcile:Payment:realm-1:payment-1',
      expect.anything(),
    );

    await reconcilePaymentResults(db, 'realm-1', 'payment-1', [{ qboInvoiceId: '6086', recorded: true }]);
    expect(db.update).toHaveBeenCalledWith(
      'qbo_events',
      'id=eq.reconcile:Payment:realm-1:payment-1',
      expect.objectContaining({ status: 'processed', error: null }),
    );
  });
});
