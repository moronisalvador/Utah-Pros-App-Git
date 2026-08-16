/**
 * ════════════════════════════════════════════════
 * FILE: SendInvoiceSheet.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Confirms the outward QuickBooks email action from an admin-mobile invoice.
 *   Opening the sheet is only review; the full-width Send button is the action.
 *
 * DEPENDS ON:
 *   Internal: @/components/ui/Modal, @/lib/nativeHaptics
 *   Data: none (all values and callbacks arrive as props)
 * ════════════════════════════════════════════════
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from '@/components/ui/Modal';
import { impact } from '@/lib/nativeHaptics';

function findTechLayout() {
  if (typeof document === 'undefined') return null;
  return document.activeElement?.closest?.('.tech-layout')
    || document.querySelector('.tech-layout');
}

function findScrollableTechContent(layout) {
  if (layout) {
    return Array.from(layout.children).find((child) => child.classList?.contains('tech-content')) || null;
  }
  return typeof document === 'undefined' ? null : document.querySelector('.tech-content');
}

export default function SendInvoiceSheet({
  open,
  onClose,
  onSend,
  busy,
  invoiceNumber,
  recipient,
  previouslySent,
}) {
  const restoreBackgroundRef = useRef(() => {});
  const openerRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const active = open || closing;
  const techLayout = findTechLayout();
  const portalHost = typeof document === 'undefined' ? null : document.body;

  // Match Modal's presence lifecycle so the shell remains inert through the sheet's
  // exit animation. Modal invokes onExited before restoring opener focus.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open && closing) setClosing(false);
    else if (!open) setClosing(true);
  }

  // The authenticated shell scrolls inside .tech-content rather than body. Capture
  // its opener before inert can blur it, then independently lock + inert that scroller.
  // The fullscreen dialog itself is portaled to body (the motion-standard overlay root).
  useLayoutEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const focused = document.activeElement;
    openerRef.current = focused instanceof HTMLElement && focused !== document.body
      ? focused
      : null;

    const content = findScrollableTechContent(techLayout);
    if (!content) return undefined;

    const previous = {
      inert: content.inert,
      ariaHidden: content.getAttribute('aria-hidden'),
      overflow: content.style.overflow,
      touchAction: content.style.touchAction,
    };
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      content.inert = previous.inert;
      if (previous.ariaHidden === null) content.removeAttribute('aria-hidden');
      else content.setAttribute('aria-hidden', previous.ariaHidden);
      content.style.overflow = previous.overflow;
      content.style.touchAction = previous.touchAction;
    };

    content.inert = true;
    content.setAttribute('aria-hidden', 'true');
    content.style.overflow = 'hidden';
    content.style.touchAction = 'none';
    restoreBackgroundRef.current = restore;

    return () => {
      restore();
      if (restoreBackgroundRef.current === restore) restoreBackgroundRef.current = () => {};
    };
  }, [active, techLayout]);

  const handleExited = useCallback(() => {
    // This must precede Modal's own focus restoration: the opener lives in the shell
    // content that was inert while the sheet was visible.
    restoreBackgroundRef.current();
    setClosing(false);
  }, []);

  const safeClose = () => {
    if (busy) return;
    onClose?.();
  };
  const cancel = () => {
    if (busy) return;
    impact('light');
    safeClose();
  };
  const send = () => {
    onSend?.();
  };

  const sheet = (
    <Modal
      open={open}
      onClose={safeClose}
      title={previouslySent ? 'Resend invoice?' : 'Send invoice?'}
      size="sm"
      className="am-send-sheet"
      closeOnOverlay={!busy}
      closeDisabled={busy}
      closeHaptic={false}
      returnFocusTo={openerRef}
      onExited={handleExited}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={cancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : previouslySent ? 'Resend invoice' : 'Send invoice'}
          </button>
        </>
      )}
    >
      <div className="am-section-label">Customer email</div>
      <p className="am-send-copy">
        QuickBooks will email {invoiceNumber || 'this invoice'} to {recipient || 'the billing email on file'}.
      </p>
    </Modal>
  );

  // Fullscreen overlays belong at body so they are never clipped by a shell scroller.
  return portalHost ? createPortal(sheet, portalHost) : sheet;
}
