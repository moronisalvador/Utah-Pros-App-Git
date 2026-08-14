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
 *   - `returnFocusTo` optionally accepts an element or React ref captured by a
 *     caller before it changes background interactivity. Existing callers keep
 *     the default behavior of restoring the element focused when Modal opens.
 *   - `initialFocusRef` optionally names WHICH control gets the caret on open.
 *     Without it the first focusable wins, which is the ✕ — so a search-led dialog
 *     opens focused on Close and a plain `autoFocus` on the field does NOT save it
 *     (React applies autoFocus during commit; this effect runs after and overrides).
 *     Falls back to the default when the ref is empty (a conditionally-rendered
 *     field) or points outside the panel, so it can never break the focus trap.
 *   - Motion (fade + scale desktop / slide-up mobile) is pure CSS in index.css,
 *     tokened + reduced-motion-wrapped. This file owns behavior + the EXIT lifecycle:
 *     when `open` flips false we keep the panel mounted with a `--closing` class so the
 *     exit keyframe (scale-down desktop / slide-down mobile, on --motion-ease-accelerate)
 *     can play, then unmount on animationend (safety-timeout fallback). Reduced motion
 *     keeps the same focus/inert cleanup order but completes immediately after mount
 *     (motion-standard.md §2/§6).
 *   - Exit only animates when the panel stays mounted across the close (parent passes
 *     `open={x}`). A caller that conditionally unmounts (`{x && <Modal .../>}`) still
 *     closes instantly — unchanged from before.
 * ════════════════════════════════════════════════
 */

import { useEffect, useRef, useState, useCallback, useId } from 'react';
import IconButton from './IconButton';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Safety-net only: the exit keyframe runs ~75% of the --motion-duration-base enter
// (220ms → ~165ms); unmount is normally driven by onAnimationEnd. This timeout
// force-unmounts if animationend never fires (interrupted animation / no-anim env).
const EXIT_FALLBACK_MS = 240;

// Exit keyframe names (index.css) that end the close — desktop scale-down + mobile
// slide-down. Guards against the ENTER animation's animationend (and child bubbling).
const EXIT_ANIM_NAMES = new Set(['uiModalOut', 'uiSheetDown']);

// Stack of currently-mounted dialogs, innermost last. Only the topmost reacts to keys.
// Dialogs genuinely nest here — New Job opens New Contact on top of itself — and each
// instance adds its own capture-phase document listener. Without this, one Escape is
// seen by BOTH and closes the parent form too; stopPropagation cannot prevent that,
// because sibling listeners on the same node still run.
const openStack = [];

export default function Modal({
  open = true,
  onClose,
  title,
  children,
  footer,
  size,               // 'sm' | 'lg' | undefined (default)
  closeOnOverlay = true,
  closeDisabled = false,
  closeHaptic = true,
  className = '',
  returnFocusTo,
  initialFocusRef,
  onExited,
}) {
  const panelRef = useRef(null);
  const overlayDownRef = useRef(false); // did the mousedown land on the overlay itself?
  const titleId = useId();

  // ─── SECTION: State & hooks — exit-animation lifecycle ──────────────
  // `closing` keeps the panel mounted while its exit keyframe plays after `open`
  // flips false; unmount happens on animationend (handleExitEnd) or the safety timer.
  // `prevOpen` tracks the last `open` as STATE (not a ref) so the change is detected
  // during render without touching a ref mid-render (react-hooks/refs).
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const onExitedRef = useRef(onExited);
  const closingRef = useRef(closing);
  const exitFinishedRef = useRef(false);
  const present = open || closing;

  // Keep the document-level listener current without tearing down the dialog lifecycle
  // when callers naturally create new callbacks during a render.
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);
  useEffect(() => { onExitedRef.current = onExited; }, [onExited]);
  useEffect(() => { closingRef.current = closing; }, [closing]);
  useEffect(() => {
    if (open && !closing) exitFinishedRef.current = false;
  }, [open, closing]);

  // ─── SECTION: Event handlers ──────────────
  const handleOverlayMouseDown = useCallback((e) => {
    overlayDownRef.current = e.target === e.currentTarget;
  }, []);

  const handleOverlayClick = useCallback(
    (e) => {
      if (!closeOnOverlay || closingRef.current || closeDisabledRef.current) return;
      // Only close when both the press AND release happened on the overlay (not a drag out).
      if (e.target === e.currentTarget && overlayDownRef.current) onCloseRef.current?.();
    },
    [closeOnOverlay],
  );

  const finishExit = useCallback(() => {
    if (exitFinishedRef.current) return;
    exitFinishedRef.current = true;
    // A portaled caller may have its own inert/scroll lock. Release it before this
    // component's focus cleanup restores focus to an opener in that background.
    onExitedRef.current?.();
    setClosing(false);
  }, []);

  // Unmount once the panel's exit keyframe finishes (ignore the enter anim + child bubbling).
  // Flipping `closing` false also clears the safety timer (its effect cleanup, below).
  const handleExitEnd = useCallback((e) => {
    if (e.target === e.currentTarget && EXIT_ANIM_NAMES.has(e.animationName)) finishExit();
  }, [finishExit]);

  // ─── SECTION: Lifecycle — ESC, focus trap, scroll lock ──────────────
  useEffect(() => {
    if (!present) return undefined;
    const explicitReturnTarget = returnFocusTo && typeof returnFocusTo === 'object' && 'current' in returnFocusTo
      ? returnFocusTo.current
      : returnFocusTo;
    const previouslyFocused = explicitReturnTarget || document.activeElement;
    const panel = panelRef.current;

    // Move focus into the dialog on open. An explicit initialFocusRef wins; otherwise
    // the first focusable does, which is the ✕ on any dialog that renders a close button.
    // Refs attach during commit, so a child field's ref is already populated here.
    const requested = initialFocusRef && typeof initialFocusRef === 'object' && 'current' in initialFocusRef
      ? initialFocusRef.current
      : initialFocusRef;
    if (requested?.focus && panel?.contains(requested)) {
      requested.focus();
    } else {
      const focusables = panel?.querySelectorAll(FOCUSABLE);
      (focusables && focusables.length ? focusables[0] : panel)?.focus?.();
    }

    // Innermost dialog owns the keyboard; an outer one stays inert until it is back on top.
    const token = {};
    openStack.push(token);

    const onKeyDown = (e) => {
      if (openStack[openStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (!closingRef.current && !closeDisabledRef.current) onCloseRef.current?.();
        return;
      }
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
      const at = openStack.indexOf(token);
      if (at !== -1) openStack.splice(at, 1);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [present, returnFocusTo, initialFocusRef]);

  // ─── SECTION: Exit-animation lifecycle ──────────────
  // Adjust `closing` WHILE RENDERING when `open` changes (React's "adjust state on a prop
  // change" pattern — no effect, so it cannot cascade). open→false while shown starts the
  // exit; reduced motion completes it from the lifecycle effect immediately; a re-open cancels
  // any in-flight close.
  // The setState calls are guarded + convergent, so this re-renders once and settles.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      if (closing) setClosing(false);              // re-opened — cancel any close
    } else {
      setClosing(true);                            // animate out, then unmount
    }
  }

  // Safety net: if the exit animationend never fires (interrupted anim / no-anim env),
  // force the unmount after the exit has had time to run. setState lives in the timer
  // callback (not the effect body), so it does not cascade.
  useEffect(() => {
    if (!closing) return undefined;
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Keep this in a task even for reduced motion. That preserves focus/inert state for
    // the close commit, then lets finishExit release the caller's background first.
    const t = setTimeout(finishExit, reduced ? 0 : EXIT_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [closing, finishExit]);

  if (!present) return null;

  // ─── SECTION: Render ──────────────
  const sizeClass = size === 'sm' ? ' ui-modal--sm' : size === 'lg' ? ' ui-modal--lg' : '';
  return (
    <div
      className={`ui-modal-overlay${closing ? ' ui-modal-overlay--closing' : ''}`}
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div
        ref={panelRef}
        className={`ui-modal${sizeClass}${closing ? ' ui-modal--closing' : ''}${className ? ' ' + className : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onAnimationEnd={handleExitEnd}
      >
        {(title || onClose) && (
          <div className="ui-modal-header">
            {title ? <h2 id={titleId} className="ui-modal-title">{title}</h2> : <span />}
            {onClose && (
              <IconButton
                label="Close"
                className="ui-modal-close"
                onClick={() => {
                  if (!closing && !closeDisabled) onClose?.();
                }}
                disabled={closing || closeDisabled}
                haptic={closeHaptic}
              >✕</IconButton>
            )}
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
