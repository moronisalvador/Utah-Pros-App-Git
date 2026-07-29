/**
 * ════════════════════════════════════════════════
 * FILE: useDialogLifecycle.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Makes a pop-up sheet behave like a real dialog. When one opens, the keyboard
 *   focus moves into it and stays there instead of wandering off behind it;
 *   pressing Escape closes it; and when it closes, focus goes back to whatever
 *   the person was on before. For someone using a screen reader or a hardware
 *   keyboard, without this a sheet is a wall of content they can tab straight
 *   past into a screen they cannot see.
 *
 * Exports:
 *   useDialogLifecycle({ open, onClose, panelRef })  -> props to spread on the panel
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - WHY A HOOK AND NOT THE Modal COMPONENT. MODAL-01 asks for the tech sheets to
 *     use "Modal or one tech-sheet wrapper built on the same focus, closing-mount,
 *     reduced-motion, and return-focus contract". Both of those restructure five
 *     working sheets' markup and styling. This carries the SAME lifecycle across
 *     with no DOM change at all, so the sheets keep their layouts and the frozen
 *     PWA surface does not move. The behaviour is lifted from Modal.jsx:104-134
 *     deliberately — one contract, two adopters.
 *   - Does NOT lock body scroll. Modal.jsx does, but these sheets already sit in a
 *     `position: fixed; inset: 0` overlay and several contain their own scroller;
 *     freezing the body under them changes existing scroll behaviour, which is a
 *     visible change to a working surface.
 *   - Does NOT own the exit animation. That needs a --closing class and an
 *     onAnimationEnd unmount in each sheet's markup, so it is a separate, visible
 *     change rather than something to slip in behind an a11y fix.
 *   - Escape is captured (capture phase, stopPropagation) so a sheet stacked over
 *     another closes only the top one — the same reason Modal.jsx captures.
 * ════════════════════════════════════════════════
 */
import { useEffect } from 'react';

/** Kept identical to Modal.jsx:45-46 — one definition of "focusable" for both. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog focus/escape lifecycle for a sheet that renders its own markup.
 *
 * @param {{ open: boolean, onClose?: Function, panelRef: {current: HTMLElement|null} }} args
 * @returns props to spread onto the panel element (role/aria-modal/tabIndex)
 */
export function useDialogLifecycle({ open, onClose, panelRef }) {
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const panel = panelRef?.current;

    // Move focus into the sheet. Falling back to the panel itself matters for a
    // sheet whose only controls are disabled until something is chosen.
    const focusables = panel?.querySelectorAll(FOCUSABLE);
    (focusables && focusables.length ? focusables[0] : panel)?.focus?.();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = panel.querySelectorAll(FOCUSABLE);
      // Nothing focusable: swallow Tab rather than let it escape behind the sheet.
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Return focus to whatever opened the sheet. Without this, focus falls back
      // to <body> and a keyboard or VoiceOver user restarts from the top of the page.
      previouslyFocused?.focus?.();
    };
  }, [open, onClose, panelRef]);

  return {
    role: 'dialog',
    'aria-modal': true,
    // -1 so the panel can receive focus programmatically without entering tab order.
    tabIndex: -1,
  };
}

export default useDialogLifecycle;
