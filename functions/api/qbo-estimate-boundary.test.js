/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves every validated legacy estimate action stops before configuration,
 *   company, estimate, or QuickBooks work while its durable command owner is
 *   not yet deployed.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: qbo-estimate.js
 *   Data: reads → mocked authentication only; writes → none
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ auth: null, db: null }));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboRequest: (...args) => h.auth(...args) }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));

import { onRequestPost } from './qbo-estimate.js';

const estimateId = '00000000-0000-4000-8000-000000000789';
const request = (body) => new Request('https://app.test/api/qbo-estimate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});

beforeEach(() => {
  h.auth = vi.fn(async () => ({ ok: true, employee: { id: 'employee-1' } }));
  h.db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), rpc: vi.fn() };
});

describe('qbo-estimate durable-boundary containment', () => {
  it.each([undefined, 'send', 'delete'])('refuses validated %s without configuration, connection, business, or provider work', async (action) => {
    const response = await onRequestPost({ request: request(JSON.stringify({ estimate_id: estimateId, ...(action ? { action } : {}) })), env: {} });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'qbo_estimate_durable_boundary_required',
      reason: 'qbo_estimate_durable_boundary_required',
    });
    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.db.update).not.toHaveBeenCalled();
    expect(h.db.upsert).not.toHaveBeenCalled();
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('keeps cheap body validation before the containment response', async () => {
    const response = await onRequestPost({ request: request('{'), env: {} });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Provide estimate_id' });
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('keeps authorization denial before the containment response', async () => {
    h.auth.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const response = await onRequestPost({ request: request(JSON.stringify({ estimate_id: estimateId })), env: {} });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(h.db.select).not.toHaveBeenCalled();
  });
});
