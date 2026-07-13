/**
 * ════════════════════════════════════════════════
 * FILE: Modal.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one pop-up box the whole app should use. It dims the screen behind it,
 *   shows a titled panel with your content in the middle, and lets people close
 *   it by pressing Escape, clicking the dimmed area, or tapping the ✕. On a
 *   phone it slides up from the bottom like a native sheet instead of floating
 *   in the middle. It also keeps keyboard focus trapped inside while it is open,
 *   so screen-reader and keyboard users can't tab into the hidden page behind it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  any page/component that needs a dialog (import from '@/components/ui')
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  IconButton (the ✕ close button); styles in src/index.css (.ui-modal*)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - role="dialog" + aria-modal + aria-labelledby (from `title`) — the a11y contract.
 *   - Closing: Escape key, overlay click, and the ✕ all call onClose. A click that
 *     starts inside the panel and drags onto the overlay does NOT close (guards a
 *     text-selection drag) — we only close on a real overlay mousedown+click.
 *   - Focus trap + body scroll-lock run in a useEffect, so they no-op under the
 *     node/renderToStaticMarkup test env (jsdom-free) — that's expected.
 *   - Motion (fade + scale desktop / slide-up mobile) and the bottom-sheet layout
 *     are pure CSS in index.css, tokened + reduced-motion-wrapped. This file owns
 *     behavior only (motion-standard.md §3).
 * ════════════════════════════════════════════════
 */

import { useEffect, useRef, useCallback, useId } from 'react';
import IconButton from './IconButton';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open = true,
  onClose,
  title,
  children,
  footer,
  size,               // 'sm' | 'lg' | undefined (default)
  closeOnOverlay = true,
  className = '',
}) {
  const panelRef = useRef(null);
  const overlayDownRef = useRef(false); // did the mousedown land on the overlay itself?
  const titleId = useId();

  // ─── SECTION: Event handlers ──────────────
  const handleOverlayMouseDown = useCallback((e) => {
    overlayDownRef.current = e.target === e.currentTarget;
  }, []);

  const handleOverlayClick = useCallback(
    (e) => {
      if (!closeOnOverlay) return;
      // Only close when both the press AND release happened on the overlay (not a drag out).
      if (e.target === e.currentTarget && overlayDownRef.current) onClose?.();
    },
    [closeOnOverlay, onClose],
  );

  // ─── SECTION: Lifecycle — ESC, focus trap, scroll lock ──────────────
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;

    // Move focus into the dialog on open.
    const focusables = panel?.querySelectorAll(FOCUSABLE);
    (focusables && focusables.length ? focusables[0] : panel)?.focus?.();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = panel.querySelectorAll(FOCUSABLE);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  // ─── SECTION: Render ──────────────
  const sizeClass = size === 'sm' ? ' ui-modal--sm' : size === 'lg' ? ' ui-modal--lg' : '';
  return (
    <div
      className="ui-modal-overlay"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        className={`ui-modal${sizeClass}${className ? ' ' + className : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        {(title || onClose) && (
          <div className="ui-modal-header">
            {title ? <h2 id={titleId} className="ui-modal-title">{title}</h2> : <span />}
            {onClose && (
              <IconButton label="Close" className="ui-modal-close" onClick={onClose}>✕</IconButton>
            )}
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
