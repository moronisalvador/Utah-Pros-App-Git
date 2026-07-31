/**
 * ════════════════════════════════════════════════
 * FILE: quickbooks-payment-allocation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the shared QuickBooks helper sends one Payment with exact invoice
 *   links and the caller's stable Intuit request ID.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  quickbooks with mocked database and HTTP boundaries
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - No test in this file contacts Intuit or Supabase.
 *   - The same helper remains the compatibility path for one-invoice payments.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

vi.mock('./supabase.js', () => ({
  supabase: () => ({
    select: mocks.select,
  }),
}));
vi.mock('./http.js', () => ({
  fetchWithTimeout: mocks.fetchWithTimeout,
}));

import { createAllocatedPayment, createPayment } from './quickbooks.js';

const ENV = {};
const REQUEST_ID = 'uprp-7ef4b4ea-637e-47bd-a99c-100632aefb55';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockResolvedValue([{
    provider: 'quickbooks',
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    realm_id: 'realm-1',
    environment: 'sandbox',
    token_expires_at: '2999-01-01T00:00:00Z',
  }]);
  mocks.fetchWithTimeout.mockResolvedValue(new Response(JSON.stringify({
    Payment: { Id: 'payment-1' },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
});

describe('createAllocatedPayment', () => {
  it('posts one exact multi-invoice Payment with a stable requestid', async () => {
    await expect(createAllocatedPayment(ENV, {
      customerId: 'customer-1',
      allocations: [
        { qboInvoiceId: 'invoice-1', amountCents: 233645 },
        { qboInvoiceId: 'invoice-2', amountCents: 410362 },
      ],
      txnDate: '2026-07-29',
      paymentMethodId: 'method-check',
      paymentRefNum: '7956',
      depositAccountId: 'bank-2227',
      privateNote: 'UPR receipt 7ef4b4ea-637e-47bd-a99c-100632aefb55',
      requestId: REQUEST_ID,
    })).resolves.toMatchObject({ Id: 'payment-1' });

    expect(mocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [url, options] = mocks.fetchWithTimeout.mock.calls[0];
    expect(url).toContain('/v3/company/realm-1/payment?minorversion=70&requestid=');
    expect(decodeURIComponent(url)).toContain(`requestid=${REQUEST_ID}`);
    expect(JSON.parse(options.body)).toEqual({
      CustomerRef: { value: 'customer-1' },
      TotalAmt: 6440.07,
      TxnDate: '2026-07-29',
      PrivateNote: 'UPR receipt 7ef4b4ea-637e-47bd-a99c-100632aefb55',
      DepositToAccountRef: { value: 'bank-2227' },
      PaymentMethodRef: { value: 'method-check' },
      PaymentRefNum: '7956',
      Line: [
        { Amount: 2336.45, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] },
        { Amount: 4103.62, LinkedTxn: [{ TxnId: 'invoice-2', TxnType: 'Invoice' }] },
      ],
    });
  });

  it('forwards the legacy single-invoice request id to Intuit unchanged', async () => {
    await createPayment(ENV, {
      customerId: 'customer-1',
      qboInvoiceId: 'invoice-1',
      amount: 12.34,
      requestId: 'uprp-payment-row-1',
    });

    const [url, options] = mocks.fetchWithTimeout.mock.calls[0];
    expect(decodeURIComponent(url)).toContain('requestid=uprp-payment-row-1');
    expect(JSON.parse(options.body).Line).toEqual([
      { Amount: 12.34, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] },
    ]);
  });

  it('rejects a duplicate invoice or more than 100 allocations before HTTP', async () => {
    await expect(createAllocatedPayment(ENV, {
      customerId: 'customer-1',
      allocations: [
        { qboInvoiceId: 'invoice-1', amountCents: 100 },
        { qboInvoiceId: 'invoice-1', amountCents: 100 },
      ],
    })).rejects.toThrow(/only appear once/);
    await expect(createAllocatedPayment(ENV, {
      customerId: 'customer-1',
      allocations: Array.from({ length: 101 }, (_, index) => ({
        qboInvoiceId: `invoice-${index}`,
        amountCents: 1,
      })),
    })).rejects.toThrow(/No more than 100/);
    expect(mocks.fetchWithTimeout).not.toHaveBeenCalled();
  });
});
