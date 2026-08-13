// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceDetail.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   The native invoice is a dedicated always-open financial page: no document
 *   hero, no disclosure widgets, and each unlocked line opens its focused editor.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminInvoiceDetail from './AdminInvoiceDetail';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  impact: vi.fn(),
  notify: vi.fn(),
  err: vi.fn(),
  ok: vi.fn(),
  callQbo: vi.fn(),
  getAuthHeader: vi.fn(),
  isFeatureEnabled: vi.fn(),
  isStrictFeatureEnabled: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: { select: mocks.select },
    isFeatureEnabled: mocks.isFeatureEnabled,
    isStrictFeatureEnabled: mocks.isStrictFeatureEnabled,
    user: { id: 'user-1' },
  }),
}));
vi.mock('@/lib/nativeHaptics', () => ({
  impact: mocks.impact,
  notify: mocks.notify,
}));
vi.mock('@/lib/toast', () => ({ err: mocks.err, ok: mocks.ok }));
vi.mock('@/lib/realtime', () => ({ getAuthHeader: mocks.getAuthHeader }));
vi.mock('@/lib/qboInvoiceWorker', () => ({ callQboInvoiceWorker: mocks.callQbo }));

let container;
let root;
let invoiceLocked;

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
  return (
    <>
      <button type="button" data-testid="route-two" onClick={() => navigate('/tech/admin/invoice/invoice-2')}>
        Open second invoice
      </button>
      <Routes>
        <Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} />
      </Routes>
    </>
  );
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  invoiceLocked = false;
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.isStrictFeatureEnabled.mockReturnValue(true);
  mocks.getAuthHeader.mockResolvedValue({});
  mocks.callQbo.mockResolvedValue({ emailed_to: 'billing@example.com' });
  mocks.select.mockImplementation(async (table) => ({
    invoices: [{
      id: 'invoice-1', invoice_number: 'INV-100', qbo_doc_number: 'R-100',
      qbo_invoice_id: 'qbo-invoice-1', status: 'sent', locked: invoiceLocked,
      job_id: 'job-1', contact_id: 'contact-1', due_date: '2026-08-04', tax: 0,
      total: 251, amount_paid: 0,
    }],
    jobs: [{
      id: 'job-1', division: 'reconstruction', job_number: 'R-2608-100',
      claim_id: 'claim-1', primary_contact_id: 'contact-1',
      address: '100 Main St', city: 'Provo', state: 'UT', zip: '84601',
    }],
    claims: [{ id: 'claim-1', claim_number: 'CLM-100', insurance_carrier: 'Carrier' }],
    contacts: [{ id: 'contact-1', name: 'Moroni Salvador', email: 'billing@example.com' }],
    invoice_line_items: [{
      id: 'line-1', invoice_id: 'invoice-1', description: 'Drywall repair',
      quantity: 2, unit_price: 125.5, line_total: 251,
    }],
    payments: [],
  }[table] || []));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  vi.clearAllMocks();
});

describe('AdminInvoiceDetail native composition', () => {
  it('keeps legacy send available while document line commands are dark', async () => {
    mocks.isStrictFeatureEnabled.mockReturnValue(false);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}><Routes><Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} /></Routes></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(container.querySelector('a[href*="/line/"]')).toBeNull();
    expect([...container.querySelectorAll('button')].some((node) => node.textContent === 'Add line item')).toBe(false);
    expect(container.querySelector('button[aria-label="Send invoice to customer"]')).toBeTruthy();
  });

  it('fails closed before invoice or related reads when billing is disabled', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(container.textContent).toContain('Billing is turned off');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.callQbo).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Record payment');
  });

  it('shows details and line items without disclosures and routes a line tap to edit', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} />
            <Route
              path="/tech/admin/invoice/:invoiceId/line/:lineId"
              element={<div data-testid="line-editor-route">Line editor route</div>}
            />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(container.querySelector('.am-page--document')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('Invoice details');
    expect(container.textContent).toContain('Line items');
    expect(container.textContent).toContain('Drywall repair');
    expect(container.textContent).toContain('Record payment');
    expect(container.querySelector('.am-dock').closest('.am-page')).not.toBeNull();

    const editLine = container.querySelector('a[aria-label="Edit line item Drywall repair, quantity 2, rate $125.50, total $251.00"]');
    expect(editLine).not.toBeNull();
    expect(editLine.getAttribute('href')).toBe('/tech/admin/invoice/invoice-1/line/line-1');
    expect(container.querySelector('#invoice-balance-title').tagName).toBe('H2');

    await act(async () => { editLine.click(); });
    expect(mocks.impact).toHaveBeenCalledWith('light');
    expect(container.querySelector('[data-testid="line-editor-route"]')).not.toBeNull();
  });

  it('gives the claim route light press feedback before navigating', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} />
            <Route path="/tech/claims/:claimId" element={<div data-testid="claim-route">Claim route</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const claim = [...container.querySelectorAll('a')].find((link) => link.textContent.includes('Claim CLM-100'));
    expect(claim).not.toBeNull();
    await act(async () => { claim.click(); });
    expect(mocks.impact).toHaveBeenCalledWith('light');
    expect(container.querySelector('[data-testid="claim-route"]')).not.toBeNull();
  });

  it('gives Add line item light press feedback before navigating', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} />
            <Route path="/tech/admin/invoice/:invoiceId/line/new" element={<div data-testid="new-line-route">New line</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    mocks.impact.mockClear();
    await act(async () => { [...container.querySelectorAll('button')].find((node) => node.textContent === 'Add line item').click(); });
    expect(mocks.impact).toHaveBeenCalledWith('light');
    expect(container.querySelector('[data-testid="new-line-route"]')).not.toBeNull();
  });

  it('keeps locked lines visible but read-only', async () => {
    invoiceLocked = true;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(container.textContent).toContain('Drywall repair');
    expect(container.querySelector('a[aria-label^="Edit line item Drywall repair"]')).toBeNull();
    expect(container.querySelector('.am-data-row--readonly')).not.toBeNull();
  });

  it('shows the current route error instead of a previously loaded invoice', async () => {
    mocks.select.mockImplementation(async (table, query) => {
      if (table === 'invoices' && query.includes('invoice-2')) throw new Error('second invoice denied');
      return ({
        invoices: [{ id: 'invoice-1', invoice_number: 'INV-ONE', status: 'sent', total: 10 }],
        jobs: [], claims: [], contacts: [], invoice_line_items: [], payments: [],
      }[table] || []);
    });

    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}><RouteHarness /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(container.textContent).toContain('INV-ONE');

    await act(async () => {
      container.querySelector('[data-testid="route-two"]').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(container.textContent).toContain('second invoice denied');
    expect(container.textContent).not.toContain('INV-ONE');
  });

  it('synchronously fences rapid duplicate send confirms', async () => {
    let resolveSend;
    mocks.callQbo.mockImplementation(() => new Promise((resolve) => { resolveSend = resolve; }));
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}>
          <Routes><Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} /></Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    await act(async () => { container.querySelector('button[aria-label="Send invoice to customer"]').click(); });
    mocks.impact.mockClear();
    const confirm = document.body.querySelector('.am-send-sheet .btn-primary');
    await act(async () => {
      confirm.click();
      confirm.click();
      await Promise.resolve();
    });
    expect(mocks.callQbo).toHaveBeenCalledTimes(1);
    expect(mocks.impact).toHaveBeenCalledTimes(1);
    expect(mocks.impact).toHaveBeenCalledWith('light');

    await act(async () => {
      resolveSend({ emailed_to: 'billing@example.com' });
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  });

  it('does not start an old invoice send after a route change during auth', async () => {
    const auth = deferred();
    mocks.getAuthHeader.mockReturnValueOnce(auth.promise);
    mocks.select.mockImplementation(async (table, query) => ({
      invoices: [{
        id: query.includes('invoice-2') ? 'invoice-2' : 'invoice-1',
        invoice_number: query.includes('invoice-2') ? 'INV-TWO' : 'INV-ONE',
        qbo_invoice_id: 'qbo-invoice', status: 'sent', locked: false, total: 10,
      }], jobs: [], claims: [], contacts: [], invoice_line_items: [], payments: [],
    }[table] || []));
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}><RouteHarness /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => { container.querySelector('button[aria-label="Send invoice to customer"]').click(); });
    await act(async () => { document.body.querySelector('.am-send-sheet .btn-primary').click(); });
    await act(async () => { container.querySelector('[data-testid="route-two"]').click(); });
    await act(async () => { auth.resolve({}); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(mocks.callQbo).not.toHaveBeenCalled();
    expect(container.textContent).toContain('INV-TWO');
  });

  it('keeps the new invoice route when an already-started send succeeds late', async () => {
    const sent = deferred();
    mocks.callQbo.mockReturnValueOnce(sent.promise);
    mocks.select.mockImplementation(async (table, query) => ({
      invoices: [{ id: query.includes('invoice-2') ? 'invoice-2' : 'invoice-1', invoice_number: query.includes('invoice-2') ? 'INV-TWO' : 'INV-ONE', qbo_invoice_id: 'qbo', status: 'sent', locked: false, total: 10 }],
      jobs: [], claims: [], contacts: [], invoice_line_items: [], payments: [],
    }[table] || []));
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}><RouteHarness /></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { container.querySelector('button[aria-label="Send invoice to customer"]').click(); });
    await act(async () => { document.body.querySelector('.am-send-sheet .btn-primary').click(); await Promise.resolve(); });
    expect(mocks.callQbo).toHaveBeenCalledTimes(1);
    await act(async () => { container.querySelector('[data-testid="route-two"]').click(); });
    await act(async () => { sent.resolve({ emailed_to: 'billing@example.com' }); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(container.textContent).toContain('INV-TWO');
    expect(mocks.ok).not.toHaveBeenCalled();
  });

  it('does not start an invoice send after unmount while auth is pending', async () => {
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}><Routes><Route path="/tech/admin/invoice/:invoiceId" element={<AdminInvoiceDetail />} /></Routes></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    const auth = deferred(); mocks.getAuthHeader.mockReset(); mocks.getAuthHeader.mockReturnValueOnce(auth.promise);
    await act(async () => { container.querySelector('button[aria-label="Send invoice to customer"]').click(); });
    await act(async () => { document.body.querySelector('.am-send-sheet .btn-primary').click(); root.unmount(); auth.resolve({ Authorization: 'Bearer late' }); await Promise.resolve(); });
    expect(mocks.callQbo).not.toHaveBeenCalled();
    root = { unmount: () => {} };
  });
});
