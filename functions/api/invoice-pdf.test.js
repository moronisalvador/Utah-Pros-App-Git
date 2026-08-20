/**
 * ════════════════════════════════════════════════
 * FILE: invoice-pdf.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Actually builds an invoice PDF from a fake invoice and checks the result is
 *   a real document — including with the awkward text a customer might type,
 *   like an emoji or a line break, which used to crash a different PDF worker in
 *   production.
 *
 * DEPENDS ON:
 *   Packages:  vitest, pdf-lib (real, not mocked)
 *   Internal:  invoice-pdf.js with mocked auth/database/storage
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - pdf-lib is deliberately NOT mocked. The failure this guards against is
 *     inside pdf-lib's WinAnsi encoder, so a mock would prove nothing.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: null, rows: {}, uploaded: null }));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../lib/auth.js', () => ({ requireRole: vi.fn(async () => state.auth) }));
vi.mock('../lib/worker-runs.js', () => ({ recordWorkerRun: vi.fn(async () => {}) }));
vi.mock('../lib/supabase.js', () => ({
  supabase: vi.fn(() => ({
    select: vi.fn(async (table) => state.rows[table] ?? []),
    rpc: vi.fn(async () => ({ id: 'doc-1' })),
    uploadStorage: vi.fn(async (bucket, path, bytes, contentType) => {
      state.uploaded = { bucket, path, bytes, contentType };
      return true;
    }),
  })),
}));

import { requireRole } from '../lib/auth.js';
import { onRequestPost } from './invoice-pdf.js';

const request = (body = '{"invoice_id":"inv-1"}') => new Request('https://app.test/api/invoice-pdf', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});

const baseRows = () => ({
  invoices: [{
    id: 'inv-1', job_id: 'job-1', contact_id: 'contact-1',
    invoice_number: 'INV-000123', qbo_doc_number: 'W-2608-001',
    invoice_date: '2026-08-01', due_date: '2026-08-31',
    subtotal: 5000, tax: 182, total: 5182, adjusted_total: null, amount_paid: 0,
  }],
  invoice_line_items: [
    { id: 'l1', description: 'Water mitigation — 3 days', quantity: 1, unit_price: 4000, line_total: 4000, qbo_item_name: 'Mitigation' },
    { id: 'l2', description: 'Equipment', quantity: 6, unit_price: 166.67, line_total: 1000, qbo_item_name: null },
  ],
  payments: [],
  jobs: [{ id: 'job-1', job_number: 'W-2608-001', address: '123 Main St', city: 'Orem', state: 'UT', claim_id: 'claim-1', primary_contact_id: 'contact-1' }],
  contacts: [{ id: 'contact-1', name: 'Presidio Property Management', email: 'ap@presidiopm.example' }],
  claims: [{ id: 'claim-1', claim_number: 'CLM-99887', insurance_carrier: 'State Farm' }],
});

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { user: { id: 'u1' }, employee: { id: 'emp-1', role: 'admin' } };
  state.rows = baseRows();
  state.uploaded = null;
});

describe('authorization', () => {
  it('refuses an unauthenticated caller before reading anything', async () => {
    state.auth = { error: 'Missing Authorization header', status: 401 };
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(401);
    expect(state.uploaded).toBeNull();
  });

  it('gates on the billing roles', async () => {
    await onRequestPost({ request: request(), env: {} });
    expect(requireRole).toHaveBeenCalledWith(
      expect.any(Request), {}, expect.anything(),
      ['admin', 'office', 'project_manager'], expect.anything(),
    );
  });

  it('requires an invoice_id', async () => {
    const res = await onRequestPost({ request: request('{}'), env: {} });
    expect(res.status).toBe(400);
    expect(state.uploaded).toBeNull();
  });

  it('404s an unknown invoice without writing anything', async () => {
    state.rows.invoices = [];
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(404);
    expect(state.uploaded).toBeNull();
  });
});

describe('the document itself', () => {
  it('produces a real PDF and files it in the PRIVATE bucket', async () => {
    const res = await onRequestPost({ request: request(), env: {} });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.job_document_id).toBe('doc-1');

    // An invoice carries the claim number, policy number and loss address —
    // the public bucket would make holding the path the entire access control.
    expect(state.uploaded.bucket).toBe('job-documents-private');
    expect(state.uploaded.contentType).toBe('application/pdf');
    expect(state.uploaded.path).toMatch(/^job-1\/invoices\/invoice-W-2608-001-\d+\.pdf$/);

    // %PDF- magic: this is a document, not an error page. TextDecoder rather
    // than Buffer, which is not a Workers global.
    const head = new TextDecoder('latin1').decode(state.uploaded.bytes.slice(0, 5));
    expect(head).toBe('%PDF-');
    expect(state.uploaded.bytes.length).toBeGreaterThan(1000);
  });

  it('survives text WinAnsi cannot encode — the 2026-07-21 crash class', async () => {
    // A newline or an emoji in a customer-entered description used to throw
    // inside pdf-lib and kill the entire document. pdf-lib is NOT mocked here,
    // so this exercises the real encoder.
    state.rows.invoice_line_items = [{
      id: 'l1',
      description: 'Emergency response 🚨\nAfter-hours — “quoted” at ½ rate · 20°C',
      quantity: 1, unit_price: 5182, line_total: 5182, qbo_item_name: 'Mitigation ✅',
    }];
    state.rows.contacts = [{ id: 'contact-1', name: 'Ünïcodé Property Mgmt 🏢', email: 'ap@example.test' }];

    const res = await onRequestPost({ request: request(), env: {} });

    expect(res.status).toBe(200);
    expect(new TextDecoder('latin1').decode(state.uploaded.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('renders an invoice with no line items rather than failing', async () => {
    state.rows.invoice_line_items = [];
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);
    expect(state.uploaded.bytes.length).toBeGreaterThan(1000);
  });

  it('renders when there is no job, and then files no document', async () => {
    state.rows.invoices[0].job_id = null;
    state.rows.jobs = [];
    const res = await onRequestPost({ request: request(), env: {} });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ job_document_id: null });
    expect(state.uploaded.path).toMatch(/^unfiled\/invoices\//);
  });

  it('handles many lines by paginating instead of overflowing one page', async () => {
    state.rows.invoice_line_items = Array.from({ length: 60 }, (_, i) => ({
      id: `l${i}`, description: `Line item number ${i} with a reasonably long description`,
      quantity: i + 1, unit_price: 100 + i, line_total: (i + 1) * (100 + i), qbo_item_name: 'Mitigation',
    }));
    const res = await onRequestPost({ request: request(), env: {} });
    expect(res.status).toBe(200);

    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(state.uploaded.bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('never writes a trigger-owned money column', async () => {
    // The worker renders money; update_invoice_paid() owns it.
    const src = (await import('node:fs')).readFileSync(
      new URL('./invoice-pdf.js', import.meta.url), 'utf8',
    );
    expect(src).not.toMatch(/db\.update\(/);
    expect(src).not.toMatch(/amount_paid\s*:/);
  });
});
