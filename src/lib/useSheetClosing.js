/**
 * ════════════════════════════════════════════════
 * FILE: useSheetClosing.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lets a slide-up panel slide back DOWN when it closes instead of vanishing
 *   instantly. When the sheet is told to close, this keeps it on screen just
 *   long enough to play the short closing animation, then removes it. If the
 *   person's phone is set to reduce motion, the sheet closes instantly.
 *
 * Exports:
 *   useSheetClosing(open) ->
 *     { present, closing, overlayClassName, panelClassName, onAnimationEnd }
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none — the paired CSS lives in src/index.css
 *              (.tech-sheet-overlay / .tech-sheet-panel and their --closing exits)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - This is the exit-animation half of the tech-sheet contract; the
 *     focus/Escape/aria half is useDialogLifecycle.js. Both lift their behaviour
 *     from Modal.jsx so there is ONE closing mechanism with two adopters
 *     (motion-standard.md §3: every enter has an exit — ~75% of the enter on
 *     --motion-ease-accelerate; unmount on animationend).
 *   - Render null only when `present` is false. Gating on `open` alone unmounts
 *     before the exit can play, which is the exact defect this hook removes.
 *   - The sheet must stay MOUNTED by its parent across the close (parent passes
 *     `open={x}`, never `{x && <Sheet/>}`) — every current caller already does.
 *   - Reduced motion: the paired CSS sets `animation: none`, so animationend
 *     never fires; the 0ms timer below is what completes the close. Same
 *     contract as Modal.jsx (its EXIT_FALLBACK_MS block).
 *   - `onAnimationEnd` goes on the OVERLAY root: the panel's exit bubbles to it,
 *     and the name filter ignores the enter keyframes and child animations.
 * ════════════════════════════════════════════════
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// Safety-net only: the exit keyframes run ~75% of the --motion-duration-base
// enter (220ms → ~165ms); unmount is normally driven by onAnimationEnd. This
// timeout force-unmounts if animationend never fires (interrupted animation /
// no-anim env). Value matches Modal.jsx's EXIT_FALLBACK_MS.
const EXIT_FALLBACK_MS = 240;

// Exit keyframe names (index.css) that end the close. Guards against the ENTER
// animations' animationend and anything animating inside the panel.
const EXIT_ANIM_NAMES = new Set(['tech-fade-out', 'tech-slide-down']);

/**
 * Exit-animation lifecycle for a hand-rolled tech bottom sheet.
 *
 * @param {boolean} open whether the sheet should be shown
 * @returns {{ present: boolean, closing: boolean, overlayClassName: string,
 *             panelClassName: string, onAnimationEnd: Function }}
 */
export function useSheetClosing(open) {
  // `closing` keeps the sheet mounted while its exit keyframes play after
  // `open` flips false; unmount happens on animationend or the safety timer.
  // `prevOpen` tracks the last `open` as STATE (not a ref) so the change is
  // detected during render without touching a ref mid-render.
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);
  const exitFinishedRef = useRef(false);

  const present = open || closing;

  useEffect(() => {
    if (open && !closing) exitFinishedRef.current = false;
  }, [open, closing]);

  const finishExit = useCallback(() => {
    if (exitFinishedRef.current) return;
    exitFinishedRef.current = true;
    setClosing(false);
  }, []);

  const onAnimationEnd = useCallback((e) => {
    if (EXIT_ANIM_NAMES.has(e.animationName)) finishExit();
  }, [finishExit]);

  // Adjust `closing` WHILE RENDERING when `open` changes (React's "adjust state
  // on a prop change" pattern — no effect, so it cannot cascade). open→false
  // while shown starts the exit; a re-open cancels any in-flight close. The
  // setState calls are guarded + convergent, so this re-renders once and settles.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      if (closing) setClosing(false); // re-opened — cancel any close
    } else {
      setClosing(true);               // animate out, then unmount
    }
  }

  // Safety net: if the exit animationend never fires (reduced motion sets
  // `animation: none`; an interrupted animation), force the unmount after the
  // exit has had time to run. setState lives in the timer callback, not the
  // effect body, so it does not cascade.
  useEffect(() => {
    if (!closing) return undefined;
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(finishExit, reduced ? 0 : EXIT_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [closing, finishExit]);

  return {
    present,
    closing,
    overlayClassName: closing ? 'tech-sheet-overlay tech-sheet-overlay--closing' : 'tech-sheet-overlay',
    panelClassName: closing ? 'tech-sheet-panel tech-sheet-panel--closing' : 'tech-sheet-panel',
    onAnimationEnd,
  };
}

export default useSheetClosing;
