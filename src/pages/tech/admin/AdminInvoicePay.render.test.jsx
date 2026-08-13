// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoicePay.render.test.jsx  (Admin Mobile — locked payment boundary)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   A locked invoice stops at its local read before the payment-options Worker
 *   is contacted, leaving only the explanatory read-only state and Back path.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminInvoicePay from './AdminInvoicePay';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  fetch: vi.fn(),
  getAuthHeader: vi.fn(),
  isFeatureEnabled: vi.fn(),
  clearPending: vi.fn(),
  notify: vi.fn(),
  err: vi.fn(),
  ok: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: { select: mocks.select }, employee: { id: 'employee-1' },
    isFeatureEnabled: mocks.isFeatureEnabled,
  }),
}));
vi.mock('@/lib/realtime', () => ({ getAuthHeader: mocks.getAuthHeader }));
vi.mock('@/lib/nativeHaptics', () => ({ notify: mocks.notify, impact: vi.fn(), selection: vi.fn() }));
vi.mock('@/lib/toast', () => ({ err: mocks.err, ok: mocks.ok }));
vi.mock('@/components/admin-mobile/invoice/invoicePayment', async (importOriginal) => ({
  ...await importOriginal(),
  clearPendingInvoicePaymentIdentity: mocks.clearPending,
  findInvoiceOption: (data, invoiceId) => data.invoices?.find((invoice) => invoice.id === invoiceId) || null,
}));

let container;
let root;

function stubLocalStorage() {
  const values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: (key) => values.delete(String(key)),
    clear: () => values.clear(),
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function RouteHarness() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button type="button" data-testid="route-two" onClick={() => navigate('/tech/admin/invoice/invoice-2/pay')}>
        Open second payment
      </button>
      <button type="button" data-testid="route-gone" onClick={() => navigate('/gone')}>
        Leave payment
      </button>
      <output data-testid="route-path">{location.pathname}</output>
      <Routes>
        <Route path="/tech/admin/invoice/:invoiceId/pay" element={<AdminInvoicePay />} />
        <Route path="/gone" element={<div>Payment route unmounted</div>} />
      </Routes>
    </>
  );
}

beforeEach(() => {
  stubLocalStorage();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.getAuthHeader.mockResolvedValue({});
  mocks.select.mockResolvedValue([{
    id: 'invoice-1', contact_id: 'contact-1', qbo_invoice_id: 'qbo-invoice-1',
    qbo_doc_number: 'R-100', invoice_number: 'INV-100', locked: true,
  }]);
  globalThis.fetch = mocks.fetch;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.localStorage?.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AdminInvoicePay locked invoice', () => {
  it('fails closed before invoice or payment work when billing is disabled', async () => {
    mocks.isFeatureEnabled.mockImplementation((flag) => flag !== 'feature:billing');

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId/pay" element={<AdminInvoicePay />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(container.textContent).toContain('Billing is turned off');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.getAuthHeader).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Confirm payment');
  });

  it('reads the lock before options and shows the read-only back path', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId/pay" element={<AdminInvoicePay />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(mocks.select).toHaveBeenCalledTimes(1);
    expect(mocks.select.mock.calls[0][1]).toContain('locked');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('This invoice is locked and is read-only. Payments cannot be recorded.');
    expect(container.textContent).not.toContain('Receive payment method');
    expect(container.querySelector('button[aria-label="Back"]')).not.toBeNull();
  });

  it('keeps a failed load visible while a manual retry is pending', async () => {
    const retry = deferred();
    mocks.select
      .mockRejectedValueOnce(new Error('Payment options are unavailable.'))
      .mockImplementationOnce(() => retry.promise);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId/pay" element={<AdminInvoicePay />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(container.textContent).toContain('Payment options are unavailable.');
    await act(async () => {
      container.querySelector('.ui-error-state .btn-primary').click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Payment options are unavailable.');
    expect(container.querySelector('.tab-loading')).toBeNull();

    await act(async () => {
      retry.resolve([{ id: 'invoice-1', locked: true }]);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  });

  it('keeps the new route when the previous payment-options response fails late', async () => {
    const firstOptions = deferred();
    mocks.select.mockImplementation((table, query) => {
      if (table === 'invoices' && query.includes('invoice-1')) return Promise.resolve([{
        id: 'invoice-1', contact_id: 'contact-1', qbo_invoice_id: 'qbo-invoice-1',
        qbo_doc_number: 'INV-FIRST', invoice_number: 'UPR-FIRST', locked: false,
      }]);
      if (table === 'invoices' && query.includes('invoice-2')) return Promise.resolve([{
        id: 'invoice-2', contact_id: 'contact-2', qbo_invoice_id: 'qbo-invoice-2',
        qbo_doc_number: 'INV-SECOND', invoice_number: 'UPR-SECOND', locked: false,
      }]);
      if (table === 'contacts' && query.includes('contact-1')) return Promise.resolve([{
        id: 'contact-1', name: 'First customer', qbo_customer_id: 'qbo-customer-1',
      }]);
      if (table === 'contacts' && query.includes('contact-2')) return Promise.resolve([{
        id: 'contact-2', name: 'Second customer', qbo_customer_id: 'qbo-customer-2',
      }]);
      return Promise.resolve([]);
    });
    mocks.fetch.mockImplementation((url) => {
      if (String(url).includes('contact-1')) return firstOptions.promise;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ok: true,
          contact: { id: 'contact-2', name: 'Second customer', qbo_customer_id: 'qbo-customer-2' },
          invoices: [{ id: 'invoice-2', invoice_number: 'UPR-SECOND', qbo_doc_number: 'INV-SECOND', balance_cents: 500 }],
          payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash' }],
          deposit_accounts: [{ id: 'bank-1', name: 'Undeposited funds', account_type: 'Bank' }],
        }),
      });
    });

    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}><RouteHarness /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      container.querySelector('[data-testid="route-two"]').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(container.textContent).toContain('INV-SECOND');
    expect(container.textContent).toContain('Open balance: $5.00');

    await act(async () => {
      firstOptions.resolve({ ok: false, json: async () => ({ error: 'first payment options denied' }) });
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(container.textContent).toContain('INV-SECOND');
    expect(container.textContent).not.toContain('first payment options denied');
  });

  it('does not start an old payment POST after a route change during auth', async () => {
    const auth = deferred();
    mocks.select.mockImplementation((table, query) => {
      const second = query.includes('invoice-2') || query.includes('contact-2');
      if (table === 'invoices') return Promise.resolve([{
        id: second ? 'invoice-2' : 'invoice-1', contact_id: second ? 'contact-2' : 'contact-1',
        qbo_invoice_id: 'qbo', qbo_doc_number: second ? 'INV-TWO' : 'INV-ONE', invoice_number: second ? 'UPR-TWO' : 'UPR-ONE', locked: false,
      }]);
      if (table === 'contacts') return Promise.resolve([{ id: second ? 'contact-2' : 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' }]);
      return Promise.resolve([]);
    });
    mocks.fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'POST') throw new Error('old route POST must not start');
      const second = String(url).includes('contact-2');
      return Promise.resolve({ ok: true, json: async () => ({
        ok: true, contact: { id: second ? 'contact-2' : 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' },
        invoices: [{ id: second ? 'invoice-2' : 'invoice-1', invoice_number: second ? 'UPR-TWO' : 'UPR-ONE', qbo_doc_number: second ? 'INV-TWO' : 'INV-ONE', balance_cents: 500 }],
        payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash' }],
        deposit_accounts: [{ id: 'bank', name: 'Bank', account_type: 'Bank' }],
      }) });
    });
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}><RouteHarness /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-chip-btn').click(); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 100)); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockReturnValueOnce(auth.promise).mockResolvedValueOnce({});
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { container.querySelector('[data-testid="route-two"]').click(); });
    await act(async () => { auth.resolve({}); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(mocks.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    expect(container.textContent).toContain('INV-TWO');
  });

  it('keeps the new payment route when an already-started POST succeeds late', async () => {
    const posted = deferred();
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockResolvedValue({});
    mocks.select.mockImplementation((table, query) => {
      const second = query.includes('invoice-2') || query.includes('contact-2');
      if (table === 'invoices') return Promise.resolve([{ id: second ? 'invoice-2' : 'invoice-1', contact_id: second ? 'contact-2' : 'contact-1', qbo_invoice_id: 'qbo', qbo_doc_number: second ? 'INV-TWO' : 'INV-ONE', invoice_number: second ? 'UPR-TWO' : 'UPR-ONE', locked: false }]);
      if (table === 'contacts') return Promise.resolve([{ id: second ? 'contact-2' : 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' }]);
      return Promise.resolve([]);
    });
    mocks.fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'POST') return posted.promise;
      const second = String(url).includes('contact-2');
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, contact: { id: second ? 'contact-2' : 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' }, invoices: [{ id: second ? 'invoice-2' : 'invoice-1', qbo_invoice_id: 'qbo', invoice_number: second ? 'UPR-TWO' : 'UPR-ONE', qbo_doc_number: second ? 'INV-TWO' : 'INV-ONE', balance_cents: 500 }], payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash' }], deposit_accounts: [{ id: 'bank', name: 'Bank', account_type: 'Bank' }] }) });
    });
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}><RouteHarness /></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-chip-btn').click(); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await Promise.resolve(); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(mocks.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    await act(async () => { container.querySelector('[data-testid="route-two"]').click(); });
    await act(async () => { posted.resolve({ ok: true, json: async () => ({ ok: true }) }); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(container.textContent).toContain('INV-TWO');
  });

  it('does not start a payment POST when the payment route unmounts during authentication', async () => {
    const auth = deferred();
    mocks.select.mockImplementation((table) => {
      if (table === 'invoices') return Promise.resolve([{ id: 'invoice-1', contact_id: 'contact-1', qbo_invoice_id: 'qbo', qbo_doc_number: 'INV-ONE', invoice_number: 'UPR-ONE', locked: false }]);
      if (table === 'contacts') return Promise.resolve([{ id: 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' }]);
      return Promise.resolve([]);
    });
    mocks.fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'POST') throw new Error('an unmounted route must not start a POST');
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, contact: { id: 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' }, invoices: [{ id: 'invoice-1', invoice_number: 'UPR-ONE', qbo_doc_number: 'INV-ONE', balance_cents: 500 }], payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash' }], deposit_accounts: [{ id: 'bank', name: 'Bank', account_type: 'Bank' }] }) });
    });
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}><RouteHarness /></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-chip-btn').click(); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await Promise.resolve(); });
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockReturnValueOnce(auth.promise);
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await Promise.resolve(); });
    await act(async () => { container.querySelector('[data-testid="route-gone"]').click(); });
    await act(async () => { auth.resolve({}); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(mocks.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
    expect(container.querySelector('[data-testid="route-path"]').textContent).toBe('/gone');
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.ok).not.toHaveBeenCalled();
    expect(mocks.err).not.toHaveBeenCalled();
  });

  it('keeps durable retry cleanup but no UI effects when a started POST resolves after unmount', async () => {
    const posted = deferred();
    mocks.select.mockImplementation((table) => {
      if (table === 'invoices') return Promise.resolve([{ id: 'invoice-1', contact_id: 'contact-1', qbo_invoice_id: 'qbo', qbo_doc_number: 'INV-ONE', invoice_number: 'UPR-ONE', locked: false }]);
      if (table === 'contacts') return Promise.resolve([{ id: 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' }]);
      return Promise.resolve([]);
    });
    mocks.fetch.mockImplementation((url, options = {}) => {
      if (options.method === 'POST') return posted.promise;
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, contact: { id: 'contact-1', name: 'Customer', qbo_customer_id: 'customer-qbo' }, invoices: [{ id: 'invoice-1', invoice_number: 'UPR-ONE', qbo_doc_number: 'INV-ONE', balance_cents: 500 }], payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash' }], deposit_accounts: [{ id: 'bank', name: 'Bank', account_type: 'Bank' }] }) });
    });
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/pay']}><RouteHarness /></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-chip-btn').click(); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await Promise.resolve(); });
    await act(async () => { container.querySelector('.am-inv-btn--primary').click(); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(mocks.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    await act(async () => { container.querySelector('[data-testid="route-gone"]').click(); });
    await act(async () => { posted.resolve({ ok: true, json: async () => ({ ok: true }) }); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(mocks.clearPending).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="route-path"]').textContent).toBe('/gone');
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.ok).not.toHaveBeenCalled();
    expect(mocks.err).not.toHaveBeenCalled();
  });
});
