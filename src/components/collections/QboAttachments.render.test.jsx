// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: QboAttachments.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the P4c containment seam: QuickBooks attachment metadata remains
 *   readable and retryable, but this client component exposes no change path.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (component render test)
 *   Rendered by:  test directly renders QboAttachments.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, vitest
 *   Internal:  ./QboAttachments.jsx (AuthContext is mocked)
 *   Data:      reads → mocked qbo_attachments selection
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The happy-dom directive must remain before this header for Vitest.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ db: { select: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ db: mocks.db }) }));

import QboAttachments from './QboAttachments.jsx';

let container;
let root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mocks.db.select.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

async function render({ entityType = 'invoice', entityId = 'invoice-1' } = {}) {
  await act(async () => {
    root.render(<QboAttachments entityType={entityType} entityId={entityId} synced canEdit />);
    await Promise.resolve();
  });
}

describe('QboAttachments P4c containment', () => {
  it('lists attachment metadata and clearly announces the temporary read-only state', async () => {
    mocks.db.select.mockResolvedValueOnce([{ id: 'attachment-1', file_name: 'signed-scope.pdf', file_size: 1536, include_on_send: true }]);
    await render();
    expect(mocks.db.select).toHaveBeenCalledWith('qbo_attachments', 'invoice_id=eq.invoice-1&order=created_at.desc');
    expect(container.textContent).toContain('signed-scope.pdf');
    expect(container.textContent).toContain('2 KB');
    expect(container.textContent).toContain('Included when sent');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('temporarily unavailable');
  });

  it('shows a retryable load error instead of the successful empty state', async () => {
    mocks.db.select.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load attachments.');
    expect(container.textContent).not.toContain('No attachment metadata is available');
    await act(async () => { container.querySelector('button').click(); await Promise.resolve(); });
    expect(mocks.db.select).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('No attachment metadata is available for this invoice.');
  });

  it('drops deferred metadata from the previous route after an entity switch', async () => {
    let resolveFirst;
    mocks.db.select
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([{ id: 'attachment-2', file_name: 'estimate-photo.jpg' }]);
    await render({ entityId: 'invoice-1' });
    await render({ entityType: 'estimate', entityId: 'estimate-2' });
    expect(container.textContent).not.toContain('old-invoice.pdf');
    await act(async () => { resolveFirst([{ id: 'attachment-1', file_name: 'old-invoice.pdf' }]); await Promise.resolve(); });
    expect(container.textContent).toContain('estimate-photo.jpg');
    expect(container.textContent).not.toContain('old-invoice.pdf');
  });

  it('contains no client-side attachment mutation controls or request path', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/components/collections/QboAttachments.jsx'), 'utf8');
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('getAuthHeader');
    expect(source).not.toContain('useTwoClickConfirm');
    expect(source).not.toContain('type="file"');
    expect(source).not.toContain('Attach file');
    expect(source).not.toContain('Remove');
  });
});
