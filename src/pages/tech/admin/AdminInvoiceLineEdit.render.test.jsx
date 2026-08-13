// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceLineEdit.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   One deliberate line-save sends the safe patch through the idempotent
 *   QuickBooks command, while a same-frame double tap cannot start a second
 *   provider command.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminInvoiceLineEdit from './AdminInvoiceLineEdit';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  isFeatureEnabled: vi.fn(),
  isStrictFeatureEnabled: vi.fn(),
  getAuthHeader: vi.fn(),
  callQboInvoiceWorker: vi.fn(),
  impact: vi.fn(),
  notify: vi.fn(),
  err: vi.fn(),
  ok: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: { select: mocks.select, rpc: mocks.rpc },
    isFeatureEnabled: mocks.isFeatureEnabled,
    isStrictFeatureEnabled: mocks.isStrictFeatureEnabled,
    user: { id: 'user-1' },
  }),
}));
vi.mock('@/lib/realtime', () => ({ getAuthHeader: mocks.getAuthHeader }));
vi.mock('@/lib/qboInvoiceWorker', () => ({ callQboInvoiceWorker: mocks.callQboInvoiceWorker }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: mocks.impact, notify: mocks.notify }));
vi.mock('@/lib/toast', () => ({ err: mocks.err, ok: mocks.ok }));

let container;
let root;

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
      <button type="button" data-testid="route-two" onClick={() => navigate('/tech/admin/invoice/invoice-2/line/line-2')}>
        Open second line
      </button>
      <Routes>
        <Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} />
      </Routes>
    </>
  );
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  mocks.isFeatureEnabled.mockReturnValue(true);
  mocks.isStrictFeatureEnabled.mockReturnValue(true);
  mocks.select.mockImplementation(async (table) => ({
    invoices: [{
      id: 'invoice-1', locked: false, qbo_invoice_id: 'qbo-1', status: 'sent',
      qbo_doc_number: 'INV-100', invoice_number: 'UPR-100',
    }],
    invoice_line_items: [{
      id: 'line-1', invoice_id: 'invoice-1', description: 'Drywall repair',
      qbo_item_id: '42', qbo_item_name: 'Labor', qbo_class_id: '7',
      qbo_class_name: 'Reconstruction', quantity: 2, unit_price: 125.5,
    }],
  }[table] || []));
  mocks.getAuthHeader.mockResolvedValue({ Authorization: 'Bearer test' });
  mocks.callQboInvoiceWorker.mockResolvedValue({ mode: 'updated' });
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    const query = JSON.parse(options.body).query;
    return {
      ok: true,
      json: async () => ({
        queryResponse: query.includes('FROM Item')
          ? { Item: [{ Id: '42', Name: 'Labor', Type: 'Service' }] }
          : { Class: [{ Id: '7', Name: 'Reconstruction' }] },
      }),
    };
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('AdminInvoiceLineEdit save boundary', () => {
  it('fails closed before reads when document commands are not explicitly enabled', async () => {
    mocks.isStrictFeatureEnabled.mockReturnValue(false);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}><Routes><Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} /></Routes></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(container.textContent).toContain('temporarily unavailable');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.callQboInvoiceWorker).not.toHaveBeenCalled();
  });

  it('fails closed before any invoice, catalog, or QBO work when billing is disabled', async () => {
    mocks.isFeatureEnabled.mockReturnValue(false);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(container.textContent).toContain('Billing is turned off');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getAuthHeader).not.toHaveBeenCalled();
    expect(mocks.callQboInvoiceWorker).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Update QuickBooks');
  });

  it('serializes a rapid double submit into one fenced QBO command carrying only the safe patch', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} />
            <Route path="/tech/admin/invoice/:invoiceId" element={<div>Invoice detail</div>} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const button = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === 'Update QuickBooks');
    expect(button).toBeTruthy();

    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.callQboInvoiceWorker).toHaveBeenCalledTimes(1);
    expect(mocks.impact).toHaveBeenCalledTimes(1);
    expect(mocks.impact).toHaveBeenCalledWith('light');
    expect(mocks.callQboInvoiceWorker).toHaveBeenCalledWith({
      ownerId: 'user-1',
      invoiceId: 'invoice-1',
      authHeaders: { Authorization: 'Bearer test' },
      body: {
        action: 'save',
        line_change: {
          kind: 'update', line_id: 'line-1', patch: {
            description: 'Drywall repair',
            qbo_item_id: '42', qbo_item_name: 'Labor', qbo_class_id: '7',
            qbo_class_name: 'Reconstruction', quantity: 2, unit_price: 125.5,
          },
        },
      },
    });
    expect(container.textContent).toContain('Invoice detail');
  });

  it('shows the locked boundary response from the fenced worker', async () => {
    mocks.callQboInvoiceWorker.mockRejectedValueOnce(new Error('Invoice is locked'));
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}>
          <Routes>
            <Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} />
          </Routes>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const button = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === 'Update QuickBooks');
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.callQboInvoiceWorker).toHaveBeenCalledTimes(1);
    expect(mocks.err).toHaveBeenCalledWith('This invoice was locked before the line item could be saved.');
    expect(container.textContent).toContain('This invoice is locked and its line items are read-only.');
  });

  it('keeps the new route when the previous line request fails late', async () => {
    const firstLine = deferred();
    mocks.select.mockImplementation((table, query) => {
      if (table === 'invoices' && query.includes('invoice-1')) return Promise.resolve([{
        id: 'invoice-1', locked: false, qbo_invoice_id: 'qbo-1', status: 'sent',
        qbo_doc_number: 'INV-FIRST', invoice_number: 'UPR-FIRST',
      }]);
      if (table === 'invoice_line_items' && query.includes('line-1')) return firstLine.promise;
      if (table === 'invoices' && query.includes('invoice-2')) return Promise.resolve([{
        id: 'invoice-2', locked: false, qbo_invoice_id: 'qbo-2', status: 'sent',
        qbo_doc_number: 'INV-SECOND', invoice_number: 'UPR-SECOND',
      }]);
      if (table === 'invoice_line_items' && query.includes('line-2')) return Promise.resolve([{
        id: 'line-2', invoice_id: 'invoice-2', description: 'Second route repair',
        quantity: 1, unit_price: 15,
      }]);
      return Promise.resolve([]);
    });

    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}><RouteHarness /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      container.querySelector('[data-testid="route-two"]').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(container.querySelector('.am-invline-input--description').value).toBe('Second route repair');

    await act(async () => {
      firstLine.reject(new Error('first route denied'));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(container.querySelector('.am-invline-input--description').value).toBe('Second route repair');
    expect(container.textContent).not.toContain('first route denied');
    expect(mocks.err).not.toHaveBeenCalledWith('first route denied');
  });

  it('does not start an old line save after a route change during auth', async () => {
    const auth = deferred();
    mocks.select.mockImplementation(async (table, query) => ({
      invoices: [{
        id: query.includes('invoice-2') ? 'invoice-2' : 'invoice-1', locked: false,
        qbo_invoice_id: 'qbo', status: 'sent', qbo_doc_number: 'INV', invoice_number: 'UPR',
      }],
      invoice_line_items: [{
        id: query.includes('line-2') ? 'line-2' : 'line-1', invoice_id: query.includes('invoice-2') ? 'invoice-2' : 'invoice-1',
        description: query.includes('line-2') ? 'Second route repair' : 'First route repair', quantity: 1, unit_price: 10,
      }],
    }[table] || []));
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}><RouteHarness /></MemoryRouter>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    // The catalog may authenticate while the editor loads; fence the save's
    // own auth boundary after that independent read has started.
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockReturnValueOnce(auth.promise);
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Update QuickBooks').click(); });
    await act(async () => { container.querySelector('[data-testid="route-two"]').click(); });
    await act(async () => { auth.resolve({ Authorization: 'Bearer test' }); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(mocks.callQboInvoiceWorker).not.toHaveBeenCalled();
    expect(container.querySelector('.am-invline-input--description').value).toBe('Second route repair');
  });

  it('keeps the new line route when an already-started save resolves late', async () => {
    const saved = deferred();
    mocks.callQboInvoiceWorker.mockReturnValueOnce(saved.promise);
    mocks.select.mockImplementation(async (table, query) => ({
      invoices: [{ id: query.includes('invoice-2') ? 'invoice-2' : 'invoice-1', locked: false, qbo_invoice_id: 'qbo', status: 'sent', qbo_doc_number: 'INV', invoice_number: 'UPR' }],
      invoice_line_items: [{ id: query.includes('line-2') ? 'line-2' : 'line-1', invoice_id: query.includes('invoice-2') ? 'invoice-2' : 'invoice-1', description: query.includes('line-2') ? 'Second route repair' : 'First route repair', quantity: 1, unit_price: 10 }],
    }[table] || []));
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}><RouteHarness /></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Update QuickBooks').click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mocks.callQboInvoiceWorker).toHaveBeenCalledTimes(1);
    await act(async () => { container.querySelector('[data-testid="route-two"]').click(); });
    await act(async () => { saved.resolve({ mode: 'updated' }); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(container.querySelector('.am-invline-input--description').value).toBe('Second route repair');
    expect(mocks.ok).not.toHaveBeenCalled();
  });

  it('does not start a line worker call after unmount while auth is pending', async () => {
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}><Routes><Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} /></Routes></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    const auth = deferred(); mocks.getAuthHeader.mockReset(); mocks.getAuthHeader.mockReturnValueOnce(auth.promise);
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Update QuickBooks').click(); root.unmount(); auth.resolve({ Authorization: 'Bearer late' }); await Promise.resolve(); });
    expect(mocks.callQboInvoiceWorker).not.toHaveBeenCalled();
    root = { unmount: () => {} };
  });

  it('sends exact create, delete, and reorder command bodies', async () => {
    const renderLine = async (id) => { await act(async () => { root.render(<MemoryRouter initialEntries={[`/tech/admin/invoice/invoice-1/line/${id}`]}><Routes><Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} /></Routes></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); }); };
    await renderLine('new');
    const description = container.querySelector('.am-invline-input--description');
    const rate = [...container.querySelectorAll('input')].find((input) => input.parentElement.textContent.includes('Rate'));
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(description, 'New work'); description.dispatchEvent(new Event('input', { bubbles: true })); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(rate, '20'); rate.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...container.querySelectorAll('button')].find((b) => /QuickBooks$/.test(b.textContent)).click(); await Promise.resolve(); });
    expect(mocks.callQboInvoiceWorker.mock.calls[0][0].body.line_change).toEqual({ kind: 'create', patch: { description: 'New work', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 20 } });

    mocks.callQboInvoiceWorker.mockClear(); await act(async () => root.unmount()); root = createRoot(container);
    mocks.select.mockImplementation(async (table, query) => table === 'invoices' ? [{ id: 'invoice-1', locked: false, qbo_invoice_id: 'qbo-1', invoice_number: 'INV' }] : query.includes('id=eq.line-1') ? [{ id: 'line-1', description: 'First', quantity: 1, unit_price: 1 }] : [{ id: 'line-1', description: 'First', quantity: 1, unit_price: 1 }, { id: 'line-2', description: 'Second', quantity: 1, unit_price: 1 }]);
    await renderLine('line-1');
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === 'Delete line item').click(); }); await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === 'Tap again to delete').click(); await Promise.resolve(); });
    expect(mocks.callQboInvoiceWorker.mock.calls[0][0].body.line_change).toEqual({ kind: 'delete', line_id: 'line-1' });

    mocks.callQboInvoiceWorker.mockClear(); await act(async () => root.unmount()); root = createRoot(container);
    mocks.select.mockImplementation(async (table, query) => table === 'invoices' ? [{ id: 'invoice-1', locked: false, qbo_invoice_id: 'qbo-1', invoice_number: 'INV' }] : query.includes('id=eq.line-1') ? [{ id: 'line-1', description: 'First', quantity: 1, unit_price: 1 }] : [{ id: 'line-1', description: 'First', quantity: 1, unit_price: 1 }, { id: 'line-2', description: 'Second', quantity: 1, unit_price: 1 }]);
    await renderLine('line-1'); await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === 'Move down').click(); await Promise.resolve(); });
    expect(mocks.callQboInvoiceWorker.mock.calls[0][0].body.line_change).toEqual({ kind: 'reorder', ordered_line_ids: ['line-2', 'line-1'] });
  });

  it('does not offer a provider delete for the only remaining invoice line', async () => {
    await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1/line/line-1']}><Routes><Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<AdminInvoiceLineEdit />} /></Routes></MemoryRouter>); await new Promise((resolve) => setTimeout(resolve, 25)); });
    const remove = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Delete line item');
    expect(remove.disabled).toBe(true); expect(container.textContent).toContain('must keep at least one line item');
  });
});
