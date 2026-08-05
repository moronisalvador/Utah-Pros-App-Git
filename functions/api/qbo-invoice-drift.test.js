/**
 * ════════════════════════════════════════════════
 * FILE: functions/api/qbo-invoice-drift.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the invoice drift report refuses anyone without the billing role,
 *   refuses external collaborators, never writes to either system, and — the
 *   important one — does NOT report a false alarm for the normal case where one
 *   QuickBooks invoice is split across two UPR invoices.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-invoice-drift.js
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getConnection, qboFetch } from '../lib/quickbooks.js';
import { requireRole } from '../lib/auth.js';
import { supabase } from '../lib/supabase.js';
import { onRequestGet } from './qbo-invoice-drift.js';

vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(),
  qboFetch: vi.fn(),
}));
vi.mock('../lib/auth.js', () => ({ requireRole: vi.fn() }));
vi.mock('../lib/supabase.js', () => ({ supabase: vi.fn() }));
vi.mock('../lib/worker-runs.js', () => ({
  withRunRecording: vi.fn(async (_db, _name, fn) => fn()),
}));

const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' };
const req = () => new Request('https://x/api/qbo-invoice-drift', { method: 'GET' });

/** UPR rows + the QBO invoices they mirror. */
function wire({ rows, qboInvoices }) {
  const select = vi.fn(async () => rows);
  const insert = vi.fn();
  const update = vi.fn();
  supabase.mockReturnValue({ select, insert, update });
  getConnection.mockResolvedValue({ refresh_token: 'r' });
  qboFetch.mockResolvedValue({
    ok: true,
    headers: { get: () => null },
    json: async () => ({ QueryResponse: { Invoice: qboInvoices } }),
  });
  return { select, insert, update };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireRole.mockResolvedValue({ employee: { id: 'e1', role: 'admin', is_external: false } });
});

describe('qbo-invoice-drift authorization', () => {
  it('refuses a caller without the billing role', async () => {
    requireRole.mockResolvedValue({ error: 'Insufficient role', status: 403 });
    supabase.mockReturnValue({ select: vi.fn() });
    const res = await onRequestGet({ request: req(), env });
    expect(res.status).toBe(403);
    expect(qboFetch).not.toHaveBeenCalled();
  });

  it('refuses an external employee even with a billing role', async () => {
    requireRole.mockResolvedValue({ employee: { id: 'e2', role: 'admin', is_external: true } });
    supabase.mockReturnValue({ select: vi.fn() });
    const res = await onRequestGet({ request: req(), env });
    expect(res.status).toBe(403);
    expect(qboFetch).not.toHaveBeenCalled();
  });
});

describe('qbo-invoice-drift comparison', () => {
  it('does NOT flag one QBO invoice legitimately split across two UPR invoices', async () => {
    // The normal mitigation + reconstruction case. Row-by-row comparison would
    // report both as drifted; only the SUM is comparable.
    wire({
      rows: [
        { id: 'a', invoice_number: 'INV-1', qbo_invoice_id: '900', total: 2757.96, amount_paid: 2757.96, updated_at: null, qbo_synced_at: null },
        { id: 'b', invoice_number: 'INV-2', qbo_invoice_id: '900', total: 2517.20, amount_paid: 2517.20, updated_at: null, qbo_synced_at: null },
      ],
      qboInvoices: [{ Id: '900', DocNumber: '1222', TotalAmt: 5275.16, Balance: 0 }],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.ok).toBe(true);
    expect(body.drifted_count).toBe(0);
    expect(body.checked_qbo_invoices).toBe(1);
    expect(body.checked_upr_invoices).toBe(2);
  });

  it('flags a real total mismatch with a signed delta', async () => {
    wire({
      rows: [{ id: 'a', invoice_number: 'INV-3', qbo_invoice_id: '901', total: 6280.79, amount_paid: 0, updated_at: null, qbo_synced_at: null }],
      qboInvoices: [{ Id: '901', DocNumber: '1222', TotalAmt: 5275.16, Balance: 5275.16 }],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted_count).toBe(1);
    expect(body.drifted[0].kind).toBe('total_mismatch');
    expect(body.drifted[0].total_delta).toBe(1005.63);
  });

  it('flags a paid mismatch when totals agree', async () => {
    wire({
      rows: [{ id: 'a', invoice_number: 'INV-4', qbo_invoice_id: '902', total: 100, amount_paid: 75, updated_at: null, qbo_synced_at: null }],
      qboInvoices: [{ Id: '902', DocNumber: 'W-1', TotalAmt: 100, Balance: 0 }],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted_count).toBe(1);
    expect(body.drifted[0].kind).toBe('paid_mismatch');
    expect(body.drifted[0].paid_delta).toBe(-25);
  });

  it('reports an invoice UPR references but QuickBooks no longer has', async () => {
    wire({
      rows: [{ id: 'a', invoice_number: 'INV-5', qbo_invoice_id: '999', total: 10, amount_paid: 0, updated_at: null, qbo_synced_at: null }],
      qboInvoices: [],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted[0].kind).toBe('missing_in_quickbooks');
  });

  it('reports pending_push separately from drift when UPR is ahead of its last sync', async () => {
    // Totals agree, so this is NOT drift — it is an unsaved edit, the exact
    // condition that left two invoices un-synced for a day in Aug 2026.
    wire({
      rows: [{
        id: 'a', invoice_number: 'INV-6', qbo_doc_number: 'M-1', qbo_invoice_id: '903',
        total: 50, amount_paid: 0,
        qbo_synced_at: '2026-08-03T10:00:00Z', updated_at: '2026-08-04T10:00:00Z',
      }],
      qboInvoices: [{ Id: '903', DocNumber: 'M-1', TotalAmt: 50, Balance: 50 }],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted_count).toBe(0);
    expect(body.pending_push_count).toBe(1);
    expect(body.pending_push[0].invoice_number).toBe('INV-6');
  });

  it('never writes to the database', async () => {
    const { insert, update } = wire({
      rows: [{ id: 'a', invoice_number: 'INV-7', qbo_invoice_id: '904', total: 1, amount_paid: 0, updated_at: null, qbo_synced_at: null }],
      qboInvoices: [{ Id: '904', DocNumber: 'X', TotalAmt: 2, Balance: 2 }],
    });
    await onRequestGet({ request: req(), env });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // Read-only against QuickBooks too: only /query, never a POST.
    for (const call of qboFetch.mock.calls) {
      expect(call[1]).toMatch(/^\/query\?/);
      expect(call[2]?.method || 'GET').toBe('GET');
    }
  });
});
