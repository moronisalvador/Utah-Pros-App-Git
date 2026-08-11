/**
 * ════════════════════════════════════════════════
 * FILE: stripe-pay-link-maintenance.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES: proves the dormant Stripe pay-link endpoint authenticates,
 * cheaply validates its invoice identifier, then refuses before configuration,
 * local invoice work, or a Stripe provider call.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ auth: null, db: null }));
vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../lib/auth.js', () => ({ requireRole: vi.fn(async () => state.auth) }));
vi.mock('../lib/supabase.js', () => ({ supabase: vi.fn(() => state.db) }));

import { requireRole } from '../lib/auth.js';
import { fetchWithTimeout } from '../lib/http.js';
import { supabase } from '../lib/supabase.js';
import { onRequestPost } from './stripe-pay-link.js';

const request = (body) => new Request('https://app.test/api/stripe-pay-link', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { user: { id: 'user-1' }, employee: { role: 'admin' } };
  state.db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), rpc: vi.fn() };
});

describe('Stripe pay-link durable projection boundary', () => {
  it('rejects unauthenticated requests before parsing a malformed body', async () => {
    state.auth = { error: 'Missing Authorization header', status: 401 };

    const res = await onRequestPost({ request: request('{not-json'), env: {} });

    expect(res.status).toBe(401);
    expect(requireRole).toHaveBeenCalledTimes(1);
    for (const method of Object.values(state.db)) expect(method).not.toHaveBeenCalled();
  });

  it('validates invoice_id before the dormant-boundary refusal and all money work', async () => {
    const res = await onRequestPost({ request: request('{}'), env: {} });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Provide invoice_id' });
    for (const method of Object.values(state.db)) expect(method).not.toHaveBeenCalled();
  });

  it('returns the stable retryable refusal for an authorized valid request without local work', async () => {
    const res = await onRequestPost({ request: request('{"invoice_id":"invoice-1"}'), env: {} });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: 'stripe_projection_durable_boundary_required',
      reason: 'stripe_projection_durable_boundary_required',
    });
    expect(supabase).toHaveBeenCalledWith({}, fetchWithTimeout);
    expect(requireRole).toHaveBeenCalledWith(expect.any(Request), {}, state.db, ['admin', 'manager'], fetchWithTimeout);
    for (const method of Object.values(state.db)) expect(method).not.toHaveBeenCalled();
  });
});
