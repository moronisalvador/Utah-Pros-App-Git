/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment-delete-receipt.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the older payment-delete request unavailable until a durable
 *   correction process exists. It also proves normal payment creation keeps
 *   its existing connection, database, and QuickBooks behavior.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-payment with mocked authorization, database, and QuickBooks
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - A refused delete must not inspect configuration, payments, receipts, or
 *     QuickBooks: those reads can themselves create an unsafe escape hatch.
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
  isQboProviderTrafficDisabled: () => false,
}));
vi.mock('./qbo-document-command-gate.js', () => ({
  qboProviderTrafficDisabledRouteResponse: vi.fn(),
}));

import { onRequestPost } from './qbo-payment.js';

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

function request(body) {
  return {
    request: new Request('https://app.test/api/qbo-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    env: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.requireTraffic.mockResolvedValue();
  mocks.getConnection.mockResolvedValue({ refresh_token: 'present', realm_id: 'realm-1' });
  mocks.update.mockResolvedValue([]);
  mocks.insert.mockResolvedValue([]);
});

describe('legacy QBO payment deletion containment', () => {
  it('authenticates before refusing a delete request', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 });

    const response = await onRequestPost(request({ action: 'delete', payment_id: PAYMENT_ID }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.requireTraffic).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: 'delete', payment_id: 'not-a-uuid' }, { error: 'payment_id must be a UUID' }],
    [{ action: 'delete', qbo_payment_id: `qbo-${'x'.repeat(256)}` }, { error: 'qbo_payment_id is invalid' }],
    [{ action: 'delete', qbo_payment_id: 'qbo-id\ninjected-header' }, { error: 'qbo_payment_id is invalid' }],
  ])('keeps malformed delete input at 400 before all business work', async (body, expected) => {
    const response = await onRequestPost(request(body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expected);
    expect(mocks.requireTraffic).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it('refuses a valid delete without configuration, connection, database, or provider work', async () => {
    const response = await onRequestPost(request({ action: 'delete', payment_id: PAYMENT_ID, qbo_payment_id: 'qbo-1' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: 'qbo_payment_delete_durable_boundary_required',
      reason: 'qbo_payment_delete_durable_boundary_required',
    });
    expect(mocks.requireTraffic).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it('preserves the existing create path and its stable provider request id', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, invoice_id: 'invoice-1', amount: 42, payment_date: '2026-08-10' }])
      .mockResolvedValueOnce([{ qbo_invoice_id: 'qbo-invoice-1', contact_id: 'contact-1', invoice_number: 'INV-1' }])
      .mockResolvedValueOnce([{ qbo_customer_id: 'qbo-customer-1' }]);
    mocks.createPayment.mockResolvedValue({ Id: 'qbo-payment-1' });

    const response = await onRequestPost(request({ payment_id: PAYMENT_ID }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, qbo_payment_id: 'qbo-payment-1' });
    expect(mocks.requireTraffic).toHaveBeenCalledWith({});
    expect(mocks.getConnection).toHaveBeenCalledWith({});
    expect(mocks.createPayment).toHaveBeenCalledWith({}, expect.objectContaining({
      requestId: `uprp-${PAYMENT_ID}`,
    }));
    expect(mocks.update).toHaveBeenCalledWith('payments', `id=eq.${PAYMENT_ID}`, expect.objectContaining({
      qbo_payment_id: 'qbo-payment-1', qbo_realm_id: 'realm-1',
    }));
  });
});
