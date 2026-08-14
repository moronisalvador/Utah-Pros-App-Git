// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: Modal.initialFocus.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   Two things the shared pop-up learned when the seven hand-rolled dialogs moved
 *   onto it. First, that a dialog can say which box the cursor should start in —
 *   without that, every search-led dialog opens with the cursor on the ✕ button and
 *   typing goes nowhere. Second, that when one pop-up opens on top of another
 *   (New Job → New Contact), pressing Escape closes only the top one instead of
 *   throwing away the half-filled form underneath.
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom/client, vitest
 *   Internal:  ./Modal
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - The fallback cases matter as much as the happy path: three of the migrated
 *     dialogs only render their search field in one of two modes, so the ref is
 *     legitimately empty half the time and Modal must not be left focusing nothing.
 *   - The nesting case cannot be proved with stopPropagation. Both dialogs add
 *     their own capture-phase listener to `document`, and stopPropagation does not
 *     stop sibling listeners on the SAME node — only a stack of who is on top does.
 *     tests/qa/unit/dialog-lifecycle.test.js has a case named for this guarantee
 *     that only asserts stopPropagation is present, so it would pass either way.
 * ════════════════════════════════════════════════
 */
import { act, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Modal from './Modal';

let container;
let root;

const activeTestId = () => document.activeElement?.getAttribute('data-testid');
const pressEscape = () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

// `mode` mirrors the real shape: the search field exists in one mode only, so the
// ref is populated or empty exactly as it is in NewInvoiceModal / NewEstimateModal.
function FocusHarness({ mode = 'search', pointOutside = false }) {
  const searchRef = useRef(null);
  const outsideRef = useRef(null);
  return (
    <>
      <input data-testid="outside" ref={outsideRef} />
      <Modal open onClose={() => {}} title="Pick a customer" initialFocusRef={pointOutside ? outsideRef : searchRef}>
        {mode === 'search'
          ? <input data-testid="search" ref={searchRef} aria-label="Search" />
          : <button type="button" data-testid="row">A customer</button>}
      </Modal>
    </>
  );
}

function NestedHarness() {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <>
      {outerOpen && (
        <Modal open onClose={() => setOuterOpen(false)} title="New Job">
          <button type="button" data-testid="add-contact" onClick={() => setInnerOpen(true)}>New contact</button>
        </Modal>
      )}
      {innerOpen && (
        <Modal open onClose={() => setInnerOpen(false)} title="New Contact">
          <input data-testid="contact-name" aria-label="Name" />
        </Modal>
      )}
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
  document.body.replaceChildren();
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('Modal initialFocusRef', () => {
  it('puts the caret in the named field instead of the close button', async () => {
    await act(async () => { root.render(<FocusHarness mode="search" />); });
    expect(activeTestId()).toBe('search');
  });

  it('falls back to the first focusable when the field is not rendered', async () => {
    // Customer-scoped mode: no search box exists, so the ref is empty. Modal must
    // still move focus INTO the dialog rather than leaving it on the page behind.
    await act(async () => { root.render(<FocusHarness mode="picked" />); });
    const panel = document.body.querySelector('.ui-modal');
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement.classList.contains('ui-modal-close')).toBe(true);
  });

  it('refuses a ref pointing outside the panel, so the focus trap cannot be broken', async () => {
    await act(async () => { root.render(<FocusHarness mode="search" pointOutside />); });
    const panel = document.body.querySelector('.ui-modal');
    expect(activeTestId()).not.toBe('outside');
    expect(panel.contains(document.activeElement)).toBe(true);
  });
});

describe('Modal nesting — Escape closes only the innermost dialog', () => {
  it('leaves the parent form open when the nested dialog is dismissed', async () => {
    await act(async () => { root.render(<NestedHarness />); });
    expect(document.body.querySelectorAll('.ui-modal')).toHaveLength(1);

    await act(async () => { document.querySelector('[data-testid="add-contact"]').click(); });
    expect(document.body.querySelectorAll('.ui-modal')).toHaveLength(2);

    await act(async () => { pressEscape(); });

    // The half-filled New Job form must survive: exactly one dialog left, and it
    // is the parent. Before the open-stack this closed BOTH.
    const panels = document.body.querySelectorAll('.ui-modal');
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toContain('New Job');
  });

  it('hands control back to the parent once the nested dialog is gone', async () => {
    await act(async () => { root.render(<NestedHarness />); });
    await act(async () => { document.querySelector('[data-testid="add-contact"]').click(); });
    await act(async () => { pressEscape(); });
    await act(async () => { pressEscape(); });

    expect(document.body.querySelectorAll('.ui-modal')).toHaveLength(0);
  });
});
