// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceCreate.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the new-invoice screen while people find a customer and choose a
 *   job. It verifies that search results, loading problems, and repeated taps
 *   lead to one clear, safe outcome.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/invoice/new
 *   Rendered by:  Vitest
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, react-router-dom, vitest
 *   Internal:  ./AdminInvoiceCreate, @/contexts/AuthContext, @/lib/toast, @/lib/nativeHaptics
 *   Data:      reads  → mocked search_contacts_for_job and get_customer_detail RPC results
 *              writes → mocked create_invoice_for_job RPC
 *
 * NOTES / GOTCHAS:
 *   - Uses fake time to cover the customer-search wait without slowing the test.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminInvoiceCreate from './AdminInvoiceCreate';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), enabled: vi.fn(), navigate: vi.fn(), err: vi.fn(), impact: vi.fn(), notify: vi.fn(), selection: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: { rpc: mocks.rpc }, employee: { id: 'employee-1' }, isFeatureEnabled: mocks.enabled }) }));
vi.mock('@/lib/toast', () => ({ err: mocks.err }));
vi.mock('@/lib/nativeHaptics', () => ({ impact: mocks.impact, notify: mocks.notify, selection: mocks.selection }));
vi.mock('react-router-dom', async (original) => ({ ...await original(), useNavigate: () => mocks.navigate }));

let root; let container;
const deferred = () => { let resolve; let reject; const promise = new Promise((next, fail) => { resolve = next; reject = fail; }); return { promise, resolve, reject }; };
async function render() { await act(async () => { root.render(<MemoryRouter><AdminInvoiceCreate /></MemoryRouter>); }); }
async function search(name) {
  const input = container.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(301);
    await Promise.resolve(); await Promise.resolve();
  });
}

beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); mocks.enabled.mockReturnValue(true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => { root.unmount(); }); container.remove(); vi.useRealTimers(); vi.clearAllMocks(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

describe('AdminInvoiceCreate', () => {
  it('fails before every read when billing is off', async () => { mocks.enabled.mockReturnValue(false); await render(); expect(container.textContent).toContain('Billing is turned off'); expect(mocks.rpc).not.toHaveBeenCalled(); });

  it('announces search results and restores focus across choose/change', async () => {
    mocks.rpc.mockImplementation((name) => name === 'search_contacts_for_job' ? Promise.resolve([{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]) : Promise.resolve({ claims: [{ id: 'claim', jobs: [{ id: 'job', job_number: 'J-1' }] }] }));
    await render(); await search('customer');
    expect(container.querySelector('[role="status"]').textContent).toBe('2 customers found.');
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent.includes('One')).click(); await Promise.resolve(); });
    expect(document.activeElement).toBe(container.querySelector('#invoice-job-select'));
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === 'Change').click(); await Promise.resolve(); });
    expect(document.activeElement).toBe(container.querySelector('#invoice-customer-input'));
  });

  it('politely announces an empty customer result', async () => {
    mocks.rpc.mockResolvedValue([]); await render(); await search('missing');
    const status = container.querySelector('[role="status"]'); expect(status.getAttribute('aria-live')).toBe('polite'); expect(status.textContent).toBe('No customers found.');
  });

  it('renders a retryable search error instead of reporting a failed request as no results', async () => {
    let attempts = 0;
    mocks.rpc.mockImplementation(() => attempts++ === 0 ? Promise.reject(new Error('offline')) : Promise.resolve([]));
    await render(); await search('missing');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Customer search failed');
    expect(container.textContent).not.toContain('No customers found.');
    await act(async () => { [...container.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('Retry search')).click(); await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('No customers found.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.err).not.toHaveBeenCalled();
  });

  it('keeps the newest customer jobs when an older load resolves late', async () => {
    const a = deferred();
    mocks.rpc.mockImplementation((name, body) => {
      if (name === 'search_contacts_for_job') return Promise.resolve([{ id: body.p_query, name: body.p_query }]);
      if (name === 'get_customer_detail' && body.p_contact_id === 'Alpha') return a.promise;
      if (name === 'get_customer_detail') return Promise.resolve({ claims: [{ id: 'c-b', jobs: [{ id: 'job-b', job_number: 'B-2' }] }] });
      return Promise.resolve(null);
    });
    await render(); await search('Alpha'); await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Alpha')).click(); });
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === 'Change').click(); });
    await search('Beta'); await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Beta')).click(); await Promise.resolve(); });
    await act(async () => { a.resolve({ claims: [{ id: 'c-a', jobs: [{ id: 'job-a', job_number: 'A-1' }] }] }); await Promise.resolve(); });
    expect(container.textContent).toContain('B-2'); expect(container.textContent).not.toContain('A-1');
  });

  it('serializes double create and navigates the returned existing-or-new invoice id', async () => {
    mocks.rpc.mockImplementation((name) => name === 'search_contacts_for_job' ? Promise.resolve([{ id: 'customer', name: 'Customer' }]) : name === 'get_customer_detail' ? Promise.resolve({ claims: [{ id: 'claim', jobs: [{ id: 'job', job_number: 'J-1' }] }] }) : Promise.resolve({ id: 'invoice-existing' }));
    await render(); await search('Customer'); await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Customer')).click(); await Promise.resolve(); });
    const open = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Open'));
    await act(async () => { open.click(); open.click(); await Promise.resolve(); });
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'create_invoice_for_job')).toEqual([['create_invoice_for_job', { p_job_id: 'job', p_created_by: 'employee-1' }]]);
    expect(mocks.navigate).toHaveBeenCalledWith('/tech/admin/invoice/invoice-existing', { replace: true });
    expect(mocks.selection).toHaveBeenCalled(); expect(mocks.impact).toHaveBeenCalledWith('light'); expect(mocks.notify).toHaveBeenCalledWith('success');
  });

  it('reports an accepted create that returns no invoice as a current visible error', async () => {
    mocks.rpc.mockImplementation((name) => name === 'search_contacts_for_job' ? Promise.resolve([{ id: 'customer', name: 'Customer' }]) : name === 'get_customer_detail' ? Promise.resolve({ claims: [{ id: 'claim', jobs: [{ id: 'job', job_number: 'J-1' }] }] }) : Promise.resolve({}));
    await render(); await search('Customer'); await act(async () => { [...container.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('Customer')).click(); await Promise.resolve(); });
    await act(async () => { [...container.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('Open')).click(); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.notify).toHaveBeenCalledWith('error'); expect(mocks.err).toHaveBeenCalledWith('Failed to create invoice: Could not open the invoice.'); expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('invalidates an active create if Change is triggered before the RPC resolves', async () => {
    const creation = deferred();
    mocks.rpc.mockImplementation((name) => name === 'search_contacts_for_job' ? Promise.resolve([{ id: 'customer', name: 'Customer' }]) : name === 'get_customer_detail' ? Promise.resolve({ claims: [{ id: 'claim', jobs: [{ id: 'job', job_number: 'J-1' }] }] }) : creation.promise);
    await render(); await search('Customer'); await act(async () => { [...container.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('Customer')).click(); await Promise.resolve(); });
    const change = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Change');
    const open = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent.includes('Open'));
    await act(async () => { open.click(); change.click(); await Promise.resolve(); });
    await act(async () => { creation.resolve({ id: 'stale-invoice' }); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(container.querySelector('#invoice-customer-input'));
  });

  it('does not navigate when create resolves after unmount', async () => {
    const create = deferred();
    mocks.rpc.mockImplementation((name) => name === 'search_contacts_for_job' ? Promise.resolve([{ id: 'customer', name: 'Customer' }]) : name === 'get_customer_detail' ? Promise.resolve({ claims: [{ id: 'claim', jobs: [{ id: 'job', job_number: 'J-1' }] }] }) : create.promise);
    await render(); await search('Customer'); await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Customer')).click(); await Promise.resolve(); });
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Open')).click(); root.unmount(); create.resolve({ id: 'late' }); await Promise.resolve(); });
    expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
    root = { unmount: () => {} };
  });
});
