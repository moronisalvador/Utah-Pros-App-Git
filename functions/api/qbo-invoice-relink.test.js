/**
 * ════════════════════════════════════════════════
 * FILE: qbo-invoice-relink.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the invoice-save self-heal: when QuickBooks rejects the save because
 *   the stored customer id no longer exists there (a deleted/merged duplicate —
 *   the INV-000104 incident), the worker re-links the contact to the right
 *   QuickBooks customer and retries ONCE. It also proves the guardrails: no heal
 *   on other errors, no heal on the update path, no second retry, and an
 *   ambiguous match surfaces a clear manual-link error instead of guessing.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  functions/api/qbo-invoice.js (mocked lib/quickbooks, lib/supabase,
 *              lib/qbo-auth, lib/cors)
 *   Data:      reads → none · writes → none (all mocked)
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(() => new Response(null, { status: 204 })),
  jsonResponse: vi.fn((body, status) => ({ body, status })),
}));
vi.mock('../lib/qbo-auth.js', () => ({
  authorizeQboRequest: vi.fn(async () => ({ ok: true })),
}));

const mocks = vi.hoisted(() => ({
  createInvoice: vi.fn(),
  relinkQboCustomer: vi.fn(),
  updates: [],
}));

vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(async () => ({ refresh_token: 'r' })),
  divisionToQbo: vi.fn(() => ({ itemId: '1010000071', itemName: 'Water', className: null })),
  findClassId: vi.fn(async () => null),
  createInvoice: mocks.createInvoice,
  updateInvoice: vi.fn(async () => ({ Id: 'upd-1', DocNumber: 'W-1', TotalAmt: 100 })),
  deleteInvoice: vi.fn(),
  sendInvoice: vi.fn(),
  ensureQboCustomer: vi.fn(async () => true),
  relinkQboCustomer: mocks.relinkQboCustomer,
  // Real detection logic shape — the worker's branch condition under test.
  isStaleCustomerRef: (e) =>
    /invalid reference id/i.test(String(e?.message || '')) && /names element/i.test(String(e?.message || '')),
}));

const baseInvoice = {
  id: 'inv-1', job_id: 'job-1', contact_id: 'c-1', qbo_invoice_id: null,
  total: 100, adjusted_total: null, status: 'draft', sent_at: null, due_date: null,
  estimate_id: null, claim_number: null, qbo_doc_number: null,
};
let invoiceRow;

vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    select: async (table, q) => {
      if (table === 'invoices' && q.startsWith('id=eq.')) return [invoiceRow];
      if (table === 'invoices') return [{ id: 'inv-1', created_at: '2026-07-01' }];
      if (table === 'jobs') return [{ division: 'water', job_number: 'W-2607-002', claim_id: null, address: null, city: null, state: null, zip: null, date_of_loss: null }];
      if (table === 'contacts') return [{ qbo_customer_id: '583', name: 'Emily Bailey' }];
      if (table === 'invoice_line_items') return [];
      if (table === 'integration_config') return [];
      if (table === 'estimates') return [];
      return [];
    },
    update: async (table, q, patch) => { mocks.updates.push({ table, q, patch }); return null; },
    insert: async () => null,
  }),
}));

const { onRequestPost } = await import('./qbo-invoice.js');

const STALE = () => {
  const e = new Error('Invalid Reference Id — Invalid Reference Id : Names element id 583 not found');
  return e;
};
const req = () => ({
  url: 'https://dev.utahpros.app/api/qbo-invoice',
  json: async () => ({ invoice_id: 'inv-1' }),
  headers: new Headers(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  invoiceRow = { ...baseInvoice };
});

describe('qbo-invoice stale-customer self-heal', () => {
  it('relinks the contact and retries once on a stale CustomerRef, then succeeds', async () => {
    mocks.createInvoice
      .mockRejectedValueOnce(STALE())
      .mockResolvedValueOnce({ Id: 'qbo-9', DocNumber: 'W-2607-002', TotalAmt: 100 });
    mocks.relinkQboCustomer.mockResolvedValueOnce({ id: '121', matchedBy: 'email' });

    const res = await onRequestPost({ request: req(), env: {} });

    expect(res.status).toBe(200);
    expect(mocks.relinkQboCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.relinkQboCustomer).toHaveBeenCalledWith({}, expect.anything(), 'c-1');
    expect(mocks.createInvoice).toHaveBeenCalledTimes(2);
    // The retried payload must carry the relinked customer id, not the stale one.
    expect(mocks.createInvoice.mock.calls[1][1].CustomerRef.value).toBe('121');
    expect(res.body.customer_relink).toMatch(/re-linked automatically/);
  });

  it('does NOT heal on unrelated QBO errors', async () => {
    mocks.createInvoice.mockRejectedValueOnce(new Error('Amount has more precision than allowed'));
    const res = await onRequestPost({ request: req(), env: {} });
    expect(res.status).toBe(500);
    expect(mocks.relinkQboCustomer).not.toHaveBeenCalled();
    expect(mocks.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('retries only once — a second stale rejection surfaces as the error', async () => {
    mocks.createInvoice.mockRejectedValue(STALE());
    mocks.relinkQboCustomer.mockResolvedValueOnce({ id: '121', matchedBy: 'name' });
    const res = await onRequestPost({ request: req(), env: {} });
    expect(res.status).toBe(500);
    expect(mocks.relinkQboCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.createInvoice).toHaveBeenCalledTimes(2);
  });

  it('surfaces the ambiguous-match error without a retry', async () => {
    mocks.createInvoice.mockRejectedValueOnce(STALE());
    mocks.relinkQboCustomer.mockRejectedValueOnce(
      new Error('Multiple QuickBooks customers could match Emily Bailey: A (#1), B (#2) — open the contact and link the right one manually.'),
    );
    const res = await onRequestPost({ request: req(), env: {} });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/link the right one manually/);
    expect(mocks.createInvoice).toHaveBeenCalledTimes(1);
  });

  it('does not heal on the update path (updates do not send CustomerRef)', async () => {
    invoiceRow = { ...baseInvoice, qbo_invoice_id: 'qbo-1' };
    const { updateInvoice } = await import('../lib/quickbooks.js');
    updateInvoice.mockRejectedValueOnce(STALE());
    const res = await onRequestPost({ request: req(), env: {} });
    expect(res.status).toBe(500);
    expect(mocks.relinkQboCustomer).not.toHaveBeenCalled();
  });
});
