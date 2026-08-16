/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment-delete-receipt.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the legacy payment-delete endpoint stays unavailable until it has a
 *   durable correction command. Valid delete requests stop before configuration,
 *   local payment rows, QuickBooks credentials, or provider calls.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-payment with local authorization/database/provider doubles
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Invalid identifiers still receive a 400 after authorization; a valid
 *     delete receives the stable 503 containment vocabulary.
 * ════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  getConnection: vi.fn(),
  createPayment: vi.fn(),
  requireTraffic: vi.fn(),
}));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../lib/qbo-auth.js', () => ({ authorizeQboRequest: mocks.authorize }));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({ select: mocks.select, update: mocks.update, insert: mocks.insert }),
}));
vi.mock('../lib/quickbooks.js', () => ({
  createPayment: mocks.createPayment,
  getConnection: mocks.getConnection,
}));
vi.mock('../lib/qbo-provider-traffic.js', () => ({
  requireQboProviderTraffic: mocks.requireTraffic,
  isQboProviderTrafficDisabled: (error) => error?.code === 'qbo_provider_traffic_disabled'
    && error?.reason === 'qbo_provider_traffic_disabled'
    && error?.status === 503,
}));

import { onRequestPost } from './qbo-payment.js';

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

function request(body, env = {}) {
  return {
    request: new Request('https://app.test/api/qbo-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.requireTraffic.mockResolvedValue(undefined);
});

describe('legacy QBO payment create connection boundary', () => {
  it.each(['qbo-realm-mismatch', 'qbo-connection-changed'])(
    'returns stable retry truth for %s without stamping a local sync error',
    async (code) => {
      mocks.getConnection.mockResolvedValue({ refresh_token: 'refresh', realm_id: 'realm-1' });
      mocks.select.mockImplementation(async (table) => {
        if (table === 'payments') {
          return [{
            id: PAYMENT_ID,
            invoice_id: '22222222-2222-4222-8222-222222222222',
            contact_id: '33333333-3333-4333-8333-333333333333',
            amount: 10,
          }];
        }
        if (table === 'invoices') {
          return [{ qbo_invoice_id: 'qbo-invoice-1', contact_id: '33333333-3333-4333-8333-333333333333' }];
        }
        if (table === 'contacts') return [{ qbo_customer_id: 'qbo-customer-1' }];
        return [];
      });
      mocks.createPayment.mockRejectedValue(Object.assign(new Error('private connection detail'), {
        code,
        status: 409,
      }));

      const response = await onRequestPost(request({ payment_id: PAYMENT_ID }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'QuickBooks connection changed before the payment was sent. Reload the invoice and review its customer and payment details before starting a new submission.',
        code,
        reason: code,
        retry_same_request: false,
      });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.insert).toHaveBeenCalledWith('worker_runs', expect.objectContaining({
        error_message: code,
      }));
    },
  );
});

describe('legacy QBO payment deletion containment', () => {
  it('authorizes before validating or refusing the mutation', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });

    const response = await onRequestPost(request({ action: 'delete', payment_id: PAYMENT_ID }));

    expect(response.status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it.each(['not-a-uuid', "11111111-1111-4111-8111-111111111111)';delete", '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid payment_id %j before database or QuickBooks work',
    async (paymentId) => {
      const response = await onRequestPost(request({ action: 'delete', payment_id: paymentId }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'payment_id must be a UUID' });
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.getConnection).not.toHaveBeenCalled();
      expect(mocks.createPayment).not.toHaveBeenCalled();
    },
  );

  it.each([`qbo-${'x'.repeat(256)}`, 'qbo-id\ninjected-header'])(
    'rejects unsafe provider payment id %j before database or QuickBooks work',
    async (qboPaymentId) => {
      const response = await onRequestPost(request({ action: 'delete', qbo_payment_id: qboPaymentId }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'qbo_payment_id is invalid' });
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.getConnection).not.toHaveBeenCalled();
      expect(mocks.createPayment).not.toHaveBeenCalled();
    },
  );

  it.each([
    { payment_id: PAYMENT_ID },
    { qbo_payment_id: "123'abc" },
    { payment_id: PAYMENT_ID, qbo_payment_id: 'qbo-1' },
  ])('returns a stable refusal for valid delete shape %# with zero local/provider work', async (body) => {
    const response = await onRequestPost(request({ action: 'delete', ...body }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'qbo_payment_delete_durable_boundary_required',
      reason: 'qbo_payment_delete_durable_boundary_required',
      error: 'Payment deletion is temporarily unavailable while its durable correction boundary is deployed.',
    });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });
});
