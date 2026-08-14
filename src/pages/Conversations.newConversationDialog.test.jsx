// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: Conversations.newConversationDialog.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   The "New Conversation" pop-up on the Messages page. It checks two things: that
 *   opening it puts the cursor straight in the search box (not on the ✕ button), and
 *   that the page still builds the pop-up out of the shared dialog component instead
 *   of hand-rolling one — which is what gives it a screen-reader label, a keyboard
 *   focus trap, and Escape-to-close for free.
 *
 * DEPENDS ON:
 *   Packages:  react, react-dom/client, vitest
 *   Internal:  @/components/ui/Modal, src/pages/Conversations.jsx (read as source)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Two different kinds of proof, deliberately. The render case proves the MECHANISM
 *     (a parent effect beats Modal's own focus effect) and would fail if Modal ever
 *     moved its focus call into a layout effect. The source case proves this PAGE is
 *     still wired that way — the render case alone would keep passing if someone
 *     reverted Conversations.jsx to a hand-rolled div.
 *   - The page itself is not rendered here: it pulls in AuthContext, realtime and i18n,
 *     so a full mount would be mock-heavy and would test those, not this dialog.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Modal from '@/components/ui/Modal';

const SOURCE = readFileSync(
  path.resolve(import.meta.dirname, 'Conversations.jsx'),
  'utf8',
);

let container;
let root;

// Mirrors the page's composition: shared Modal, a pinned search field held by a ref,
// and the parent effect that returns focus to it after Modal focuses its own ✕.
function Harness() {
  const [open, setOpen] = useState(false);
  const searchRef = useRef(null);
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>New</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New Conversation"
        size="sm"
        className="conv-new-modal"
      >
        <div className="conv-new-modal__search">
          <input ref={searchRef} data-testid="search" className="input" aria-label="Search contacts" />
        </div>
        <div className="conv-new-modal__list">
          <button type="button" data-testid="contact">A contact</button>
        </div>
      </Modal>
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

describe('New Conversation dialog — focus mechanism', () => {
  it('opens with the caret in the search field, not on the close button', async () => {
    await act(async () => { root.render(<Harness />); });
    const opener = container.querySelector('[data-testid="opener"]');
    opener.focus();

    await act(async () => { opener.click(); });

    // Modal focuses the first focusable in its panel — the ✕ — so without the parent
    // effect this lands on '.ui-modal-close' and the search box never gets the caret.
    //
    // IF YOU ARE HERE AFTER EDITING Modal.jsx: this page overrides Modal's initial
    // focus by relying on child effects committing before parent ones. Promoting
    // Modal's focus call to useLayoutEffect (or otherwise deferring it) breaks that
    // and every search-in-a-dialog silently opens focused on Close. The durable fix
    // is an opt-in `initialFocusRef` prop on Modal, not a change here.
    expect(document.activeElement?.getAttribute('data-testid')).toBe('search');
  });

  it('is a real dialog: role, aria-modal and an accessible name from the title', async () => {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { container.querySelector('[data-testid="opener"]').click(); });

    const panel = document.body.querySelector('.ui-modal');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy)?.textContent).toBe('New Conversation');
  });

  it('closes on Escape', async () => {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { container.querySelector('[data-testid="opener"]').click(); });
    expect(document.body.querySelector('.ui-modal')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    // Modal keeps the panel mounted for its exit animation, then unmounts; either the
    // panel is gone or it is visibly closing. Both mean Escape was honoured.
    const panel = document.body.querySelector('.ui-modal');
    expect(panel === null || panel.className.includes('ui-modal--closing')).toBe(true);
  });
});

describe('New Conversation dialog — page wiring', () => {
  it('builds the dialog from the shared Modal, not a hand-rolled backdrop', () => {
    expect(SOURCE).toMatch(/<Modal\s[\s\S]*?className="conv-new-modal"/);
    expect(SOURCE).toContain("import { ErrorState, Modal } from '@/components/ui'");
  });

  it('no longer hand-rolls a backdrop for this dialog', () => {
    // The .conv-modal* kit is still used by seven other components, so this asserts
    // only that THIS page stopped using it — not that the CSS is gone.
    expect(SOURCE).not.toContain('conv-modal-backdrop');
  });

  it('keeps the search field focused on open', () => {
    // Guards the whole chain: the ref exists, it is attached to the input, and an
    // effect keyed on showNewConv focuses it.
    expect(SOURCE).toContain('const newConvSearchRef = useRef(null)');
    expect(SOURCE).toContain('ref={newConvSearchRef}');
    expect(SOURCE).toMatch(/if \(showNewConv\) newConvSearchRef\.current\?\.focus\(\);/);
  });
});
