import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, auth: null, upload: null, order: [] }));

vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/auth.js', () => ({ requireRole: (...args) => h.auth(...args) }));
vi.mock('../lib/worker-runs.js', () => ({ recordWorkerRun: async () => {} }));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: async () => ({ refresh_token: 'r' }),
  uploadAttachable: (...args) => h.upload(...args),
  deleteAttachable: async () => ({ deleted: true }),
}));

import { onRequestPost } from './qbo-attach.js';

const INVOICE = '11111111-1111-4111-8111-111111111111';
const KEY = 'attaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const req = (body, key = KEY) => ({
  headers: { get: (n) => (n === 'Idempotency-Key' ? key : null) },
  json: async () => body,
});

const attachBody = {
  entity_type: 'invoice', id: INVOICE,
  file_name: 'scope.pdf', content_type: 'application/pdf',
  file_base64: btoa('hello'),
};

beforeEach(() => {
  h.order = [];
  h.auth = vi.fn(async () => ({ employee: { id: 'emp-1' } }));
  h.upload = vi.fn(async () => { h.order.push('upload'); return { Id: '99' }; });
  h.db = {
    // no prior attachment; the invoice exists and is synced to QBO
    select: vi.fn(async (table) => (table === 'qbo_attachments' ? [] : [{ id: INVOICE, qbo_invoice_id: '5' }])),
    insert: vi.fn(async () => { h.order.push('claim'); return [{ id: 'row-1' }]; }),
    update: vi.fn(async () => [{ id: 'row-1', qbo_attachable_id: '99' }]),
    delete: vi.fn(async () => { h.order.push('release'); return null; }),
  };
});

describe('qbo-attach idempotency claim', () => {
  it('claims the key BEFORE uploading to QuickBooks', async () => {
    const res = await onRequestPost({ request: req(attachBody), env: {} });
    expect(res.status).toBe(200);
    // The atomic gate must precede the external side effect.
    expect(h.order).toEqual(['claim', 'upload']);
    expect(h.db.insert).toHaveBeenCalledWith('qbo_attachments', expect.objectContaining({
      idempotency_key: KEY,
      qbo_attachable_id: `pending:${KEY}`,
    }));
    // Real id swapped in after QBO returns.
    expect(h.db.update).toHaveBeenCalledWith('qbo_attachments', 'id=eq.row-1', { qbo_attachable_id: '99' });
  });

  it('returns the existing attachment without re-uploading (completed retry)', async () => {
    h.db.select = vi.fn(async (table) => (table === 'qbo_attachments'
      ? [{ id: 'row-1', qbo_attachable_id: '99', idempotency_key: KEY }]
      : [{ id: INVOICE, qbo_invoice_id: '5' }]));

    const res = await onRequestPost({ request: req(attachBody), env: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, idempotent: true, qbo_attachable_id: '99' });
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('does not upload twice when it loses the claim race', async () => {
    let seen = 0;
    h.db.insert = vi.fn(async () => { throw new Error('duplicate key value violates unique constraint'); });
    h.db.select = vi.fn(async (table) => {
      if (table !== 'qbo_attachments') return [{ id: INVOICE, qbo_invoice_id: '5' }];
      // first (fast-path) lookup finds nothing; after the failed claim the winner's row exists
      seen += 1;
      return seen === 1 ? [] : [{ id: 'row-1', qbo_attachable_id: '99', idempotency_key: KEY }];
    });

    const res = await onRequestPost({ request: req(attachBody), env: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ idempotent: true });
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('releases the claim when QuickBooks rejects the upload, so a retry can proceed', async () => {
    h.upload = vi.fn(async () => { h.order.push('upload'); throw new Error('QBO attach failed (400)'); });

    const res = await onRequestPost({ request: req(attachBody), env: {} });
    expect(res.status).toBe(500);
    expect(h.order).toEqual(['claim', 'upload', 'release']);
    expect(h.db.delete).toHaveBeenCalledWith('qbo_attachments', 'id=eq.row-1');
  });

  it('rejects a missing or malformed Idempotency-Key', async () => {
    const res = await onRequestPost({ request: req(attachBody, 'short'), env: {} });
    expect(res.status).toBe(400);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('refuses to attach before the invoice is synced to QuickBooks', async () => {
    h.db.select = vi.fn(async (table) => (table === 'qbo_attachments' ? [] : [{ id: INVOICE, qbo_invoice_id: null }]));
    const res = await onRequestPost({ request: req(attachBody), env: {} });
    expect(res.status).toBe(409);
    expect(h.upload).not.toHaveBeenCalled();
  });
});
