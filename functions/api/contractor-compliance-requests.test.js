/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-requests.test.js
 * ════════════════════════════════════════════════
 * WHAT THIS DOES (plain language): Checks staff request actions use the safe server boundary.
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: contractor-compliance-requests.js
 *   Data: reads → mocked requests; writes → none
 * NOTES / GOTCHAS: All database calls are mocked.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null, auth: null, supabase: null, deliver: null }));
vi.mock('../lib/supabase.js', () => ({ supabase: (...args) => h.supabase(...args) }));
vi.mock('../lib/auth.js', () => ({ requireRole: (...args) => h.auth(...args) }));
vi.mock('../lib/contractor-compliance-delivery.js', () => ({ deliverClaimedComplianceRequest: (...args) => h.deliver(...args) }));
import { onRequestPost } from './contractor-compliance-requests.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ENV = { CONTRACTOR_COMPLIANCE_ENABLED: 'true' };
function request(body) { return { json: async () => body, headers: new Headers() }; }

beforeEach(() => {
  h.auth = vi.fn(async () => ({ employee: { id: ID, role: 'office' } }));
  h.db = { rpc: vi.fn(async () => null) };
  h.supabase = vi.fn(() => h.db);
  h.deliver = vi.fn(async () => ({ outcome: 'sent', recordsProcessed: 1 }));
});

describe('contractor compliance request actions', () => {
  it('rejects an unauthorized role before any mutation or delivery call', async () => {
    h.auth.mockResolvedValueOnce({ error: 'Insufficient role', status: 403 });
    const res = await onRequestPost({ request: request({ action: 'revoke', request_id: ID }), env: ENV });
    expect(res.status).toBe(403);
    expect(h.db.rpc).not.toHaveBeenCalled();
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it.each(['pause', 'resume', 'revoke'])('sends %s only through the request state RPC', async (action) => {
    const res = await onRequestPost({ request: request({ action, request_id: ID, reason: 'operator action' }), env: ENV });
    expect(res.status).toBe(200);
    expect(h.db.rpc).toHaveBeenCalledWith('contractor_compliance_mutate_request', expect.objectContaining({ p_action: action }));
  });

  it.each(['pause_reminders', 'resume_reminders'])('keeps %s distinct from link state', async (action) => {
    const res = await onRequestPost({ request: request({ action, contractor_id: ID, reason: 'operator action' }), env: ENV });
    expect(res.status).toBe(200);
    expect(h.db.rpc).toHaveBeenCalledWith('contractor_compliance_mutate_profile_requests', expect.objectContaining({ p_action: action }));
  });

  it('does not create a sendable request while the dedicated email gate is off', async () => {
    const res = await onRequestPost({ request: request({ action: 'create', contractor_id: ID, operation_id: ID, document_types: ['w9'], send_now: true }), env: ENV });
    expect(res.status).toBe(409);
    expect(h.db.rpc).not.toHaveBeenCalled();
  });

  it('claims manual send-now with the frozen two-argument RPC shape', async () => {
    h.db.rpc.mockImplementation(async (name) => {
      if (name === 'contractor_compliance_create_request') return [{ request_id: ID }];
      if (name === 'contractor_compliance_claim_delivery') return [{ delivery_id: ID, contact_id: ID, provider_idempotency_key: 'stable' }];
      return null;
    });
    const res = await onRequestPost({
      request: request({ action: 'create', contractor_id: ID, operation_id: ID, document_types: ['w9'], send_now: true }),
      env: { ...ENV, CONTRACTOR_COMPLIANCE_REMINDERS_ENABLED: 'true', CONTRACTOR_COMPLIANCE_TOKEN_SECRET: 's'.repeat(32) },
    });
    expect(res.status).toBe(201);
    expect(h.db.rpc).toHaveBeenCalledWith('contractor_compliance_claim_delivery', {
      p_request_id: ID,
      p_stage: 'manual_initial',
    });
  });

  it('requires an audited reason to change contractor active state', async () => {
    const denied = await onRequestPost({ request: request({ action: 'set_active', contractor_id: ID, is_active: false }), env: ENV });
    expect(denied.status).toBe(400);
    const allowed = await onRequestPost({ request: request({ action: 'set_active', contractor_id: ID, is_active: false, reason: 'No longer subcontracting' }), env: ENV });
    expect(allowed.status).toBe(200);
    expect(h.db.rpc).toHaveBeenCalledWith('contractor_compliance_set_profile_active', expect.objectContaining({ p_is_active: false }));
  });
});
