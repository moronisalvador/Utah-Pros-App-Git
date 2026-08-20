/**
 * ════════════════════════════════════════════════
 * FILE: send-invoice.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that emailing a customer their invoice does the right things in the
 *   right order — real address, link created before the email, PDF attached,
 *   and an honest answer when delivery fails.
 *
 * DEPENDS ON:
 *   Packages:  vitest, pdf-lib (real — the attachment is genuinely built)
 *   Internal:  send-invoice.js with mocked auth/database/email
 *   Data:      reads  → none
 *              writes → none
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: null, rows: {}, rpcResult: null, updates: [] }));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../lib/auth.js', () => ({ requireRole: vi.fn(async () => state.auth) }));
vi.mock('../lib/worker-runs.js', () => ({ recordWorkerRun: vi.fn(async () => {}) }));
vi.mock('../lib/email.js', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 're_1' })) }));
vi.mock('../lib/supabase.js', () => ({
  supabase: vi.fn(() => ({
    select: vi.fn(async (table) => state.rows[table] ?? []),
    rpc: vi.fn(async (fn) => (fn === 'create_invoice_share' ? state.rpcResult : null)),
    update: vi.fn(async (table, filter, patch) => { state.updates.push({ table, filter, patch }); return null; }),
    uploadStorage: vi.fn(async () => true),
  })),
}));

import { sendEmail } from '../lib/email.js';
import { onRequestPost } from './send-invoice.js';

const TOKEN = '3f8a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const call = (payload = { invoice_id: 'inv-1' }) => onRequestPost({
  request: new Request('https://app.test/api/send-invoice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
  env: { APP_BASE_URL: 'https://utahpros.app' },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { user: { id: 'u1' }, employee: { id: 'emp-1', role: 'admin' } };
  state.updates = [];
  state.rpcResult = { id: 'share-1', token: TOKEN, expires_at: '2026-10-19T00:00:00Z' };
  state.rows = {
    invoices: [{
      id: 'inv-1', job_id: 'job-1', contact_id: 'c-1',
      invoice_number: 'INV-1', qbo_doc_number: 'W-2608-014',
      invoice_date: '2026-08-14', due_date: '2026-09-13',
      subtotal: 5000, tax: 182, total: 5182, adjusted_total: null, amount_paid: 1500,
    }],
    invoice_line_items: [{ id: 'l1', description: 'Mitigation', quantity: 1, unit_price: 5000, line_total: 5000 }],
    payments: [],
    jobs: [{ id: 'job-1', job_number: 'W-1', primary_contact_id: 'c-1' }],
    contacts: [{ id: 'c-1', name: 'Presidio Property Management', email: 'ap@presidiopm.example' }],
    claims: [],
  };
});

describe('who it will send to', () => {
  it('refuses a contact with no email', async () => {
    state.rows.contacts = [{ id: 'c-1', name: 'No Email Co', email: null }];
    const res = await call();
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses the @noemail.local placeholder rather than bouncing on it', async () => {
    // A bare truthiness check sails past this, delivery bounces on a fake TLD,
    // and sender reputation pays for it.
    state.rows.contacts = [{ id: 'c-1', name: 'Collected On Site', email: 'collect-1723.4@noemail.local' }];
    const res = await call();
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/placeholder/i) });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses an obviously malformed override', async () => {
    const res = await call({ invoice_id: 'inv-1', to: 'not-an-address' });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('lets staff redirect the bill to an adjuster without editing the contact', async () => {
    const res = await call({ invoice_id: 'inv-1', to: 'adjuster@carrier.example' });
    expect(res.status).toBe(200);
    expect(sendEmail.mock.calls[0][1].to).toBe('adjuster@carrier.example');
  });
});

describe('what it refuses to send', () => {
  it('refuses an invoice with nothing owing', async () => {
    state.rows.invoices[0].amount_paid = 5182;
    const res = await call();
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('404s an unknown invoice', async () => {
    state.rows.invoices = [];
    const res = await call();
    expect(res.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a silly expiry', async () => {
    for (const expires_days of [0, 400, -5]) {
      const res = await call({ invoice_id: 'inv-1', expires_days });
      expect(res.status, `expires_days ${expires_days}`).toBe(400);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('the email itself', () => {
  it('attaches a real PDF and links to the customer page', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true, delivered: true, pay_url: `https://utahpros.app/pay/${TOKEN}`,
    });

    const args = sendEmail.mock.calls[0][1];
    expect(args.subject).toMatch(/W-2608-014/);
    // Balance, not total: 5182 − 1500 = 3682.
    expect(args.subject).toMatch(/\$3,682\.00/);
    expect(args.html).toContain(`https://utahpros.app/pay/${TOKEN}`);

    expect(args.attachments).toHaveLength(1);
    expect(args.attachments[0].contentType).toBe('application/pdf');
    expect(args.attachments[0].filename).toBe('Invoice W-2608-014.pdf');
    // base64 of a real PDF starts with the encoded %PDF- magic.
    expect(args.attachments[0].content.startsWith('JVBERi')).toBe(true);
  });

  it('uses a content-derived idempotency key, never a timestamp', async () => {
    await call();
    expect(sendEmail.mock.calls[0][1].idempotencyKey).toBe('invoice-send-share-1');
  });

  it('escapes customer-supplied text into the HTML', async () => {
    state.rows.contacts = [{ id: 'c-1', name: '<script>alert(1)</script>', email: 'x@example.test' }];
    await call();
    const html = sendEmail.mock.calls[0][1].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('ordering and honesty', () => {
  it('creates the link BEFORE sending, so a failed email still leaves a usable URL', async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, error: 'Resend 429' });
    const res = await call();

    expect(res.status).toBe(502);
    const payload = await res.json();
    // Says exactly what happened rather than a flat failure.
    expect(payload).toMatchObject({ ok: false, delivered: false });
    expect(payload.pay_url).toBe(`https://utahpros.app/pay/${TOKEN}`);
  });

  it('stamps sent_at only on a delivery that actually succeeded', async () => {
    sendEmail.mockResolvedValueOnce({ ok: false, error: 'nope' });
    await call();
    expect(state.updates.filter((u) => u.table === 'invoice_shares')).toHaveLength(0);

    vi.clearAllMocks();
    state.updates = [];
    sendEmail.mockResolvedValueOnce({ ok: true, id: 're_2' });
    await call();
    const stamped = state.updates.find((u) => u.table === 'invoice_shares');
    expect(stamped?.patch?.sent_at).toBeTruthy();
  });
});

describe('authorization', () => {
  it('refuses an unauthenticated caller before anything else', async () => {
    state.auth = { error: 'Missing Authorization header', status: 401 };
    const res = await call();
    expect(res.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
