/**
 * ════════════════════════════════════════════════
 * FILE: qbo-receive-payment.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the protected multi-invoice payment route stops unapproved or stale
 *   requests before QuickBooks, creates one exact payment, and safely resumes an
 *   unchanged request when the first response was lost.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  qbo-receive-payment and mocked server/provider helpers
 *   Data:      none; all QuickBooks and database operations are mocked
 *
 * NOTES / GOTCHAS:
 *   - No test in this file contacts QuickBooks or Supabase.
 *   - Unknown provider outcomes must retain the same Intuit request ID for retry.
 * ════════════════════════════════════════════════
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  select: vi.fn(),
  rpc: vi.fn(),
  getConnection: vi.fn(),
  getQboInvoice: vi.fn(),
  getQboPayment: vi.fn(),
  listMethods: vi.fn(),
  listAccounts: vi.fn(),
  createPayment: vi.fn(),
  recordRun: vi.fn(),
}));

vi.mock('../lib/cors.js', () => ({
  handleOptions: vi.fn(),
  jsonResponse: (data, status) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../lib/qbo-auth.js', () => ({
  authorizeQboBrowserRequest: mocks.authorize,
}));
vi.mock('../lib/supabase.js', () => ({
  supabase: () => ({
    select: mocks.select,
    rpc: mocks.rpc,
  }),
}));
vi.mock('../lib/quickbooks.js', () => ({
  getConnection: mocks.getConnection,
  getQboInvoice: mocks.getQboInvoice,
  getQboPayment: mocks.getQboPayment,
  listQboDepositAccounts: mocks.listAccounts,
  listQboPaymentMethods: mocks.listMethods,
  createAllocatedPayment: mocks.createPayment,
}));
vi.mock('../lib/worker-runs.js', () => ({
  recordWorkerRun: mocks.recordRun,
}));

import { onRequestGet, onRequestPost } from './qbo-receive-payment.js';

const CONTACT = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const INVOICE_A = 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const INVOICE_B = 'ccccccc1-cccc-4ccc-8ccc-ccccccccccc1';
const EMPLOYEE = 'ddddddd1-dddd-4ddd-8ddd-ddddddddddd1';
const REQUEST_ID = '7ef4b4ea-637e-47bd-a99c-100632aefb55';
const ENV = { QBO_RECEIVE_PAYMENT_ENABLED: 'true' };

const input = {
  client_request_id: REQUEST_ID,
  contact_id: CONTACT,
  payment_date: '2026-07-29',
  payer_type: 'homeowner',
  payment_method: 'check',
  qbo_payment_method_id: 'pm-check',
  reference_number: '7956',
  deposit_account_id: 'acct-2227',
  allocations: [
    { invoice_id: INVOICE_A, amount_cents: 233645 },
    { invoice_id: INVOICE_B, amount_cents: 410362 },
  ],
};

const localInvoices = [
  { id: INVOICE_A, invoice_number: 'INV-A', qbo_invoice_id: 'qbo-invoice-a', contact_id: CONTACT, job_id: 'job-a', balance_due: 2336.45 },
  { id: INVOICE_B, invoice_number: 'INV-B', qbo_invoice_id: 'qbo-invoice-b', contact_id: CONTACT, job_id: 'job-b', balance_due: 4103.62 },
];

function qboInvoice(id, balance, customer = 'qbo-customer') {
  return {
    Id: id,
    Balance: balance,
    CustomerRef: { value: customer },
    CurrencyRef: { value: 'USD' },
  };
}

function qboPayment(patch = {}) {
  return {
    Id: 'qbo-payment-1',
    SyncToken: '0',
    TxnDate: input.payment_date,
    CustomerRef: { value: 'qbo-customer' },
    CurrencyRef: { value: 'USD' },
    PaymentMethodRef: { value: input.qbo_payment_method_id, name: 'Check' },
    DepositToAccountRef: { value: input.deposit_account_id, name: 'Operating 2227' },
    PaymentRefNum: input.reference_number,
    TotalAmt: 6440.07,
    UnappliedAmt: 0,
    Line: [
      { Amount: 2336.45, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'qbo-invoice-a' }] },
      { Amount: 4103.62, LinkedTxn: [{ TxnType: 'Invoice', TxnId: 'qbo-invoice-b' }] },
    ],
    MetaData: {
      CreateTime: '2026-07-29T12:00:00Z',
      LastUpdatedTime: '2026-07-29T12:00:00Z',
    },
    ...patch,
  };
}

function request(method = 'POST', env = ENV) {
  return {
    request: new Request('https://app.test/api/qbo-receive-payment', {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(input) : undefined,
    }),
    env,
  };
}

function configureInvoiceReadbacks({ customerB = 'qbo-customer', resumed = false } = {}) {
  const calls = new Map();
  mocks.getQboInvoice.mockImplementation(async (_env, id) => {
    const count = (calls.get(id) || 0) + 1;
    calls.set(id, count);
    const opening = id === 'qbo-invoice-a' ? 2336.45 : 4103.62;
    const customer = id === 'qbo-invoice-b' ? customerB : 'qbo-customer';
    return qboInvoice(id, resumed || count > 1 ? 0 : opening, customer);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, employee: { id: EMPLOYEE } });
  mocks.getConnection.mockResolvedValue({ refresh_token: 'refresh', realm_id: 'realm-1' });
  mocks.listMethods.mockResolvedValue([{ Id: 'pm-check', Name: 'Check', Active: true }]);
  mocks.listAccounts.mockResolvedValue([{ Id: 'acct-2227', Name: 'Operating 2227', AccountType: 'Bank', Active: true }]);
  mocks.createPayment.mockResolvedValue(qboPayment());
  mocks.getQboPayment.mockResolvedValue(qboPayment());
  configureInvoiceReadbacks();
  mocks.select.mockImplementation(async (table, query) => {
    if (table === 'integration_config') return [{ value: 'true' }];
    if (table === 'feature_flags') {
      return [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }];
    }
    if (table === 'contacts' && query.includes(`id=eq.${CONTACT}`)) {
      return [{ id: CONTACT, name: 'Stuart Hernandez', qbo_customer_id: 'qbo-customer' }];
    }
    if (table === 'contacts') {
      return [{ id: CONTACT, name: 'Stuart Hernandez', qbo_customer_id: 'qbo-customer' }];
    }
    if (table === 'invoices') return localInvoices;
    return [];
  });
  mocks.rpc.mockImplementation(async (name) => {
    if (name === 'reserve_qbo_payment_receipt') {
      return { attempt_id: 'attempt-1', status: 'submitting', replayed: false };
    }
    if (name === 'finalize_qbo_payment_receipt') {
      return { receipt_id: 'receipt-1', status: 'locally_finalized' };
    }
    return {};
  });
});

describe('QBO receive-payment boundary', () => {
  it('stops a denied caller before any database or provider work', async () => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    const response = await onRequestPost(request());
    expect(response.status).toBe(403);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it('passes its bounded Supabase transport to the authorization gate', async () => {
    await onRequestPost(request());

    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.any(Request), ENV, expect.any(Object), expect.any(Function),
    );
  });

  it.each(['GET', 'POST'])('stays inert unless the worker kill switch is explicitly enabled (%s)', async (method) => {
    const response = method === 'GET'
      ? await onRequestGet(request('GET', {}))
      : await onRequestPost(request('POST', {}));
    expect(response.status).toBe(503);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled', { key: 'feature:qbo_receive_payment', enabled: false, force_disabled: false }],
    ['force-disabled', { key: 'feature:qbo_receive_payment', enabled: true, force_disabled: true }],
    ['missing', []],
    ['malformed', { key: 'feature:qbo_receive_payment', enabled: 'true', force_disabled: false }],
    ['unreadable', new Error('feature flags unavailable')],
  ])('requires the enabled database feature flag before any QBO work (%s)', async (_label, flag) => {
    mocks.select.mockImplementation(async (table) => {
      if (table !== 'feature_flags') return [];
      if (flag instanceof Error) throw flag;
      return Array.isArray(flag) ? flag : [flag];
    });
    const response = await onRequestPost(request());
    expect(response.status).toBe(503);
    expect(mocks.getConnection).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
  });

  it('requires the enabled database feature flag for GET and permits it when both gates are open', async () => {
    const response = await onRequestGet(request('GET'));
    expect(response.status).toBe(200);
    expect(mocks.select).toHaveBeenCalledWith(
      'feature_flags',
      'key=eq.feature%3Aqbo_receive_payment&select=key,enabled,force_disabled&limit=1',
    );
  });

  it('hides QuickBooks customer ids from the browser customer list', async () => {
    const response = await onRequestGet(request('GET'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.contacts).toEqual([{ id: CONTACT, name: 'Stuart Hernandez' }]);
    expect(JSON.stringify(body)).not.toContain('qbo-customer');
  });

  it('returns a trusted canonical type for each active QuickBooks payment method', async () => {
    const context = request('GET');
    context.request = new Request(`https://app.test/api/qbo-receive-payment?contact_id=${CONTACT}`);
    const response = await onRequestGet(context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      payment_methods: [{ id: 'pm-check', name: 'Check', type: 'check' }],
      contact: { id: CONTACT, name: 'Stuart Hernandez' },
    });
  });

  it('returns the typed maintenance refusal when the gate closes while loading GET options', async () => {
    const error = Object.assign(new Error('private gate detail'), {
      code: 'qbo_provider_traffic_disabled',
      reason: 'qbo_provider_traffic_disabled',
      status: 503,
    });
    mocks.listMethods.mockRejectedValue(error);
    const context = request('GET');
    context.request = new Request(`https://app.test/api/qbo-receive-payment?contact_id=${CONTACT}`);

    const response = await onRequestGet(context);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'qbo_provider_traffic_disabled',
      reason: 'qbo_provider_traffic_disabled',
    });
  });

  it.each(['qbo-realm-mismatch', 'qbo-connection-changed'])(
    'returns stable retry truth for a %s while loading GET options',
    async (code) => {
      mocks.listMethods.mockRejectedValue(Object.assign(new Error('private connection detail'), {
        code,
        status: 409,
      }));
      const context = request('GET');
      context.request = new Request(`https://app.test/api/qbo-receive-payment?contact_id=${CONTACT}`);

      const response = await onRequestGet(context);

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: 'QuickBooks connection changed while loading payment options. Reload and try again.',
        code,
        reason: code,
        retry_same_request: true,
      });
    },
  );

  it('labels each open invoice with its job number, type, address, and date of loss', async () => {
    // Nine INV-numbers for one property manager say nothing; the job identity
    // is what tells the allocator which invoice is which.
    mocks.select.mockImplementation(async (table, query) => {
      if (table === 'integration_config') return [{ value: 'true' }];
      if (table === 'feature_flags') {
        return [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }];
      }
      if (table === 'contacts') {
        return [{ id: CONTACT, name: 'Stuart Hernandez', qbo_customer_id: 'qbo-customer' }];
      }
      if (table === 'invoices') return localInvoices;
      if (table === 'jobs') {
        expect(query).toContain('job_number');
        return [
          { id: 'job-a', job_number: 'W-2605-015', address: '319 W 1290 N', city: 'American Fork', division: 'water', claim_id: 'claim-a' },
          { id: 'job-b', job_number: 'R-2604-019', address: '88 S Main', city: 'Provo', division: 'reconstruction', claim_id: null },
        ];
      }
      if (table === 'claims') {
        return [{ id: 'claim-a', date_of_loss: '2026-05-14' }];
      }
      return [];
    });
    const context = request('GET');
    context.request = new Request(`https://app.test/api/qbo-receive-payment?contact_id=${CONTACT}`);
    const response = await onRequestGet(context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invoices).toEqual([
      expect.objectContaining({
        id: INVOICE_A,
        invoice_number: 'INV-A',
        job_number: 'W-2605-015',
        job_division: 'water',
        job_address: '319 W 1290 N, American Fork',
        date_of_loss: '2026-05-14',
      }),
      expect.objectContaining({
        id: INVOICE_B,
        job_number: 'R-2604-019',
        job_division: 'reconstruction',
        job_address: '88 S Main, Provo',
        date_of_loss: null,
      }),
    ]);
    // The internal job_id linkage stays server-side.
    expect(body.invoices.every((invoice) => !('job_id' in invoice))).toBe(true);
  });

  it('degrades to bare invoice rows when the job lookup fails — money flow never blocks', async () => {
    const base = mocks.select.getMockImplementation();
    mocks.select.mockImplementation(async (table, query) => {
      if (table === 'jobs') throw new Error('jobs lookup down');
      return base(table, query);
    });
    const context = request('GET');
    context.request = new Request(`https://app.test/api/qbo-receive-payment?contact_id=${CONTACT}`);
    const response = await onRequestGet(context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invoices).toHaveLength(2);
    expect(body.invoices[0]).toMatchObject({ invoice_number: 'INV-A' });
    expect(body.invoices[0].job_number).toBeUndefined();
  });

  it('lists open invoices from the UPR mirror without any QuickBooks invoice read', async () => {
    // The list must be instant (owner-reported slow at nine invoices,
    // 2026-08-06): balances come from invoices.balance_due, zero-balance rows
    // drop out, and NO getQboInvoice call happens on GET. Money exactness is
    // enforced at reservation time instead, where every allocated invoice is
    // re-read live from QuickBooks.
    mocks.select.mockImplementation(async (table) => {
      if (table === 'integration_config') return [{ value: 'true' }];
      if (table === 'feature_flags') {
        return [{ key: 'feature:qbo_receive_payment', enabled: true, force_disabled: false }];
      }
      if (table === 'contacts') {
        return [{ id: CONTACT, name: 'Stuart Hernandez', qbo_customer_id: 'qbo-customer' }];
      }
      if (table === 'invoices') {
        return [...localInvoices, { id: 'paid-off', invoice_number: 'INV-C', qbo_invoice_id: 'qbo-invoice-c', contact_id: CONTACT, job_id: null, balance_due: 0 }];
      }
      return [];
    });
    const context = request('GET');
    context.request = new Request(`https://app.test/api/qbo-receive-payment?contact_id=${CONTACT}`);
    const response = await onRequestGet(context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.invoices.map((invoice) => [invoice.id, invoice.balance_cents])).toEqual([
      [INVOICE_A, 233645],
      [INVOICE_B, 410362],
    ]);
    expect(mocks.getQboInvoice).not.toHaveBeenCalled();
  });

  it('creates one exact two-invoice payment with the stable Intuit request id', async () => {
    const response = await onRequestPost(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      qbo_payment_id: 'qbo-payment-1',
      receipt_id: 'receipt-1',
    });
    expect(mocks.createPayment).toHaveBeenCalledWith(ENV, expect.objectContaining({
      requestId: `uprp-${REQUEST_ID}`,
      customerId: 'qbo-customer',
      paymentMethodId: 'pm-check',
      paymentRefNum: '7956',
      depositAccountId: 'acct-2227',
      allocations: [
        { qboInvoiceId: 'qbo-invoice-a', amountCents: 233645 },
        { qboInvoiceId: 'qbo-invoice-b', amountCents: 410362 },
      ],
    }));
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'reserve_qbo_payment_receipt',
      'mark_qbo_payment_receipt_created',
      'finalize_qbo_payment_receipt',
    ]);
  });

  it('rejects a cross-customer allocation after reservation but before provider creation', async () => {
    configureInvoiceReadbacks({ customerB: 'different-customer' });
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.objectContaining({
      p_status: 'rejected',
    }));
  });

  it('marks a transport timeout as unknown because QuickBooks may have accepted it', async () => {
    mocks.createPayment.mockRejectedValue(new Error('request timed out'));
    const response = await onRequestPost(request());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'unknown',
      retry_unchanged: true,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.objectContaining({
      p_status: 'unknown_outcome',
    }));
  });

  it('records a gate-close before provider dispatch as rejected and returns the typed 503', async () => {
    const error = Object.assign(new Error('QuickBooks provider traffic is disabled'), {
      code: 'qbo_provider_traffic_disabled',
      reason: 'qbo_provider_traffic_disabled',
      status: 503,
    });
    mocks.createPayment.mockRejectedValue(error);

    const response = await onRequestPost(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'qbo_provider_traffic_disabled',
      reason: 'qbo_provider_traffic_disabled',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.objectContaining({
      p_status: 'rejected',
      p_error_code: 'qbo_provider_traffic_disabled',
      p_error_message: 'qbo_provider_traffic_disabled',
    }));
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'fail_qbo_payment_receipt_attempt',
      expect.objectContaining({ p_status: 'unknown_outcome' }),
    );
  });

  it.each(['qbo-realm-mismatch', 'qbo-connection-changed'])(
    'records a %s refusal before provider dispatch as rejected, not unknown',
    async (code) => {
      const error = Object.assign(new Error('private connection detail must stay internal'), {
        code,
        status: 409,
      });
      mocks.createPayment.mockRejectedValue(error);

      const response = await onRequestPost(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: 'QuickBooks connection changed before the payment was sent. Reload this payment screen and review the customer, invoices, and payment details before starting a new submission.',
        code,
        reason: code,
        outcome: 'rejected',
        retry_unchanged: false,
      });
      expect(mocks.rpc).toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.objectContaining({
        p_status: 'rejected',
        p_error_code: code,
        p_error_message: code,
      }));
      expect(mocks.rpc).not.toHaveBeenCalledWith(
        'fail_qbo_payment_receipt_attempt',
        expect.objectContaining({ p_status: 'unknown_outcome' }),
      );
    },
  );

  it('marks an explicit QBO 400 validation response as rejected', async () => {
    const error = new Error('Invalid Reference — CustomerRef 998877 is inactive');
    error.status = 400;
    error.qboCode = '2010';
    error.intuitTid = 'tid-safe-correlation';
    mocks.createPayment.mockRejectedValue(error);
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    await expect(response.clone().json()).resolves.toMatchObject({
      error: 'QuickBooks rejected the payment. Review the payment details and try again.',
      intuit_tid: 'tid-safe-correlation',
    });
    expect(JSON.stringify(await response.json())).not.toContain('998877');
    expect(mocks.rpc).toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.objectContaining({
      p_status: 'rejected',
      p_error_code: 'qbo_receipt_fault_2010 [intuit_tid:tid-safe-correlation]',
      p_error_message: 'qbo_receipt_fault_2010 [intuit_tid:tid-safe-correlation]',
    }));
    expect(mocks.recordRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      errorMessage: 'qbo_receipt_fault_2010 [intuit_tid:tid-safe-correlation]',
    }));
  });

  it('never stores or reflects an untrusted provider tid or error message', async () => {
    const privateDetail = 'QBO Fault Detail: Alice account 998877 must remain private';
    const error = Object.assign(new Error(privateDetail), {
      status: 400,
      qboCode: '2010',
      intuitTid: '<script>private</script>',
    });
    mocks.createPayment.mockRejectedValue(error);

    const response = await onRequestPost(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ intuit_tid: null });
    expect(mocks.rpc).toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.objectContaining({
      p_error_code: 'qbo_receipt_fault_2010',
      p_error_message: 'qbo_receipt_fault_2010',
    }));
    expect(JSON.stringify(mocks.recordRun.mock.calls)).not.toContain(privateDetail);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(privateDetail);
  });

  it('does not finalize a provider response that changed the reviewed deposit account', async () => {
    mocks.createPayment.mockResolvedValue(qboPayment({
      DepositToAccountRef: { value: 'different-account', name: 'Wrong account' },
    }));
    const response = await onRequestPost(request());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ outcome: 'unknown' });
    expect(mocks.rpc).not.toHaveBeenCalledWith('finalize_qbo_payment_receipt', expect.anything());
  });

  it('preserves a durable QBO identity conflict without overwriting it through the failure RPC', async () => {
    mocks.rpc.mockImplementation(async (name) => {
      if (name === 'reserve_qbo_payment_receipt') {
        return { attempt_id: 'attempt-1', status: 'submitting', replayed: false };
      }
      if (name === 'mark_qbo_payment_receipt_created') return { conflict: true, status: 'conflict' };
      return {};
    });
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ conflict: true });
    expect(mocks.rpc).not.toHaveBeenCalledWith('finalize_qbo_payment_receipt', expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.anything());
  });

  it('resumes a known QBO payment without issuing another create', async () => {
    mocks.rpc.mockImplementation(async (name) => {
      if (name === 'reserve_qbo_payment_receipt') {
        return {
          attempt_id: 'attempt-1',
          status: 'qbo_created',
          replayed: true,
          qbo_payment_id: 'qbo-payment-1',
        };
      }
      if (name === 'finalize_qbo_payment_receipt') return { receipt_id: 'receipt-1' };
      return {};
    });
    configureInvoiceReadbacks({ resumed: true });
    const response = await onRequestPost(request());
    expect(response.status).toBe(200);
    expect(mocks.getQboPayment).toHaveBeenCalledWith(ENV, 'qbo-payment-1', { expectedRealmId: 'realm-1' });
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('finalize_qbo_payment_receipt', expect.anything());
  });

  it.each(['locally_finalized', 'reconciled'])(
    'returns a completed %s replay before any provider read',
    async (status) => {
      mocks.rpc.mockImplementation(async (name) => {
        if (name === 'reserve_qbo_payment_receipt') {
          return {
            attempt_id: 'attempt-1',
            receipt_id: 'receipt-1',
            status,
            replayed: true,
            qbo_payment_id: 'qbo-payment-1',
          };
        }
        return {};
      });
      const response = await onRequestPost(request());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, resumed: true });
      expect(mocks.listMethods).not.toHaveBeenCalled();
      expect(mocks.listAccounts).not.toHaveBeenCalled();
      expect(mocks.getQboInvoice).not.toHaveBeenCalled();
      expect(mocks.getQboPayment).not.toHaveBeenCalled();
      expect(mocks.createPayment).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['conflict', 'voided', 'deleted'])(
    'refuses an unchanged %s receipt attempt before any provider read or write',
    async (status) => {
      mocks.rpc.mockImplementation(async (name) => {
        if (name === 'reserve_qbo_payment_receipt') {
          return {
            attempt_id: 'attempt-1',
            receipt_id: 'receipt-1',
            status,
            replayed: true,
            qbo_payment_id: 'qbo-payment-1',
          };
        }
        return {};
      });
      const response = await onRequestPost(request());
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        outcome: status,
        retry_unchanged: false,
      });
      expect(mocks.listMethods).not.toHaveBeenCalled();
      expect(mocks.listAccounts).not.toHaveBeenCalled();
      expect(mocks.getQboInvoice).not.toHaveBeenCalled();
      expect(mocks.getQboPayment).not.toHaveBeenCalled();
      expect(mocks.createPayment).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a provider tombstone that wins before the created Payment can be bound', async () => {
    mocks.rpc.mockImplementation(async (name) => {
      if (name === 'reserve_qbo_payment_receipt') {
        return { attempt_id: 'attempt-1', status: 'submitting', replayed: false };
      }
      if (name === 'mark_qbo_payment_receipt_created') {
        return {
          attempt_id: 'attempt-1',
          qbo_payment_id: 'qbo-payment-1',
          status: 'deleted',
          ignored_terminal: true,
        };
      }
      return {};
    });
    const response = await onRequestPost(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'deleted',
      retry_unchanged: false,
    });
    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalledWith('finalize_qbo_payment_receipt', expect.anything());
    expect(mocks.rpc).not.toHaveBeenCalledWith('fail_qbo_payment_receipt_attempt', expect.anything());
  });
});
