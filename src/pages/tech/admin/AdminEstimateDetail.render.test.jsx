// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateDetail.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the estimate details screen's save, send, and invoice-conversion
 *   choices. It also makes sure a screen that has closed cannot start a late
 *   QuickBooks request.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/:estimateId
 *   Rendered by:  Vitest
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, react-router-dom, vitest
 *   Internal:  ./AdminEstimateDetail, @/contexts/AuthContext, @/lib/qboEstimateWorker, @/lib/qboInvoiceWorker
 *   Data:      reads  → mocked estimates, contacts, estimate_line_items
 *              writes → mocked convert_estimate_to_invoice RPC and QuickBooks workers
 *
 * NOTES / GOTCHAS:
 *   - The worker calls are mocked so this test never contacts QuickBooks.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminEstimateDetail from './AdminEstimateDetail';

const mocks = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn(), enabled: vi.fn(), strictEnabled: vi.fn(), auth: vi.fn(), estimateWorker: vi.fn(), invoiceWorker: vi.fn(), navigate: vi.fn(), err: vi.fn(), ok: vi.fn(), impact: vi.fn(), notify: vi.fn(), selection: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: { select: mocks.select, rpc: mocks.rpc }, isFeatureEnabled: mocks.enabled, isStrictFeatureEnabled: mocks.strictEnabled, user: { id: 'user-1' } }) }));
vi.mock('@/lib/realtime', () => ({ getAuthHeader: mocks.auth }));
vi.mock('@/lib/qboEstimateWorker', () => ({ callQboEstimateWorker: mocks.estimateWorker }));
vi.mock('@/lib/qboInvoiceWorker', () => ({ callQboInvoiceWorker: mocks.invoiceWorker }));
vi.mock('@/lib/toast', () => ({ err: mocks.err, ok: mocks.ok }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: mocks.impact, notify: mocks.notify, selection: mocks.selection }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => mocks.navigate }));

let root; let container;
const deferred = () => { let resolve; const promise = new Promise((next) => { resolve = next; }); return { promise, resolve }; };
const button = (text) => [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
const blur = (element) => element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
async function render() { await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/estimate/est-1']}><Routes><Route path="/tech/admin/estimate/:estimateId" element={<AdminEstimateDetail />} /></Routes></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); }); }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; mocks.enabled.mockReturnValue(true); mocks.strictEnabled.mockReturnValue(true); mocks.auth.mockResolvedValue({ Authorization: 'Bearer test' }); mocks.estimateWorker.mockResolvedValue({ emailed_to: 'customer@example.com' }); mocks.invoiceWorker.mockResolvedValue({ ok: true }); mocks.rpc.mockResolvedValue({ invoice_id: 'inv-1' });
  mocks.select.mockImplementation(async (table) => ({ estimates: [{ id: 'est-1', contact_id: 'contact-1', status: 'draft', estimate_number: 'EST-1', qbo_estimate_id: null }], contacts: [{ id: 'contact-1', name: 'Customer', email: 'customer@example.com' }], estimate_line_items: [{ id: 'line-1', description: 'Labor', quantity: 1, unit_price: 100, line_total: 100 }] }[table] || []));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.clearAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

describe('AdminEstimateDetail QBO actions', () => {
  it('keeps the document readable but hides schema-dependent actions when capability is dark', async () => {
    mocks.strictEnabled.mockReturnValue(false);
    await render();
    expect(container.textContent).toContain('Estimate details');
    expect(button('Add line item')).toBeUndefined();
    expect(button('Send to customer')).toBeUndefined();
    expect(button('Convert to invoice')).toBeUndefined();
    expect(button('New estimate')).toBeTruthy();
  });

  it('renders the same always-open document composition and sends through save then send', async () => {
    await render(); expect(container.querySelector('details')).toBeNull(); expect(container.textContent).toContain('Estimate details'); expect(container.textContent).toContain('Line items');
    await act(async () => { button('Send to customer').click(); }); await act(async () => { button('Tap again to send').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.estimateWorker).toHaveBeenNthCalledWith(1, { ownerId: 'user-1', estimateId: 'est-1', authHeaders: { Authorization: 'Bearer test' }, body: { action: 'save' } });
    expect(mocks.estimateWorker).toHaveBeenNthCalledWith(2, { ownerId: 'user-1', estimateId: 'est-1', authHeaders: { Authorization: 'Bearer test' }, body: { estimate_id: 'est-1', action: 'send', send_to: 'customer@example.com' } });
    expect(mocks.selection).toHaveBeenCalled(); expect(mocks.impact).toHaveBeenCalledWith('light'); expect(mocks.notify).toHaveBeenCalledWith('success');
  });
  it('saves an unsynced estimate before convert and then saves the invoice', async () => {
    await render(); await act(async () => { button('Convert to invoice').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.estimateWorker).toHaveBeenCalledWith({ ownerId: 'user-1', estimateId: 'est-1', authHeaders: { Authorization: 'Bearer test' }, body: { action: 'save' } });
    expect(mocks.rpc).toHaveBeenCalledWith('convert_estimate_to_invoice', { p_estimate_id: 'est-1', p_force: false });
    expect(mocks.invoiceWorker).toHaveBeenCalledWith({ ownerId: 'user-1', invoiceId: 'inv-1', authHeaders: { Authorization: 'Bearer test' }, body: { action: 'save' } });
    expect(mocks.impact).toHaveBeenCalledWith('light'); expect(mocks.notify).toHaveBeenCalledWith('success');
  });
  it('disarms Send and Convert confirmations when their button loses focus', async () => {
    await render();
    await act(async () => { button('Send to customer').click(); });
    await act(async () => { blur(button('Tap again to send')); });
    expect(button('Send to customer')).toBeTruthy();
    await act(async () => { button('Send to customer').click(); });
    expect(button('Tap again to send')).toBeTruthy();
    expect(mocks.estimateWorker).not.toHaveBeenCalled();

    mocks.select.mockImplementation(async (table) => ({ estimates: [{ id: 'est-1', contact_id: 'contact-1', status: 'draft', estimate_number: 'EST-1', qbo_estimate_id: 'qbo-est-1' }], contacts: [{ id: 'contact-1', name: 'Customer', email: 'customer@example.com' }], estimate_line_items: [{ id: 'line-1', description: 'Labor', quantity: 1, unit_price: 100, line_total: 100 }] }[table] || []));
    mocks.rpc.mockResolvedValue({ needs_confirm: true, existing_line_count: 1 });
    await act(async () => { root.unmount(); }); root = createRoot(container); await render();
    await act(async () => { button('Convert to invoice').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(button('Tap again to append to invoice')).toBeTruthy();
    await act(async () => { blur(button('Tap again to append to invoice')); });
    expect(button('Convert to invoice')).toBeTruthy();
    await act(async () => { button('Convert to invoice').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.rpc).toHaveBeenLastCalledWith('convert_estimate_to_invoice', { p_estimate_id: 'est-1', p_force: false });
    expect(mocks.invoiceWorker).not.toHaveBeenCalled();
  });
  it.each(['send', 'convert'])('does not start a %s provider call after unmount while auth is pending', async (action) => {
    await render(); const auth = deferred(); mocks.auth.mockReturnValueOnce(auth.promise);
    if (action === 'send') { await act(async () => { button('Send to customer').click(); }); await act(async () => { button('Tap again to send').click(); root.unmount(); auth.resolve({ Authorization: 'Bearer late' }); await Promise.resolve(); }); }
    else await act(async () => { button('Convert to invoice').click(); root.unmount(); auth.resolve({ Authorization: 'Bearer late' }); await Promise.resolve(); });
    expect(mocks.estimateWorker).not.toHaveBeenCalled(); expect(mocks.invoiceWorker).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); root = { unmount: () => {} };
  });
  it.each(['approved', 'denied', 'paid'])('keeps %s estimates read-only', async (status) => { mocks.select.mockImplementation(async (table) => table === 'estimates' ? [{ id: 'est-1', status, estimate_number: 'EST-1' }] : table === 'estimate_line_items' ? [{ id: 'line', description: 'Line', quantity: 1, unit_price: 1 }] : []); await render(); expect(button('Add line item')).toBeUndefined(); expect(button('Send to customer')).toBeUndefined(); expect(button('Convert to invoice')).toBeUndefined(); });
  it('routes an empty draft toward Add line item and offers no provider action', async () => { mocks.select.mockImplementation(async (table) => table === 'estimates' ? [{ id: 'est-1', status: 'draft', estimate_number: 'EST-1' }] : []); await render(); expect(button('Add line item')).toBeTruthy(); expect(button('Send to customer')).toBeUndefined(); expect(button('Convert to invoice')).toBeUndefined(); });
});
