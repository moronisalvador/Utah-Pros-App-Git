// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: InvoicePaymentFlow.render.test.jsx  (Admin Mobile payment flow smoke test)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES: Guards the essential first paint: a route-specific invoice
 * opens on Amount with its exact current balance pre-filled.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InvoicePaymentFlow from './InvoicePaymentFlow';

vi.mock('@/lib/nativeHaptics', () => ({ impact: vi.fn(), selection: vi.fn() }));
vi.mock('@/lib/companyDate', () => ({
  todayInCompanyTimeZone: () => '2026-08-09',
  formatCompanyDate: (value) => (value === '2026-08-09' ? 'Aug 9, 2026' : '—'),
}));

const invoice = { id: 'inv-1', invoice_number: 'INV-100', balance_cents: 64_950 };
const contact = { id: 'contact-1', name: 'Ava' };
const paymentData = {
  payment_methods: [{ id: 'cash', name: 'Cash', type: 'cash' }],
  deposit_accounts: [{ id: 'bank-1', name: 'Operating', account_type: 'Bank' }],
};

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

beforeEach(() => stubLocalStorage());

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  root = null;
  container = null;
  globalThis.localStorage?.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function click(selector) {
  await act(async () => { container.querySelector(selector).click(); });
}

describe('InvoicePaymentFlow render', () => {
  it('starts on Amount with the exact open balance pre-filled', () => {
    const html = renderToStaticMarkup(<InvoicePaymentFlow invoice={invoice} contact={contact} paymentData={{ payment_methods: [], deposit_accounts: [] }} submitting={false} onBack={() => {}} onSubmit={() => {}} />);
    expect(html).toContain('Amount to receive');
    expect(html).toContain('value="649.50"');
    expect(html).toContain('Payment method');
  });

  it('submits one durable request when confirm is double-tapped before React re-renders', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onSubmit = vi.fn(async () => {});

    await act(async () => {
      root.render(<InvoicePaymentFlow invoice={invoice} contact={contact} paymentData={paymentData} actorId="employee-1" submitting={false} onBack={() => {}} onSubmit={onSubmit} />);
    });
    await click('.am-inv-btn--primary');
    await click('.am-inv-chip-btn');
    await click('.am-inv-btn--primary');
    const dateRow = [...container.querySelectorAll('.am-pay-summary > div')]
      .find((row) => row.querySelector('span')?.textContent === 'Date');
    expect(dateRow?.querySelector('strong')?.textContent).toBe('Aug 9, 2026');
    expect(dateRow?.textContent).not.toContain('2026-08-09');
    // First click arms the intentional two-tap confirmation.
    await click('.am-inv-btn--primary');

    const confirm = container.querySelector('.am-inv-btn--primary');
    await act(async () => {
      confirm.click();
      confirm.click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].client_request_id).toEqual(expect.any(String));
    expect(onSubmit.mock.calls[0][0].payment_date).toBe('2026-08-09');
  });

  it('keeps the review step inert while its submit promise is unresolved', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let resolveSubmit;
    const onSubmit = vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve; }));

    await act(async () => {
      root.render(<InvoicePaymentFlow invoice={invoice} contact={contact} paymentData={paymentData} actorId="employee-1" submitting={false} onBack={() => {}} onSubmit={onSubmit} />);
    });
    await click('.am-inv-btn--primary');
    await click('.am-inv-chip-btn');
    await click('.am-inv-btn--primary');
    const confirm = container.querySelector('.am-inv-btn--primary');
    await act(async () => {
      confirm.click(); // Arm the deliberate second confirmation.
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector('.am-inv-btn--primary').click();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.am-pay-flow').getAttribute('aria-busy')).toBe('true');
    const back = container.querySelector('.am-pay-back');
    expect(back.disabled).toBe(true);
    await click('.am-pay-back');
    expect(container.querySelector('.am-pay-step-title').textContent).toBe('Confirm payment');

    await act(async () => { resolveSubmit(); });
    expect(container.querySelector('.am-pay-flow').getAttribute('aria-busy')).toBeNull();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
});
