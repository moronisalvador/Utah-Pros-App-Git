// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: EstimateCreateForm.lifecycle.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the new-estimate form while people search for, choose, and change
 *   customers. It makes sure the screen reports loading problems clearly and
 *   does not let an older search replace a newer choice.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  Vitest
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, vitest
 *   Internal:  ./EstimateCreateForm, @/lib/toast, @/lib/nativeHaptics, @/components/AddContactModal
 *   Data:      reads  → mocked RPC results
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Uses fake time so customer-search delays can be checked without waiting.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EstimateCreateForm from './EstimateCreateForm';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), impact: vi.fn(), notify: vi.fn(), selection: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: mocks.impact, notify: mocks.notify, selection: mocks.selection }));
vi.mock('@/components/AddContactModal', () => ({ default: ({ onSave }) => <button type="button" onClick={() => onSave({ name: 'New customer', phone: '8015551212' })}>Save mocked customer</button> }));

let root; let container; let db; let onCreated;
const deferred = () => { let resolve; const promise = new Promise((next) => { resolve = next; }); return { promise, resolve }; };
const btn = (text) => [...container.querySelectorAll('button')].find((candidate) => candidate.textContent.includes(text));
async function search(value) { const input = container.querySelector('input'); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); vi.advanceTimersByTime(301); await Promise.resolve(); await Promise.resolve(); }); }
async function render() { await act(async () => { root.render(<EstimateCreateForm db={db} employee={{ id: 'employee-1' }} onCreated={onCreated} onOpenExisting={() => {}} />); await Promise.resolve(); }); }

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); onCreated = vi.fn(); db = { rpc: vi.fn(async (name, body) => name === 'get_insurance_carriers' ? [] : name === 'search_contacts_for_job' ? [{ id: body.p_query, name: body.p_query }] : { id: 'estimate-1' }), select: vi.fn(async () => []), insert: vi.fn() }; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.clearAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

describe('EstimateCreateForm lifecycle', () => {
  it('announces search results and restores focus across choose/change', async () => {
    await render(); await search('Customer');
    expect(container.querySelector('[role="status"]').textContent).toBe('1 customer found.');
    await act(async () => { btn('Customer').click(); await Promise.resolve(); });
    expect(document.activeElement).toBe(container.querySelector('#estimate-job-type-label'));
    await act(async () => { btn('Change').click(); await Promise.resolve(); });
    expect(document.activeElement).toBe(container.querySelector('#estimate-customer-search-input'));
  });
  it('politely announces no matching customers', async () => {
    db.rpc.mockImplementation((name) => name === 'get_insurance_carriers' ? Promise.resolve([]) : Promise.resolve([]));
    await render(); await search('Missing'); const status = container.querySelector('[role="status"]');
    expect(status.getAttribute('aria-live')).toBe('polite'); expect(status.textContent).toBe('No customers found.');
  });
  it('renders a retryable search error instead of reporting a failed request as no results', async () => {
    let attempts = 0;
    db.rpc.mockImplementation((name) => name === 'get_insurance_carriers' ? Promise.resolve([]) : attempts++ === 0 ? Promise.reject(new Error('offline')) : Promise.resolve([]));
    await render(); await search('Missing');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Customer search failed');
    expect(container.textContent).not.toContain('No customers found.');
    await act(async () => { btn('Retry search').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('No customers found.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('semantically names customer, type choices, and every address field', async () => {
    await render();
    const customerSearch = container.querySelector('#estimate-customer-search-input');
    expect(container.querySelector('label[for="estimate-customer-search-input"]')?.textContent).toContain('Customer');
    expect(customerSearch).not.toBeNull();
    await search('Customer'); await act(async () => { btn('Customer').click(); await Promise.resolve(); });
    for (const id of ['estimate-job-type-label', 'estimate-type-label', 'estimate-property-address-label']) {
      const group = container.querySelector(`[role="group"][aria-labelledby="${id}"]`);
      expect(group).not.toBeNull(); expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(btn('Water').getAttribute('aria-pressed')).toBe('true');
    expect(btn('Initial').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('input[placeholder="Street address"]').closest('label')?.textContent).toContain('Property address');
    expect(container.querySelector('input[aria-label="City"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="State"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="ZIP code"]')).not.toBeNull();
  });
  it('prevents customer A estimates from overwriting customer B', async () => {
    const a = deferred(); db.select.mockImplementation((_table, query) => query.includes('Alpha') ? a.promise : Promise.resolve([{ id: 'est-b', estimate_number: 'B-2' }]));
    await render(); await search('Alpha'); await act(async () => { btn('Alpha').click(); }); await act(async () => { btn('Change').click(); }); await search('Beta'); await act(async () => { btn('Beta').click(); await Promise.resolve(); });
    await act(async () => { a.resolve([{ id: 'est-a', estimate_number: 'A-1' }]); await Promise.resolve(); });
    expect(container.textContent).toContain('B-2'); expect(container.textContent).not.toContain('A-1');
  });
  it('serializes rapid create taps and calls onCreated once', async () => {
    await render(); await search('Customer'); await act(async () => { btn('Customer').click(); await Promise.resolve(); }); const create = btn('Create estimate');
    await act(async () => { create.click(); create.click(); await Promise.resolve(); });
    expect(db.rpc.mock.calls.filter(([name]) => name === 'create_estimate_for_contact')).toHaveLength(1); expect(onCreated).toHaveBeenCalledTimes(1); expect(mocks.selection).toHaveBeenCalled(); expect(mocks.impact).toHaveBeenCalledWith('light'); expect(mocks.notify).toHaveBeenCalledWith('success');
  });
  it('reports an accepted create that returns no estimate as a current visible error', async () => {
    db.rpc.mockImplementation((name, body) => name === 'get_insurance_carriers' ? Promise.resolve([]) : name === 'search_contacts_for_job' ? Promise.resolve([{ id: body.p_query, name: body.p_query }]) : Promise.resolve({}));
    await render(); await search('Customer'); await act(async () => { btn('Customer').click(); await Promise.resolve(); });
    await act(async () => { btn('Create estimate').click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.notify).toHaveBeenCalledWith('error'); expect(mocks.toast).toHaveBeenCalledWith('Could not open the estimate', 'error'); expect(onCreated).not.toHaveBeenCalled();
  });
  it('invalidates an active create if Change is triggered before the RPC resolves', async () => {
    const creation = deferred();
    db.rpc.mockImplementation((name, body) => name === 'get_insurance_carriers' ? Promise.resolve([]) : name === 'search_contacts_for_job' ? Promise.resolve([{ id: body.p_query, name: body.p_query }]) : creation.promise);
    await render(); await search('Customer'); await act(async () => { btn('Customer').click(); await Promise.resolve(); });
    const change = btn('Change'); const create = btn('Create estimate');
    await act(async () => { create.click(); change.click(); await Promise.resolve(); });
    await act(async () => { creation.resolve({ id: 'stale-estimate' }); await Promise.resolve(); await Promise.resolve(); });
    expect(onCreated).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector('#estimate-customer-search-input'));
  });
  it('does not call onCreated when create resolves after unmount', async () => {
    const creation = deferred(); db.rpc.mockImplementation((name, body) => name === 'get_insurance_carriers' ? Promise.resolve([]) : name === 'search_contacts_for_job' ? Promise.resolve([{ id: body.p_query, name: body.p_query }]) : creation.promise);
    await render(); await search('Customer'); await act(async () => { btn('Customer').click(); await Promise.resolve(); });
    await act(async () => { btn('Create estimate').click(); root.unmount(); creation.resolve({ id: 'late-estimate' }); await Promise.resolve(); });
    expect(onCreated).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled(); root = { unmount: () => {} };
  });
  it('does not update or toast when inline customer creation resolves after unmount', async () => {
    const insertion = deferred(); db.insert.mockReturnValue(insertion.promise);
    await render(); await act(async () => { btn('+ New customer').click(); await Promise.resolve(); });
    await act(async () => { btn('Save mocked customer').click(); root.unmount(); insertion.resolve({ id: 'late-contact', name: 'Late contact' }); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.toast).not.toHaveBeenCalled(); expect(onCreated).not.toHaveBeenCalled(); root = { unmount: () => {} };
  });
});
