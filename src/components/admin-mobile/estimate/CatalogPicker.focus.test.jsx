// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: CatalogPicker.focus.test.jsx  (Admin Mobile — picker focus contract)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   The inline catalog picker keeps its labelled trigger and popup relationship
 *   stable, and always returns focus to that trigger after a choice, clear, or
 *   explicit close.
 * ════════════════════════════════════════════════
 */
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogPicker from './CatalogPicker';

const mocks = vi.hoisted(() => ({ impact: vi.fn(), selection: vi.fn() }));

vi.mock('@/lib/nativeHaptics', () => ({
  impact: mocks.impact,
  selection: mocks.selection,
}));

let container;
let root;

function Harness() {
  const [choice, setChoice] = useState({ id: 'labor', name: 'Labor' });
  return <CatalogPicker
    label="Item"
    value={choice?.id || null}
    valueName={choice?.name || null}
    options={[{ id: 'labor', name: 'Labor' }, { id: 'materials', name: 'Materials' }]}
    onChange={setChoice}
  />;
}

function BusyHarness() {
  const [choice, setChoice] = useState({ id: 'labor', name: 'Labor' });
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setBusy(true)}>Start save</button>
      <output>{choice?.name || 'None'}</output>
      <CatalogPicker
        label="Item"
        value={choice?.id || null}
        valueName={choice?.name || null}
        options={[{ id: 'labor', name: 'Labor' }, { id: 'materials', name: 'Materials' }]}
        disabled={busy}
        onChange={setChoice}
      />
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
  vi.clearAllMocks();
});

async function click(element) {
  await act(async () => { element.click(); });
}

describe('CatalogPicker focus lifecycle', () => {
  it('labels and controls a stable popup, then restores focus after close, choose, and clear', async () => {
    await act(async () => { root.render(<Harness />); });
    const trigger = container.querySelector('button');
    expect(trigger.getAttribute('aria-label')).toContain('Item: Labor');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await click(trigger);
    expect(mocks.impact).toHaveBeenLastCalledWith('light');
    const popupId = trigger.getAttribute('aria-controls');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(popupId)).not.toBeNull();
    expect(container.querySelector('input').getAttribute('aria-label')).toBe('Search Item');

    await click(trigger);
    expect(document.activeElement).toBe(trigger);

    await click(trigger);
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Materials'));
    expect(mocks.selection).toHaveBeenLastCalledWith();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-controls')).toBe(popupId);

    await click(trigger);
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear item'));
    expect(mocks.selection).toHaveBeenLastCalledWith();
    expect(document.activeElement).toBe(trigger);

    await click(trigger);
    const option = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Materials');
    option.focus();
    await act(async () => {
      option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes an open popup and ignores a stale option click when saving starts', async () => {
    await act(async () => { root.render(<BusyHarness />); });
    const trigger = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('Labor'));
    await click(trigger);
    const materials = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Materials');
    expect(materials).not.toBeNull();

    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Start save'));
    expect(container.querySelector('input')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.disabled).toBe(true);

    mocks.selection.mockClear();
    await click(materials);
    expect(container.querySelector('output').textContent).toBe('Labor');
    expect(mocks.selection).not.toHaveBeenCalled();
  });
});
