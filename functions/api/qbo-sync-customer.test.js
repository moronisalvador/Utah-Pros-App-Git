/**
 * ════════════════════════════════════════════════
 * FILE: qbo-sync-customer.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves customer sync uses one durable QBO create request identity per
 *   contact/create stage and converges when another worker wins the contact link.
 *
 * DEPENDS ON:
 *   Packages: vitest
 *   Internal: qbo-sync-customer.js
 *   Data: reads/writes → mocked contacts only
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  contact: null,
  storedCustomerId: null,
  updates: [],
  creates: vi.fn(),
  find: vi.fn(),
  requestId: vi.fn(),
}));

vi.mock('../lib/quickbooks.js', () => ({
  getConnection: vi.fn(async () => ({ refresh_token: 'refresh', realm_id: 'realm-1' })),
  mapContactToCustomer: vi.fn((contact) => ({ DisplayName: contact.name })),
  findExistingCustomer: (...args) => state.find(...args),
  disambiguatedCustomerPayload: vi.fn((contact, payload) => ({ ...payload, DisplayName: `${payload.DisplayName} (0142)` })),
  createCustomer: (...args) => state.creates(...args),
  customerCreateRequestId: (...args) => state.requestId(...args),
}));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboRequest: vi.fn(async () => ({ ok: true })), QBO_ADMIN_ROLES: ['admin'] }));
vi.mock('../lib/cors.js', () => ({ handleOptions: vi.fn(), jsonResponse: vi.fn((body, status) => ({ body, status })) }));
vi.mock('../lib/worker-runs.js', () => ({ recordWorkerRun: vi.fn() }));
vi.mock('../lib/supabase.js', () => ({ supabase: () => ({
  select: vi.fn(async (_table, query) => query.includes('select=id,qbo_customer_id')
    ? (state.storedCustomerId ? [{ id: state.contact.id, qbo_customer_id: state.storedCustomerId }] : [])
    : [state.contact]),
  update: vi.fn(async (_table, filter, patch) => {
    state.updates.push({ filter, patch });
    if (state.storedCustomerId) return [];
    if (patch.qbo_customer_id) {
      state.storedCustomerId = patch.qbo_customer_id;
      return [{ id: state.contact.id, qbo_customer_id: patch.qbo_customer_id }];
    }
    return [{ id: state.contact.id }];
  }),
}) }));

const { onRequestPost } = await import('./qbo-sync-customer.js');

const contactId = '00000000-0000-4000-8000-000000000001';
function request() {
  return { headers: new Headers(), json: async () => ({ contact_id: contactId }) };
}

beforeEach(() => {
  state.contact = { id: contactId, name: 'Alex Customer', role: 'homeowner', phone: '801-555-0142', qbo_customer_id: null };
  state.storedCustomerId = null;
  state.updates.length = 0;
  state.creates.mockReset().mockResolvedValue({ Id: 'qbo-created' });
  state.find.mockReset().mockResolvedValue(null);
  state.requestId.mockReset().mockImplementation(async (_realm, _contact, stage) => `stable-${stage}`);
});

describe('qbo-sync-customer customer-create idempotency', () => {
  it('reuses the primary request identity on concurrent retries and converges to the stored winner', async () => {
    const first = await onRequestPost({ request: request(), env: {} });
    state.creates.mockImplementationOnce(async () => {
      state.storedCustomerId = 'qbo-concurrent-winner';
      return { Id: 'qbo-created' };
    });
    const second = await onRequestPost({ request: request(), env: {} });

    expect(first.body.results[0]).toMatchObject({ action: 'created', qbo_customer_id: 'qbo-created' });
    expect(second.body.results[0]).toMatchObject({ action: 'linked', matched_by: 'concurrent', qbo_customer_id: 'qbo-concurrent-winner' });
    expect(state.creates.mock.calls.map((call) => call[2].requestId)).toEqual(['stable-primary', 'stable-primary']);
    expect(state.updates.every(({ filter }) => filter.includes('qbo_customer_id=is.null'))).toBe(true);
  });

  it('uses a separate durable identity for the duplicate-name disambiguation create', async () => {
    const duplicate = Object.assign(new Error('Duplicate Name Exists Error'), { qboCode: '6240' });
    state.creates.mockRejectedValueOnce(duplicate).mockResolvedValueOnce({ Id: 'qbo-disambiguated' });

    const result = await onRequestPost({ request: request(), env: {} });

    expect(result.body.results[0]).toMatchObject({ action: 'created', qbo_customer_id: 'qbo-disambiguated' });
    expect(state.creates.mock.calls.map((call) => call[2].requestId)).toEqual(['stable-primary', 'stable-disambiguated']);
  });

  it('retries an ambiguous primary create with the same provider request identity', async () => {
    state.creates.mockRejectedValueOnce(new Error('QBO timeout')).mockResolvedValueOnce({ Id: 'qbo-created' });

    const first = await onRequestPost({ request: request(), env: {} });
    const retry = await onRequestPost({ request: request(), env: {} });

    expect(first.body.results[0].error).toBe('QBO timeout');
    expect(retry.body.results[0]).toMatchObject({ action: 'created', qbo_customer_id: 'qbo-created' });
    expect(state.creates.mock.calls.map((call) => call[2].requestId)).toEqual(['stable-primary', 'stable-primary']);
  });

  it('does not stamp an error after a late competing attempt has linked the contact', async () => {
    state.storedCustomerId = 'qbo-winner';
    state.creates.mockRejectedValueOnce(new Error('QBO timeout'));

    const result = await onRequestPost({ request: request(), env: {} });

    expect(result.body.results[0]).toEqual({
      id: contactId,
      name: 'Alex Customer',
      action: 'linked',
      matched_by: 'concurrent',
      qbo_customer_id: 'qbo-winner',
    });
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({ filter: expect.stringContaining('qbo_customer_id=is.null') });
    expect(state.updates[0].patch).toHaveProperty('qbo_sync_error');
  });
});
