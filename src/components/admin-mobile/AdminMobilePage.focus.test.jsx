// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: AdminMobilePage.focus.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   Focus moves to each Admin Mobile destination heading after navigation, but
 *   ordinary state renders leave the person at their current control.
 * ════════════════════════════════════════════════
 */
import { StrictMode, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AdminMobilePage from './AdminMobilePage';

let container;
let root;

function Destination({ title }) {
  const [updates, setUpdates] = useState(0);
  return (
    <AdminMobilePage title={title}>
      <button type="button" onClick={() => setUpdates((count) => count + 1)}>
        Update {updates}
      </button>
    </AdminMobilePage>
  );
}

function RouteControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" data-testid="document-to-line" onClick={() => navigate('/tech/admin/invoice/invoice-1/line/line-1')}>Open line</button>
      <button type="button" data-testid="line-to-document" onClick={() => navigate('/tech/admin/invoice/invoice-1')}>Back to invoice</button>
      <button type="button" data-testid="document-to-create" onClick={() => navigate('/tech/admin/invoice/new')}>New invoice</button>
      <button type="button" data-testid="create-to-detail" onClick={() => navigate('/tech/admin/invoice/invoice-2')}>Create invoice</button>
    </>
  );
}

function Harness() {
  return (
    <>
      <RouteControls />
      <Routes>
        <Route path="/tech/admin/invoice/new" element={<Destination title="New invoice" />} />
        <Route path="/tech/admin/invoice/:invoiceId/line/:lineId" element={<Destination title="Edit line item" />} />
        <Route path="/tech/admin/invoice/:invoiceId" element={<Destination title="Invoice details" />} />
      </Routes>
    </>
  );
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('AdminMobilePage route focus', () => {
  it('focuses document, line, back-like, and create destinations without stealing focus on rerender', async () => {
    await act(async () => {
      root.render(<StrictMode><MemoryRouter initialEntries={['/tech/admin/invoice/invoice-1']}><Harness /></MemoryRouter></StrictMode>);
    });
    expect(document.activeElement.textContent).toContain('Invoice details');

    const update = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Update 0');
    update.focus();
    await act(async () => { update.click(); });
    expect(document.activeElement).toBe(update);

    await act(async () => { container.querySelector('[data-testid="document-to-line"]').click(); });
    expect(document.activeElement.textContent).toContain('Edit line item');

    await act(async () => { container.querySelector('[data-testid="line-to-document"]').click(); });
    expect(document.activeElement.textContent).toContain('Invoice details');

    await act(async () => { container.querySelector('[data-testid="document-to-create"]').click(); });
    expect(document.activeElement.textContent).toContain('New invoice');

    await act(async () => { container.querySelector('[data-testid="create-to-detail"]').click(); });
    expect(document.activeElement.textContent).toContain('Invoice details');
  });
});
