// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: Modal.focus.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   A closing shared dialog remains modal for its visual exit, then releases body
 *   scroll and focus only after that exit completes.
 * ════════════════════════════════════════════════
 */
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Modal from './Modal';

let container;
let root;

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>Open</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Dialog">
        <button type="button">Dialog action</button>
      </Modal>
    </>
  );
}

function finishExit(panel) {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: 'uiModalOut' });
  panel.dispatchEvent(event);
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
  document.body.replaceChildren();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Modal exit accessibility lifecycle', () => {
  it('retains its focus trap and body scroll lock until the exit animation ends', async () => {
    await act(async () => { root.render(<Harness />); });
    const opener = container.querySelector('[data-testid="opener"]');
    opener.focus();

    await act(async () => { opener.click(); });
    const overlay = document.body.querySelector('.ui-modal-overlay');
    const panel = overlay.querySelector('.ui-modal');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.closest('.ui-modal')).toBe(panel);

    await act(async () => { panel.querySelector('.ui-modal-close').click(); });
    expect(document.body.querySelector('.ui-modal-overlay')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.closest('.ui-modal')).toBe(panel);

    await act(async () => { finishExit(panel); });
    expect(document.body.querySelector('.ui-modal-overlay')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
  });
});
