/**
 * ════════════════════════════════════════════════
 * FILE: qbo-estimate-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves estimate actions fail closed while the strict durable-command
 *   capability is off, and enter the durable command path only after both
 *   gates permit it.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: qbo-estimate.js
 *   Data: reads → mocked authentication only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - The mocked database must remain untouched for every contained request.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ auth: null, db: null, providerTraffic: null, connection: null }));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboBrowserRequest: (...args) => h.auth(...args) }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => h.db }));
vi.mock('../lib/qbo-provider-traffic.js', () => ({
  requireQboProviderTraffic: (...args) => h.providerTraffic(...args),
  isQboProviderTrafficDisabled: () => true,
}));
vi.mock('../lib/quickbooks.js', () => ({ getConnection: (...args) => h.connection(...args) }));

import { onRequestPost } from './qbo-estimate.js';

const estimateId = '00000000-0000-4000-8000-000000000789';
const commandId = '00000000-0000-4000-8000-000000000456';
const request = (body) => new Request('https://app.test/api/qbo-estimate', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': commandId }, body,
});

beforeEach(() => {
  h.auth = vi.fn(async () => ({ ok: true, via: 'bearer', user: { id: 'user-1' }, employee: { id: 'employee-1' } }));
  h.db = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), rpc: vi.fn() };
  h.providerTraffic = vi.fn(async () => {});
  h.connection = vi.fn(async () => null);
});

describe('qbo-estimate durable-command boundary', () => {
  it.each([undefined, 'send', 'delete'])('fails closed for %s when the strict capability is absent, before provider traffic or command work', async (action) => {
    h.db.select.mockResolvedValue([]);
    const response = await onRequestPost({ request: request(JSON.stringify({ estimate_id: estimateId, ...(action ? { action } : {}) })), env: {} });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'qbo_document_command_v2_disabled',
    });
    expect(h.db.select).toHaveBeenCalledWith(
      'feature_flags',
      expect.stringContaining('feature%3Aqbo_document_command_v2'),
    );
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.db.update).not.toHaveBeenCalled();
    expect(h.db.upsert).not.toHaveBeenCalled();
    expect(h.db.rpc).not.toHaveBeenCalled();
    expect(h.providerTraffic).not.toHaveBeenCalled();
    expect(h.connection).not.toHaveBeenCalled();
  });

  it('uses a valid stable command UUID only after the strict flag and global provider gate permit it', async () => {
    h.db.select.mockResolvedValue([{ key: 'feature:qbo_document_command_v2', enabled: true, force_disabled: false }]);
    h.db.rpc.mockResolvedValue([]);
    const response = await onRequestPost({ request: request(JSON.stringify({ estimate_id: estimateId })), env: {} });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: 'qbo-connection-unavailable', retry_same_request: true });
    expect(h.providerTraffic).toHaveBeenCalledOnce();
    expect(h.db.rpc).toHaveBeenCalledWith('get_qbo_estimate_command', { p_command_id: commandId });
    expect(h.connection).toHaveBeenCalledOnce();
    expect(h.db.insert).not.toHaveBeenCalled();
    expect(h.db.update).not.toHaveBeenCalled();
    expect(h.db.upsert).not.toHaveBeenCalled();
  });

  it('keeps cheap body validation before either gate', async () => {
    const response = await onRequestPost({ request: request('{'), env: {} });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Provide estimate_id' });
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('keeps authorization denial before either gate', async () => {
    h.auth.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const response = await onRequestPost({ request: request(JSON.stringify({ estimate_id: estimateId })), env: {} });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(h.db.select).not.toHaveBeenCalled();
  });
});
