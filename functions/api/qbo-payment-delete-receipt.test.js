/**
 * ════════════════════════════════════════════════
 * FILE: qbo-payment-delete-receipt.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Prevents the older one-invoice payment route from deleting an entire
 *   QuickBooks receipt when someone selected only one of its invoice rows.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-payment with mocked authorization, database, and QuickBooks
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Grouped and provider-recorded corrections belong in QuickBooks.
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
  deletePayment: vi.fn(),
}));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (body, status) => new Response(JSON.stringify(body), { status }),
}));
vi.mock('../lib/qbo-auth.js', () => ({
  authorizeQboRequest: mocks.authorize,
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    select: mocks.select,
    update: mocks.update,
    insert: mocks.insert,
  }),
}));
vi.mock('../lib/quickbooks.js', () => ({
  createPayment: mocks.createPayment,
  deletePayment: mocks.deletePayment,
  getConnection: mocks.getConnection,
}));

import { onRequestPost } from './qbo-payment.js';

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

function request(paymentId = PAYMENT_ID, env = {}) {
  return {
    request: new Request('https://app.test/api/qbo-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', payment_id: paymentId }),
    }),
    env,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true });
  mocks.getConnection.mockResolvedValue({ refresh_token: 'present' });
  mocks.update.mockResolvedValue([]);
  mocks.insert.mockResolvedValue([]);
});

describe('legacy QBO payment deletion containment', () => {
  it.each(['not-a-uuid', "11111111-1111-4111-8111-111111111111)';delete", '00000000-0000-0000-0000-000000000000'])(
    'rejects invalid payment_id %j before database or QuickBooks work',
    async (paymentId) => {
      const response = await onRequestPost(request(paymentId));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'payment_id must be a UUID' });
      expect(mocks.authorize).toHaveBeenCalledWith(
        expect.any(Request), {}, expect.any(Object), expect.any(Function),
      );
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.getConnection).not.toHaveBeenCalled();
      expect(mocks.deletePayment).not.toHaveBeenCalled();
    },
  );

  it('encodes a bounded non-UUID provider payment id instead of treating it as a UUID', async () => {
    const qboPaymentId = "123'abc";
    mocks.select
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await onRequestPost({
      request: new Request('https://app.test/api/qbo-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', qbo_payment_id: qboPaymentId }),
      }),
      env: {},
    });

    expect(response.status).toBe(200);
    expect(mocks.select).toHaveBeenNthCalledWith(1, 'payments', 'qbo_payment_id=eq.123%27abc&limit=3');
    expect(mocks.deletePayment).toHaveBeenCalledWith({}, qboPaymentId);
  });

  it.each([
    `qbo-${'x'.repeat(256)}`,
    'qbo-id\ninjected-header',
  ])('rejects unsafe provider payment id %j before database or QuickBooks work', async (qboPaymentId) => {
    const response = await onRequestPost({
      request: new Request('https://app.test/api/qbo-payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', qbo_payment_id: qboPaymentId }),
      }), env: {},
    });

    expect(response.status).toBe(400);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('rejects a receipt-linked allocation without calling QuickBooks', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: 'receipt-1', source: 'upr' }])
      .mockResolvedValueOnce([{ id: PAYMENT_ID, receipt_id: 'receipt-1', source: 'upr' }]);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('rejects a durable receipt header even after its active projections were removed', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'feature:qbo_receive_payment' }])
      .mockResolvedValueOnce([{ id: 'receipt-1' }]);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.select).toHaveBeenLastCalledWith(
      'payment_receipts',
      expect.stringContaining('qbo_payment_id=eq.qbo-1'),
    );
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('protects a durable receipt header even when receive-payment creation is disabled', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'feature:qbo_receive_payment' }])
      .mockResolvedValueOnce([{ id: 'receipt-1' }]);
    const response = await onRequestPost(request(PAYMENT_ID, {
      QBO_RECEIVE_PAYMENT_ENABLED: 'false',
    }));
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('fails closed when the durable receipt-header safety query cannot run', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'feature:qbo_receive_payment' }])
      .mockRejectedValueOnce(new Error('payment_receipts is unavailable'));
    const response = await onRequestPost(request());
    expect(response.status).toBe(503);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('rejects a legacy QBO id shared by more than one invoice row', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([
        { id: PAYMENT_ID, receipt_id: null, source: 'manual' },
        { id: 'payment-row-2', receipt_id: null, source: 'manual' },
      ]);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it.each(['qbo', 'stripe'])('rejects a single %s-provider row', async (source) => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: null, source }])
      .mockResolvedValueOnce([{ id: PAYMENT_ID, receipt_id: null, source }]);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('preserves the existing single manual-payment delete path', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([{ id: PAYMENT_ID, receipt_id: null, source: 'manual' }]);
    mocks.deletePayment.mockResolvedValue({ ok: true });
    const response = await onRequestPost(request());
    expect(response.status).toBe(200);
    expect(mocks.deletePayment).toHaveBeenCalledWith({}, 'qbo-1');
    expect(mocks.update).toHaveBeenCalledWith('payments', `id=eq.${PAYMENT_ID}`, {
      qbo_payment_id: null,
      // Cleared with the id (20260808070000): a realm labels a QBO payment
      // number, so it means nothing once that number is gone.
      qbo_realm_id: null,
      qbo_synced_at: null,
      qbo_sync_error: null,
    });
  });

  it('does not expose a provider fault detail when deletion fails', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: PAYMENT_ID, qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([{ id: PAYMENT_ID, receipt_id: null, source: 'manual' }]);
    const error = Object.assign(
      new Error('QBO ValidationFault CustomerRef=998877 private upstream detail'),
      { intuitTid: 'tid-delete-1' },
    );
    mocks.deletePayment.mockRejectedValue(error);

    const response = await onRequestPost(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toMatch(/Unable to update the payment in QuickBooks/);
    expect(body.error).not.toContain('998877');
    expect(body.intuit_tid).toBe('tid-delete-1');
  });
});
