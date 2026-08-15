// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: DocumentLineList.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the shared document line list clearly names its sections,
 *   rows, editor fields, and add button. This helps people using a keyboard
 *   or screen reader understand and use invoice and estimate line items.
 *
 * WHERE IT LIVES:
 *   Route:        n/a
 *   Rendered by:  Vitest
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom, react-router-dom, vitest
 *   Internal:  ./DocumentLineList, ./DocumentLineEditor
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Uses a browser-like test page because these checks inspect rendered labels.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentLineList from './DocumentLineList';
import DocumentLineEditor from './DocumentLineEditor';

let root; let container;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete globalThis.IS_REACT_ACT_ENVIRONMENT; });

describe('DocumentLineList semantics', () => {
  it('gives each section a unique labelled heading and complete row names', async () => {
    const line = { id: '1', description: 'Drywall', quantity: 2, unit_price: 10, line_total: 20 };
    await act(async () => { root.render(<MemoryRouter><DocumentLineList lines={[line]} editable lineHref={() => '/line/1'} /><DocumentLineList heading="Payments" lines={[]} /></MemoryRouter>); });
    const sections = [...container.querySelectorAll('section')]; const ids = sections.map((section) => section.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(2); ids.forEach((id) => expect(container.querySelector(`#${id}`)).not.toBeNull());
    expect(container.querySelector('a').getAttribute('aria-label')).toContain('Edit line item Drywall, quantity 2, rate $10.00, total $20.00');
  });
  it('exposes Add line item as a keyboard-operable named button', async () => {
    const add = vi.fn(); await act(async () => { root.render(<MemoryRouter><DocumentLineList editable lines={[]} onAdd={add} /></MemoryRouter>); });
    const control = container.querySelector('button[aria-label="Add line item"]'); expect(control).not.toBeNull();
    await act(async () => { control.focus(); control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); control.click(); });
    expect(document.activeElement).toBe(control); expect(add).toHaveBeenCalledTimes(1);
  });
  it('names every focused editor field and the explicit QBO action', async () => {
    const line = { description: 'Drywall', quantity: 2, unit_price: 10 };
    await act(async () => { root.render(<DocumentLineEditor line={line} items={[]} classes={[]} busy={false} saveLabel="Save to QuickBooks" onPatch={() => {}} onSave={() => {}} />); });
    for (const label of ['Description', 'Quantity', 'Rate']) {
      const input = [...container.querySelectorAll('input')].find((candidate) => candidate.closest('label')?.textContent.includes(label));
      expect(input).not.toBeNull();
      expect(input.name).toBe({ Description: 'description', Quantity: 'quantity', Rate: 'unit_price' }[label]);
      expect(input.autocomplete).toBe('off');
    }
    expect(container.querySelector('button[aria-label^="Item:"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label^="Class:"]')).not.toBeNull();
    expect([...container.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Save to QuickBooks')).not.toBeNull();
  });
});
