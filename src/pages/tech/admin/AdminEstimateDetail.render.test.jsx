// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateDetail.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the strict-gated estimate detail screen. It uses the durable
 *   owner-scoped estimate command only after a two-tap send confirmation;
 *   conversion stays local and hands review back to the invoice screen.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/:estimateId
 *   Rendered by:  Vitest
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, react-router-dom, vitest
 *   Internal:  ./AdminEstimateDetail, @/contexts/AuthContext
 *   Data:      reads  → mocked estimates, contacts, estimate_line_items
 *              writes → mocked convert_estimate_to_invoice RPC and estimate Worker
 *
 * NOTES / GOTCHAS:
 *   - The source-contract assertion below keeps automatic QBO invoice save out
 *     of estimate conversion even while sending is restored separately.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminEstimateDetail from './AdminEstimateDetail';
import detailSource from './AdminEstimateDetail.jsx?raw';

const mocks = vi.hoisted(() => ({ select: vi.fn(), rpc: vi.fn(), enabled: vi.fn(), strict: vi.fn(), worker: vi.fn(), auth: vi.fn(), navigate: vi.fn(), err: vi.fn(), ok: vi.fn(), impact: vi.fn(), notify: vi.fn(), selection: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: { select: mocks.select, rpc: mocks.rpc }, isFeatureEnabled: mocks.enabled, isStrictFeatureEnabled: mocks.strict, user: { id: 'owner-1' } }) }));
vi.mock('@/lib/realtime', () => ({ getAuthHeader: mocks.auth }));
vi.mock('@/lib/qboEstimateWorker', () => ({ callQboEstimateWorker: mocks.worker }));
vi.mock('@/lib/toast', () => ({ err: mocks.err, ok: mocks.ok }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: mocks.impact, notify: mocks.notify, selection: mocks.selection }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => mocks.navigate }));

let root; let container;
const button = (text) => [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
const blur = (element) => element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
async function render() { await act(async () => { root.render(<MemoryRouter initialEntries={['/tech/admin/estimate/est-1']}><Routes><Route path="/tech/admin/estimate/:estimateId" element={<AdminEstimateDetail />} /></Routes></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); }); }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; mocks.enabled.mockReturnValue(true); mocks.strict.mockReturnValue(true); mocks.auth.mockResolvedValue({ Authorization: 'Bearer token' }); mocks.worker.mockResolvedValue({ emailed_to: 'customer@example.com' }); mocks.rpc.mockResolvedValue({ invoice_id: 'inv-1' });
  mocks.select.mockImplementation(async (table) => ({ estimates: [{ id: 'est-1', contact_id: 'contact-1', status: 'draft', estimate_number: 'EST-1', qbo_estimate_id: null }], contacts: [{ id: 'contact-1', name: 'Customer', email: 'customer@example.com' }], estimate_line_items: [{ id: 'line-1', description: 'Labor', quantity: 1, unit_price: 100, line_total: 100 }] }[table] || []));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.clearAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

describe('AdminEstimateDetail D2 document actions', () => {
  it('keeps the document readable and preserves local conversion', async () => {
    await render();
    expect(container.textContent).toContain('Estimate details');
    expect(button('Add line item')).toBeUndefined();
    expect(button('Send to customer')).toBeUndefined();
    expect(button('Convert to invoice')).toBeTruthy();
    expect(button('New estimate')).toBeTruthy();
  });

  it('sends only after an explicit two-tap confirmation through the durable owner-scoped helper', async () => {
    mocks.select.mockImplementation(async (table) => ({ estimates: [{ id: 'est-1', contact_id: 'contact-1', status: 'draft', estimate_number: 'EST-1', qbo_estimate_id: 'qbo-1' }], contacts: [{ id: 'contact-1', name: 'Customer', email: 'customer@example.com' }], estimate_line_items: [{ id: 'line-1', description: 'Labor', quantity: 1, unit_price: 100, line_total: 100 }] }[table] || []));
    await render();
    await act(async () => { button('Send to customer').click(); });
    expect(button('Tap again to send to customer@example.com')).toBeTruthy();
    expect(mocks.worker).not.toHaveBeenCalled();
    await act(async () => { button('Tap again to send to customer@example.com').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.worker).toHaveBeenCalledWith({ ownerId: 'owner-1', estimateId: 'est-1', authHeaders: { Authorization: 'Bearer token' }, body: { action: 'send' } });
    expect(mocks.ok).toHaveBeenCalledWith('Estimate sent to customer@example.com.');
  });

  it('disarms send on blur and hides it when the strict capability is disabled', async () => {
    mocks.select.mockImplementation(async (table) => ({ estimates: [{ id: 'est-1', contact_id: 'contact-1', status: 'draft', estimate_number: 'EST-1', qbo_estimate_id: 'qbo-1' }], contacts: [{ id: 'contact-1', name: 'Customer', email: 'customer@example.com' }], estimate_line_items: [{ id: 'line-1', description: 'Labor', quantity: 1, unit_price: 100, line_total: 100 }] }[table] || []));
    await render(); await act(async () => { button('Send to customer').click(); });
    await act(async () => { blur(button('Tap again to send to customer@example.com')); });
    await act(async () => { button('Send to customer').click(); });
    expect(mocks.worker).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
    mocks.strict.mockReturnValue(false); root = createRoot(container);
    await render();
    expect(button('Send to customer')).toBeUndefined();
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('converts locally, then directs the human to review and save separately', async () => {
    await render(); await act(async () => { button('Convert to invoice').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.rpc).toHaveBeenCalledWith('convert_estimate_to_invoice', { p_estimate_id: 'est-1', p_force: false });
    expect(mocks.ok).toHaveBeenCalledWith('Estimate converted to an invoice. Review and save to QuickBooks from the invoice page.');
    expect(mocks.navigate).toHaveBeenCalledWith('/tech/admin/invoice/inv-1');
    expect(mocks.impact).toHaveBeenCalledWith('light'); expect(mocks.notify).toHaveBeenCalledWith('success');
  });
  it('disarms the local conversion confirmation when its button loses focus', async () => {
    await render();
    mocks.rpc.mockResolvedValue({ needs_confirm: true, existing_line_count: 1 });
    await act(async () => { button('Convert to invoice').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(button('Tap again to append to invoice')).toBeTruthy();
    await act(async () => { blur(button('Tap again to append to invoice')); });
    expect(button('Convert to invoice')).toBeTruthy();
    await act(async () => { button('Convert to invoice').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.rpc).toHaveBeenLastCalledWith('convert_estimate_to_invoice', { p_estimate_id: 'est-1', p_force: false });
  });
  it.each(['approved', 'denied', 'paid'])('keeps %s estimates read-only', async (status) => { mocks.select.mockImplementation(async (table) => table === 'estimates' ? [{ id: 'est-1', status, estimate_number: 'EST-1' }] : table === 'estimate_line_items' ? [{ id: 'line', description: 'Line', quantity: 1, unit_price: 1 }] : []); await render(); expect(button('Add line item')).toBeUndefined(); expect(button('Send to customer')).toBeUndefined(); expect(button('Convert to invoice')).toBeUndefined(); });
  it('keeps automatic QBO invoice calls out of conversion while using the strict estimate helper for send', () => {
    expect(detailSource).not.toContain('callQboInvoiceWorker');
    expect(detailSource).toContain('callQboEstimateWorker');
    expect(detailSource).toContain("isStrictFeatureEnabled('feature:qbo_document_command_v2')");
    expect(detailSource).toContain('documentCommandsEnabledRef.current');
    expect(detailSource).toContain('save to QuickBooks from the invoice page');
  });
});
