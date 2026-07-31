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

function request(paymentId = 'payment-row-1', env = {}) {
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
  it('rejects a receipt-linked allocation without calling QuickBooks', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: 'receipt-1', source: 'upr' }])
      .mockResolvedValueOnce([{ id: 'payment-row-1', receipt_id: 'receipt-1', source: 'upr' }]);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('rejects a durable receipt header even after its active projections were removed', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
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
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'feature:qbo_receive_payment' }])
      .mockResolvedValueOnce([{ id: 'receipt-1' }]);
    const response = await onRequestPost(request('payment-row-1', {
      QBO_RECEIVE_PAYMENT_ENABLED: 'false',
    }));
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('fails closed when the durable receipt-header safety query cannot run', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: 'feature:qbo_receive_payment' }])
      .mockRejectedValueOnce(new Error('payment_receipts is unavailable'));
    const response = await onRequestPost(request());
    expect(response.status).toBe(503);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('rejects a legacy QBO id shared by more than one invoice row', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([
        { id: 'payment-row-1', receipt_id: null, source: 'manual' },
        { id: 'payment-row-2', receipt_id: null, source: 'manual' },
      ]);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it.each(['qbo', 'stripe'])('rejects a single %s-provider row', async (source) => {
    mocks.select
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: null, source }])
      .mockResolvedValueOnce([{ id: 'payment-row-1', receipt_id: null, source }]);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.deletePayment).not.toHaveBeenCalled();
  });

  it('preserves the existing single manual-payment delete path', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([{ id: 'payment-row-1', receipt_id: null, source: 'manual' }]);
    mocks.deletePayment.mockResolvedValue({ ok: true });
    const response = await onRequestPost(request());
    expect(response.status).toBe(200);
    expect(mocks.deletePayment).toHaveBeenCalledWith({}, 'qbo-1');
    expect(mocks.update).toHaveBeenCalledWith('payments', 'id=eq.payment-row-1', {
      qbo_payment_id: null,
      qbo_synced_at: null,
      qbo_sync_error: null,
    });
  });

  it('does not expose a provider fault detail when deletion fails', async () => {
    mocks.select
      .mockResolvedValueOnce([{ id: 'payment-row-1', qbo_payment_id: 'qbo-1', receipt_id: null, source: 'manual' }])
      .mockResolvedValueOnce([{ id: 'payment-row-1', receipt_id: null, source: 'manual' }]);
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
