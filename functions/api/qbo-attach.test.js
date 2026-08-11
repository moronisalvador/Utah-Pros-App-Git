/**
 * ════════════════════════════════════════════════
 * FILE: qbo-attach.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES: proves legacy QBO attachment mutations are server-disabled
 * after authentication and request validation, before any local claim or QBO call.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, auth: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/auth.js', () => ({ requireRole: (...args) => h.auth(...args) }));

import { onRequestPost } from './qbo-attach.js';

const INVOICE = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT = '22222222-2222-4222-8222-222222222222';
const KEY = 'attaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const req = (body, key = KEY) => ({
  headers: { get: (name) => (name === 'Idempotency-Key' ? key : null) },
  json: async () => body,
});
const attachBody = {
  entity_type: 'invoice', id: INVOICE, file_name: 'scope.pdf',
  content_type: 'application/pdf', file_base64: btoa('hello'),
};

beforeEach(() => {
  h.auth = vi.fn(async () => ({ employee: { id: 'emp-1', is_external: false } }));
  h.db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
});

describe('qbo-attach durable-boundary containment', () => {
  it('rejects a validated upload before every local attachment side effect', async () => {
    const res = await onRequestPost({ request: req(attachBody), env: {} });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'qbo_attachment_durable_boundary_required',
      reason: 'qbo_attachment_durable_boundary_required',
    });
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.db.update).not.toHaveBeenCalled();
    expect(h.db.delete).not.toHaveBeenCalled();
  });

  it('rejects a validated delete before reading or removing attachment metadata', async () => {
    const res = await onRequestPost({ request: req({ action: 'delete', attachment_id: ATTACHMENT }), env: {} });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'qbo_attachment_durable_boundary_required' });
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.delete).not.toHaveBeenCalled();
  });

  it('keeps cheap request validation ahead of the disabled response', async () => {
    const res = await onRequestPost({ request: req({ ...attachBody, id: 'not-a-uuid' }), env: {} });
    expect(res.status).toBe(400);
    expect(h.db.select).not.toHaveBeenCalled();
  });
});
