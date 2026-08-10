/**
 * ════════════════════════════════════════════════
 * FILE: invoiceLineEdit.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   The native invoice-line editor writes only editable source fields, never
 *   generated totals, and reaches QuickBooks only through the idempotent human
 *   save helper carrying the safe patch to the service-only atomic boundary.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildInvoiceLineUpdate,
  invoiceLineAmount,
  invoiceLineValidationError,
} from './invoiceLineEdit';

describe('invoice line edit contract', () => {
  it('builds the exact safe-column update and omits generated/parent fields', () => {
    const update = buildInvoiceLineUpdate({
      id: 'line-1',
      invoice_id: 'invoice-1',
      description: 'Drywall repair',
      qbo_item_id: '42',
      qbo_item_name: 'Labor',
      qbo_class_id: '',
      qbo_class_name: '',
      quantity: '2.5',
      unit_price: '125.40',
      line_total: 313.5,
      status: 'paid',
    });

    expect(update).toEqual({
      description: 'Drywall repair',
      qbo_item_id: '42',
      qbo_item_name: 'Labor',
      qbo_class_id: null,
      qbo_class_name: null,
      quantity: 2.5,
      unit_price: 125.4,
    });
    expect(update).not.toHaveProperty('line_total');
    expect(update).not.toHaveProperty('invoice_id');
    expect(update).not.toHaveProperty('status');
  });

  it('keeps finite negative adjustments valid and rejects non-numeric amounts', () => {
    expect(invoiceLineValidationError({ quantity: 1, unit_price: -25 })).toBe('');
    expect(invoiceLineValidationError({ quantity: 'not-a-number', unit_price: 25 }))
      .toBe('Enter a valid quantity.');
    expect(invoiceLineValidationError({ quantity: 1, unit_price: 'not-a-number' }))
      .toBe('Enter a valid rate.');
    expect(invoiceLineAmount({ quantity: 2.5, unit_price: 10.125 })).toBe(25.31);
  });

  it('uses one idempotent human QBO helper with a safe line patch and no browser line RPC', () => {
    const source = readFileSync(new URL('../../../pages/tech/admin/AdminInvoiceLineEdit.jsx', import.meta.url), 'utf8');
    expect(source).toContain("import { callQboInvoiceWorker } from '@/lib/qboInvoiceWorker';");
    expect(source).toMatch(/const authHeaders = await getAuthHeader\(\);[\s\S]*if \(!isCurrentRoute\(\)\) return;[\s\S]*callQboInvoiceWorker\(\{[\s\S]*ownerId: user\?\.id,[\s\S]*authHeaders,[\s\S]*line_update: \{ line_id: line\.id, \.\.\.update \}/);
    expect(source.match(/callQboInvoiceWorker\(/g)).toHaveLength(1);
    expect(source).not.toContain("dbRef.current.rpc('");
    expect(source).not.toContain("update('invoice_line_items'");
    expect(source).not.toContain("update('invoices'");
    expect(source).not.toContain("fetch('/api/qbo-invoice'");
    expect(source).not.toContain('Date.now');
  });
});
