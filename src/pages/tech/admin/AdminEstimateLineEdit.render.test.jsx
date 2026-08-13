// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateLineEdit.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the screen used to add, change, remove, and reorder estimate line
 *   items. It confirms each choice sends the intended saved details only once
 *   and does nothing after the screen has closed.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/:estimateId/line/:lineId
 *   Rendered by:  Vitest
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, react-router-dom, vitest
 *   Internal:  ./AdminEstimateLineEdit, @/contexts/AuthContext, @/lib/qboEstimateWorker
 *   Data:      reads  → mocked estimates, estimate_line_items
 *              writes → mocked QuickBooks estimate worker
 *
 * NOTES / GOTCHAS:
 *   - The test replaces network access so no live QuickBooks data is used.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminEstimateLineEdit from './AdminEstimateLineEdit';

const mocks = vi.hoisted(() => ({ select: vi.fn(), enabled: vi.fn(), strictEnabled: vi.fn(), auth: vi.fn(), worker: vi.fn(), navigate: vi.fn(), err: vi.fn(), ok: vi.fn(), impact: vi.fn(), notify: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: { select: mocks.select }, isFeatureEnabled: mocks.enabled, isStrictFeatureEnabled: mocks.strictEnabled, user: { id: 'user-1' } }) }));
vi.mock('@/lib/realtime', () => ({ getAuthHeader: mocks.auth }));
vi.mock('@/lib/qboEstimateWorker', () => ({ callQboEstimateWorker: mocks.worker }));
vi.mock('@/lib/toast', () => ({ err: mocks.err, ok: mocks.ok }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: mocks.impact, notify: mocks.notify }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => mocks.navigate }));

let root; let container;
const lines = [{ id: 'line-1', description: 'Labor', quantity: 2, unit_price: 50 }, { id: 'line-2', description: 'Materials', quantity: 1, unit_price: 25 }];
const deferred = () => { let resolve; const promise = new Promise((next) => { resolve = next; }); return { promise, resolve }; };
async function render(lineId = 'line-1') { await act(async () => { root.render(<MemoryRouter initialEntries={[`/tech/admin/estimate/est-1/line/${lineId}`]}><Routes><Route path="/tech/admin/estimate/:estimateId/line/:lineId" element={<AdminEstimateLineEdit />} /></Routes></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); }); }
const button = (text) => [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
const expectChange = (change) => expect(mocks.worker).toHaveBeenCalledWith({ ownerId: 'user-1', estimateId: 'est-1', authHeaders: { Authorization: 'Bearer test' }, body: { action: 'save', line_change: change } });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; mocks.enabled.mockReturnValue(true); mocks.strictEnabled.mockReturnValue(true); mocks.auth.mockResolvedValue({ Authorization: 'Bearer test' }); mocks.worker.mockResolvedValue({ ok: true });
  mocks.select.mockImplementation(async (table) => table === 'estimates' ? [{ id: 'est-1', status: 'draft', qbo_estimate_id: null, estimate_number: 'EST-1' }] : lines);
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({ ok: true, json: async () => ({ queryResponse: JSON.parse(options.body).query.includes('FROM Item') ? { Item: [] } : { Class: [] } }) })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

describe('AdminEstimateLineEdit command boundary', () => {
  it('fails before reads when document commands are not explicitly enabled', async () => { mocks.strictEnabled.mockReturnValue(false); await render(); expect(container.textContent).toContain('temporarily unavailable'); expect(mocks.select).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); });
  it('fails before reads when billing is disabled', async () => { mocks.enabled.mockReturnValue(false); await render(); expect(mocks.select).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled(); });
  it('sends exact update once under rapid double tap', async () => { await render(); const save = button('Save to QuickBooks'); await act(async () => { save.click(); save.click(); await Promise.resolve(); }); expect(mocks.worker).toHaveBeenCalledTimes(1); expectChange({ kind: 'update', line_id: 'line-1', patch: { description: 'Labor', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 2, unit_price: 50 } }); expect(mocks.impact).toHaveBeenCalledWith('light'); expect(mocks.notify).toHaveBeenCalledWith('success'); });
  it('sends exact create body and Enter remains inert', async () => {
    await render('new'); const description = container.querySelector('.am-invline-input--description'); const rate = [...container.querySelectorAll('input')].find((input) => input.parentElement.textContent.includes('Rate'));
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(description, 'New labor'); description.dispatchEvent(new Event('input', { bubbles: true })); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(rate, '75'); rate.dispatchEvent(new Event('input', { bubbles: true })); description.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(mocks.worker).not.toHaveBeenCalled(); await act(async () => { button('Save to QuickBooks').click(); await Promise.resolve(); }); expectChange({ kind: 'create', patch: { description: 'New labor', qbo_item_id: null, qbo_item_name: null, qbo_class_id: null, qbo_class_name: null, quantity: 1, unit_price: 75 } });
  });
  it('sends exact delete and reorder bodies', async () => {
    await render(); await act(async () => { button('Delete line item').click(); }); await act(async () => { button('Tap again to delete').click(); await Promise.resolve(); }); expectChange({ kind: 'delete', line_id: 'line-1' });
    mocks.worker.mockClear(); mocks.navigate.mockClear(); await act(async () => { root.unmount(); }); root = createRoot(container); await render(); await act(async () => { button('Move down').click(); await Promise.resolve(); }); expectChange({ kind: 'reorder', ordered_line_ids: ['line-2', 'line-1'] });
  });
  it('does not start a worker call after unmount while auth is pending', async () => {
    await render(); const auth = deferred(); mocks.auth.mockReturnValueOnce(auth.promise); await act(async () => { button('Save to QuickBooks').click(); root.unmount(); auth.resolve({ Authorization: 'Bearer late' }); await Promise.resolve(); }); expect(mocks.worker).not.toHaveBeenCalled(); root = { unmount: () => {} };
  });
  it('disables provider deletion for the only remaining estimate line', async () => {
    mocks.select.mockImplementation(async (table) => table === 'estimates' ? [{ id: 'est-1', status: 'draft', estimate_number: 'EST-1' }] : [lines[0]]);
    await render(); expect(button('Delete line item').disabled).toBe(true); expect(container.textContent).toContain('must keep at least one line item');
  });
});
