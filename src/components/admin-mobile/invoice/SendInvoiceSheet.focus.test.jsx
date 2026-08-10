// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: SendInvoiceSheet.focus.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   The mobile invoice send dialog lives outside the shell scroller, makes that
 *   scroller inert while open, and reliably returns focus to its Send trigger.
 * ════════════════════════════════════════════════
 */
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SendInvoiceSheet from './SendInvoiceSheet';
import { impact } from '@/lib/nativeHaptics';

vi.mock('@/lib/nativeHaptics', () => ({ impact: vi.fn() }));

let container;
let root;

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div className="tech-layout">
      <main
        className="tech-content"
        aria-hidden="false"
        style={{ overflow: 'auto', touchAction: 'pan-y' }}
      >
        <button type="button" data-testid="send-trigger" onClick={() => setOpen(true)}>
          Send invoice
        </button>
        <SendInvoiceSheet
          open={open}
          onClose={() => setOpen(false)}
          onSend={() => {}}
          invoiceNumber="INV-1042"
          recipient="billing@example.com"
        />
      </main>
    </div>
  );
}

function BusyHarness({ onClose = () => {}, onSend = () => {} }) {
  return (
    <div className="tech-layout">
      <main className="tech-content">
        <button type="button">Background control</button>
        <SendInvoiceSheet
          open
          busy
          onClose={onClose}
          onSend={onSend}
          invoiceNumber="INV-1042"
          recipient="billing@example.com"
        />
      </main>
    </div>
  );
}

function finishSheetExit(panel) {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: 'uiSheetDown' });
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
  vi.clearAllMocks();
});

describe('SendInvoiceSheet focus lifecycle', () => {
  it('keeps the shell inert and focus trapped through exit, then restores the opener', async () => {
    await act(async () => { root.render(<Harness />); });

    const trigger = container.querySelector('[data-testid="send-trigger"]');
    const content = container.querySelector('.tech-content');
    trigger.focus();

    await act(async () => { trigger.click(); });

    const overlay = document.body.querySelector('.ui-modal-overlay');
    expect(overlay?.parentElement).toBe(document.body);
    expect(container.querySelector('.ui-modal-overlay')).toBeNull();
    expect(content.inert).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('true');
    expect(content.style.overflow).toBe('hidden');
    expect(content.style.touchAction).toBe('none');
    expect(document.activeElement?.closest('.ui-modal')).not.toBeNull();

    await act(async () => { overlay.querySelector('.btn-secondary').click(); });

    const closingOverlay = document.body.querySelector('.ui-modal-overlay');
    const closingPanel = closingOverlay.querySelector('.ui-modal');
    expect(closingOverlay.className).toContain('ui-modal-overlay--closing');
    expect(content.inert).toBe(true);
    expect(content.getAttribute('aria-hidden')).toBe('true');
    expect(content.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement?.closest('.ui-modal')).not.toBeNull();

    await act(async () => { finishSheetExit(closingPanel); });

    expect(document.body.querySelector('.ui-modal-overlay')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(content.inert).toBe(false);
    expect(content.getAttribute('aria-hidden')).toBe('false');
    expect(content.style.overflow).toBe('auto');
    expect(content.style.touchAction).toBe('pan-y');
  });

  it('does not expose a no-op close path while send is busy', async () => {
    const onClose = vi.fn();
    await act(async () => { root.render(<BusyHarness onClose={onClose} />); });

    const overlay = document.body.querySelector('.ui-modal-overlay');
    const close = overlay.querySelector('.ui-modal-close');
    const cancel = overlay.querySelector('.btn-secondary');
    expect(close.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);

    await act(async () => {
      close.click();
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(impact).not.toHaveBeenCalled();
    expect(document.body.querySelector('.ui-modal-overlay')).not.toBeNull();
  });

  it('uses a light haptic only for explicit Cancel, never X', async () => {
    const onClose = vi.fn();
    await act(async () => { root.render(
      <div className="tech-layout">
        <main className="tech-content">
          <SendInvoiceSheet open onClose={onClose} onSend={() => {}} invoiceNumber="INV-1042" recipient="billing@example.com" />
        </main>
      </div>,
    ); });

    const overlay = document.body.querySelector('.ui-modal-overlay');
    await act(async () => { overlay.querySelector('.ui-modal-close').click(); });
    expect(impact).not.toHaveBeenCalled();

    await act(async () => { overlay.querySelector('.btn-secondary').click(); });
    expect(impact).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith('light');
  });
});
