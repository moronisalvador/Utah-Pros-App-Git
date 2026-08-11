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
const workerRunErrors = vi.hoisted(() => []);
vi.mock('../lib/worker-runs.js', () => ({
  withRunRecording: vi.fn(async (_db, _name, fn) => {
    try { return await fn(); }
    catch (error) { workerRunErrors.push(error?.message || String(error)); throw error; }
  }),
}));

const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' };
const req = () => new Request('https://x/api/qbo-invoice-drift', { method: 'GET' });
let providerTraffic = [{ value: 'true' }];

/** UPR rows + the QBO invoices they mirror (+ optional line items). */
function wire({ rows, qboInvoices, lineItems = [] }) {
  const select = vi.fn(async (table) => (table === 'invoice_line_items' ? lineItems : rows));
  const insert = vi.fn();
  const update = vi.fn();
  supabase.mockReturnValue({
    select: (table, query) => table === 'integration_config' ? providerTraffic : select(table, query),
    insert,
    update,
  });
  getConnection.mockResolvedValue({ refresh_token: 'r', realm_id: 'realm-drift' });
  qboFetch.mockResolvedValue({
    ok: true,
    headers: { get: () => null },
    json: async () => ({ QueryResponse: { Invoice: qboInvoices } }),
  });
  return { select, insert, update };
}

beforeEach(() => {
  vi.clearAllMocks();
  workerRunErrors.length = 0;
  providerTraffic = [{ value: 'true' }];
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

  it('stops a closed provider gate before local reads or QuickBooks', async () => {
    const { select } = wire({ rows: [], qboInvoices: [] });
    providerTraffic = [];
    const res = await onRequestGet({ request: req(), env });
    expect(res.status).toBe(503);
    expect(select).not.toHaveBeenCalled();
    expect(qboFetch).not.toHaveBeenCalled();
  });

  it('returns the stable maintenance 503 when the gate closes immediately before a QBO read', async () => {
    wire({
      rows: [{ id: 'a', invoice_number: 'INV-maintenance', qbo_invoice_id: '900', total: 1, amount_paid: 0 }],
      qboInvoices: [],
    });
    qboFetch.mockRejectedValueOnce(Object.assign(
      new Error('QuickBooks provider traffic is temporarily disabled.'),
      { code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled', status: 503 },
    ));

    const res = await onRequestGet({ request: req(), env });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'qbo_provider_traffic_disabled', reason: 'qbo_provider_traffic_disabled',
    });
  });

  it('pins provider reads to the connection realm and never exposes an upstream fault', async () => {
    const privateDetail = 'QBO fault containing private invoice data';
    wire({
      rows: [{ id: 'a', invoice_number: 'INV-private', qbo_invoice_id: '901', total: 1, amount_paid: 0 }],
      qboInvoices: [],
    });
    qboFetch.mockRejectedValueOnce(Object.assign(new Error(privateDetail), {
      intuitTid: 'tid-drift-500',
    }));

    const res = await onRequestGet({ request: req(), env });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({
      error: 'QuickBooks invoice drift check could not be completed.',
      code: 'qbo_invoice_drift_failed',
      intuit_tid: 'tid-drift-500',
    });
    expect(JSON.stringify(body)).not.toContain(privateDetail);
    expect(workerRunErrors).toEqual(['QuickBooks invoice read is temporarily unavailable.']);
    expect(qboFetch).toHaveBeenCalledWith(
      env,
      expect.stringContaining('/query?'),
      expect.objectContaining({ method: 'GET', expectedRealmId: 'realm-drift' }),
    );
  });

  it('sanitizes a provider Fault before it can enter worker_runs', async () => {
    const privateDetail = 'Fault.Message holds an account-specific private detail';
    wire({ rows: [{ id: 'a', invoice_number: 'INV-fault', qbo_invoice_id: '902', total: 1, amount_paid: 0 }], qboInvoices: [] });
    qboFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => 'tid-drift-fault' },
      json: async () => ({ Fault: { Error: [{ Message: privateDetail }] } }),
    });

    const response = await onRequestGet({ request: req(), env });
    const body = await response.json();

    expect(body).toMatchObject({ code: 'qbo_invoice_drift_failed', intuit_tid: 'tid-drift-fault' });
    expect(JSON.stringify(body)).not.toContain(privateDetail);
    expect(workerRunErrors).toEqual(['QuickBooks rejected the invoice read.']);
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

  it('returns line descriptions IN FULL for drifted invoices, so an audit note is readable', async () => {
    // Regression guard for a real incident: a line carrying the note "...grouped onto
    // this reconstruction job during Q2-2026 reconciliation" was read truncated to 60
    // chars, and the deliberate re-attribution was "repaired" away. If the report
    // clips this field, the same mistake is available to the next reader.
    const note = 'Reconstruction charge from QBO invoice 1223 (item Reconstruction/ Remodeling Services), '
      + 'grouped onto this reconstruction job during Q2-2026 reconciliation.';
    wire({
      rows: [{ id: 'a', invoice_number: 'INV-8', qbo_invoice_id: '905', total: 3522.83, amount_paid: 0, updated_at: null, qbo_synced_at: null }],
      qboInvoices: [{ Id: '905', DocNumber: '1222', TotalAmt: 2517.20, Balance: 2517.20 }],
      lineItems: [
        { invoice_id: 'a', description: 'Scope of Work – Interior Repairs', quantity: 1, unit_price: 2517.20, sort_order: 0 },
        { invoice_id: 'a', description: note, quantity: 1, unit_price: 1005.63, sort_order: 1 },
      ],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted_count).toBe(1);
    const lines = body.drifted[0].upr_lines[0].lines;
    expect(lines).toHaveLength(2);
    // Verbatim and uncut — the reason for the disagreement must survive the report.
    expect(lines[1].description).toBe(note);
    expect(lines[1].description).toContain('grouped onto this reconstruction job');
  });

  it('does not fetch line items when nothing drifted', async () => {
    const { select } = wire({
      rows: [{ id: 'a', invoice_number: 'INV-9', qbo_invoice_id: '906', total: 10, amount_paid: 10, updated_at: null, qbo_synced_at: null }],
      qboInvoices: [{ Id: '906', DocNumber: 'X', TotalAmt: 10, Balance: 0 }],
    });
    await onRequestGet({ request: req(), env });
    expect(select.mock.calls.some((c) => c[0] === 'invoice_line_items')).toBe(false);
  });

  it('marks an exactly-cancelling pair on one customer as a suspected reallocation', async () => {
    // The Chris Smith shape: +1,005.63 on one invoice, -1,005.63 on another, same
    // customer. One line moved between jobs on purpose, not two defects. Must never
    // be presented as straightforwardly repairable.
    wire({
      rows: [
        { id: 'a', invoice_number: 'INV-A', qbo_invoice_id: '4274', contact_id: 'c419', total: 6280.79, amount_paid: 6280.79, updated_at: null, qbo_synced_at: null },
        { id: 'b', invoice_number: 'INV-B', qbo_invoice_id: '4275', contact_id: 'c419', total: 761.59, amount_paid: 761.59, updated_at: null, qbo_synced_at: null },
      ],
      qboInvoices: [
        { Id: '4274', DocNumber: '1222', TotalAmt: 5275.16, Balance: 0 },
        { Id: '4275', DocNumber: '1223', TotalAmt: 1767.22, Balance: 0 },
      ],
      lineItems: [],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted_count).toBe(2);
    for (const d of body.drifted) {
      expect(d.reallocation_suspected).toBe(true);
      expect(d.severity).toBe('informational');
    }
    expect(body.drifted.find((d) => d.qbo_invoice_id === '4274').cancels_with).toBe('4275');
  });

  it('does not treat cancelling deltas from DIFFERENT customers as a reallocation', async () => {
    wire({
      rows: [
        { id: 'a', invoice_number: 'INV-A', qbo_invoice_id: '10', contact_id: 'c1', total: 110, amount_paid: 0, updated_at: null, qbo_synced_at: null },
        { id: 'b', invoice_number: 'INV-B', qbo_invoice_id: '11', contact_id: 'c2', total: 90, amount_paid: 0, updated_at: null, qbo_synced_at: null },
      ],
      qboInvoices: [
        { Id: '10', DocNumber: 'A', TotalAmt: 100, Balance: 100 },
        { Id: '11', DocNumber: 'B', TotalAmt: 100, Balance: 100 },
      ],
      lineItems: [],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted.every((d) => !d.reallocation_suspected)).toBe(true);
  });

  it('flags external_edit from timestamps, NOT from LastModifiedByRef', async () => {
    // LastModifiedByRef names the Intuit user the OAuth connection is bound to, so a
    // Worker push and a human UI edit stamp the SAME id. Proven this session: an
    // invoice created by an API call carried the same id as a supposed human edit.
    // Only "QBO changed after our last push" is a valid discriminator.
    wire({
      rows: [{
        id: 'a', invoice_number: 'INV-X', qbo_invoice_id: '20', contact_id: 'c1',
        total: 100, amount_paid: 0,
        qbo_synced_at: '2026-08-03T15:26:00Z', updated_at: '2026-08-03T15:26:00Z',
      }],
      qboInvoices: [{
        Id: '20', DocNumber: 'R-1', TotalAmt: 120, Balance: 120,
        MetaData: { LastUpdatedTime: '2026-08-03T23:38:55Z', LastModifiedByRef: { value: '9341456427913786' } },
      }],
      lineItems: [],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted[0].external_edit).toBe(true);
    expect(body.drifted[0].severity).toBe('actionable');
    // Reported as context, never as the test.
    expect(body.drifted[0].qbo_last_modified_by).toBe('9341456427913786');
  });

  it('does not flag external_edit when QuickBooks is older than our last push', async () => {
    wire({
      rows: [{
        id: 'a', invoice_number: 'INV-Y', qbo_invoice_id: '21', contact_id: 'c1',
        total: 100, amount_paid: 0,
        qbo_synced_at: '2026-06-29T23:10:24Z', updated_at: '2026-06-29T23:10:24Z',
      }],
      qboInvoices: [{
        Id: '21', DocNumber: 'R-2', TotalAmt: 120, Balance: 120,
        MetaData: { LastUpdatedTime: '2026-04-28T20:49:48Z', LastModifiedByRef: { value: '9341456427913786' } },
      }],
      lineItems: [],
    });
    const body = await (await onRequestGet({ request: req(), env })).json();
    expect(body.drifted[0].external_edit).toBe(false);
    expect(body.drifted[0].severity).toBe('review');
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
