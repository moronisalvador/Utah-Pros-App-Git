// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: InvoiceLineEditor.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   The focused native invoice-line form exposes every editable source field,
 *   a live amount, and one explicit human QuickBooks-save action without
 *   add/remove controls.
 * ════════════════════════════════════════════════
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import InvoiceLineEditor from './InvoiceLineEditor';

vi.mock('@/lib/nativeHaptics', () => ({ impact: vi.fn() }));
import { impact } from '@/lib/nativeHaptics';

const line = {
  id: 'line-1',
  description: 'Drywall repair',
  qbo_item_id: '42',
  qbo_item_name: 'Labor',
  qbo_class_id: '7',
  qbo_class_name: 'Reconstruction',
  quantity: 2,
  unit_price: 125.5,
  line_total: 251,
};

describe('InvoiceLineEditor render', () => {
  it('renders a focused line form with no destructive or collection actions', () => {
    const html = renderToStaticMarkup(
      <InvoiceLineEditor
        line={line}
        items={[{ id: '42', name: 'Labor' }]}
        classes={[{ id: '7', name: 'Reconstruction' }]}
        qboInvoiceId="qbo-1"
        busy={false}
        onPatch={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('Labor');
    expect(html).toContain('Drywall repair');
    expect(html).toContain('Reconstruction');
    expect(html).toContain('251.00');
    expect(html).toContain('Update QuickBooks');
    expect(html).toContain('am-invline-editor');
    expect(html).toContain('am-invline-picker');
    expect(html).not.toContain('am-estb-line');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('Remove');
    expect(html).not.toContain('Add line');
    expect(html).not.toContain('Record payment');
  });

  it('labels an unsynced invoice as a first Save-to-QuickBooks command', () => {
    const html = renderToStaticMarkup(
      <InvoiceLineEditor line={line} items={[]} classes={[]} busy={false} onPatch={vi.fn()} onSave={vi.fn()} />,
    );
    expect(html).toContain('Save to QuickBooks');
  });

  it('saves only through the visible button, never from an implicit form submit', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const onSave = vi.fn();
    document.body.append(container);

    await act(async () => {
      root.render(<InvoiceLineEditor line={line} items={[]} classes={[]} busy={false} onPatch={vi.fn()} onSave={onSave} />);
    });
    const form = container.querySelector('form');
    const description = container.querySelector('.am-invline-input--description');
    const rate = container.querySelector('.am-invline-field--rate input');
    const itemTrigger = container.querySelector('.am-invline-picker-btn');

    // These are the browser actions Enter can produce for an input and an
    // inline picker search inside a form. They must remain local.
    await act(async () => {
      description.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      rate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(impact).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => { itemTrigger.click(); });
    expect(impact).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith('light');
    impact.mockClear();

    const search = container.querySelector('.am-invline-picker-search');
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(impact).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    const save = container.querySelector('.am-invline-submit');
    expect(save.type).toBe('button');
    // Native buttons expose the same click activation for mouse, Enter, and
    // Space. happy-dom does not synthesize that browser click from keydown, so
    // model the platform's resulting activation explicitly.
    await act(async () => {
      save.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      save.click();
    });

    expect(impact).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
});
