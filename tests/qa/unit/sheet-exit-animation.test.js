/**
 * motion-standard.md §3 — every enter has an exit.
 *
 * The three hand-rolled tech bottom sheets (AddRoomSheet, AddPhotoSourceSheet,
 * ClockSupersedeSheet) used to unmount instantly on close (`if (!open) return
 * null`), which §3 names a defect: "add a --closing state and unmount on
 * animationend". Flagged by design-consistency-checker on 2026-08-13.
 *
 * The fix is ONE shared pattern, not three bespoke patches: useSheetClosing.js
 * lifts Modal.jsx's closing mechanism (render-phase `closing` adjustment,
 * name-filtered animationend, reduced-motion 0ms task, safety timeout) and the
 * sheets adopt it alongside useDialogLifecycle. This test pins the mechanism,
 * the CSS contract, and each adopter, so a later sheet edit cannot quietly
 * regress to an instant unmount.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const hook = read('src/lib/useSheetClosing.js');
const css = read('src/index.css');

const SHEETS = [
  ['src/components/tech/AddRoomSheet.jsx', 'useSheetClosing(open)'],
  ['src/components/tech/AddPhotoSourceSheet.jsx', 'useSheetClosing(open)'],
  ['src/components/tech/ClockSupersedeSheet.jsx', 'useSheetClosing(isOpen)'],
];

describe('sheet exit — the shared closing mechanism (useSheetClosing.js)', () => {
  it('keeps the sheet mounted while closing (present = open || closing)', () => {
    expect(hook).toContain('const present = open || closing;');
  });

  it('adjusts closing during render, the same pattern as Modal.jsx', () => {
    // A useEffect here would unmount-then-remount visibly; Modal.jsx documents
    // why the render-phase adjustment is the correct shape. One contract.
    expect(hook).toContain('if (prevOpen !== open) {');
    expect(hook).toContain('setPrevOpen(open);');
    const modal = read('src/components/ui/Modal.jsx');
    for (const src of [hook, modal]) {
      expect(src).toContain('if (closing) setClosing(false)');
      expect(src).toContain('setClosing(true)');
    }
  });

  it('unmounts on the EXIT keyframes only (name-filtered animationend)', () => {
    // Without the filter, the ENTER animation's end (or any child animation
    // bubbling up) would tear the sheet down the moment it finished opening.
    expect(hook).toContain("new Set(['tech-fade-out', 'tech-slide-down'])");
    expect(hook).toContain('EXIT_ANIM_NAMES.has(e.animationName)');
  });

  it('completes the close on a 0ms task under reduced motion', () => {
    // The paired CSS sets `animation: none` under reduced motion, so
    // animationend NEVER fires there — the timer is the only path to unmount.
    expect(hook).toContain("window.matchMedia?.('(prefers-reduced-motion: reduce)').matches");
    expect(hook).toContain('reduced ? 0 : EXIT_FALLBACK_MS');
  });

  it('carries a safety timeout so an interrupted animation cannot strand a full-screen overlay', () => {
    // These overlays are position:fixed inset:0 — a stuck one blocks the app.
    expect(hook).toContain('const EXIT_FALLBACK_MS = 240;');
    expect(hook).toContain('setTimeout(finishExit, reduced ? 0 : EXIT_FALLBACK_MS)');
  });
});

describe('sheet exit — the CSS contract (index.css)', () => {
  it('ships the exit keyframes, transform/opacity only', () => {
    expect(css).toMatch(/@keyframes tech-fade-out \{\s*from \{ opacity: 1; \}\s*to\s+\{ opacity: 0; \}\s*\}/);
    expect(css).toMatch(/@keyframes tech-slide-down \{\s*from \{ transform: translateY\(0\); \}\s*to\s+\{ transform: translateY\(100%\); \}\s*\}/);
  });

  it('runs the exit at ~75% of the enter on the accelerate token, holding the end state', () => {
    // §3: "~75% of the enter duration on --motion-ease-accelerate". `forwards`
    // prevents a one-frame flash back to visible between animationend and the
    // React unmount commit.
    expect(css).toContain(
      '.tech-sheet-overlay--closing {\n  animation: tech-fade-out calc(var(--motion-duration-base) * 0.75) var(--motion-ease-accelerate) forwards;',
    );
    expect(css).toContain(
      '.tech-sheet-panel--closing { animation: tech-slide-down calc(var(--motion-duration-base) * 0.75) var(--motion-ease-accelerate) forwards; }',
    );
  });

  it('blocks mid-exit taps (pointer-events off while closing)', () => {
    const closingBlock = css.slice(css.indexOf('.tech-sheet-overlay--closing'));
    expect(closingBlock.slice(0, 300)).toContain('pointer-events: none;');
  });

  it('tokenizes the enters (no more raw 0.15s/0.22s inline strings)', () => {
    expect(css).toContain('.tech-sheet-overlay { animation: tech-fade-in var(--motion-duration-fast) var(--motion-ease-standard); }');
    expect(css).toContain('.tech-sheet-panel { animation: tech-slide-up var(--motion-duration-base) var(--motion-ease-decelerate); }');
  });

  it('collapses to instant under reduced motion (MOTION-02)', () => {
    // `animation: none` (not just a shorter duration) so neither keyframe ever
    // paints; useSheetClosing's 0ms task completes the close.
    expect(css).toMatch(
      /\.tech-sheet-overlay, \.tech-sheet-panel,\s*\n\s*\.tech-sheet-overlay--closing, \.tech-sheet-panel--closing \{ animation: none; \}/,
    );
  });
});

describe.each(SHEETS)('sheet exit — %s', (file, hookCall) => {
  const src = read(file);

  it('adopts useSheetClosing with its own open condition', () => {
    expect(src).toContain("import { useSheetClosing } from '@/lib/useSheetClosing';");
    expect(src).toContain(hookCall);
  });

  it('renders null only when `present` is false — never on bare `open`', () => {
    // `if (!open) return null` is the exact §3 defect this pattern removes.
    expect(src).toContain('if (!present');
    expect(src).not.toContain('if (!open) return null');
    expect(src).not.toContain('if (!precheck || !precheck.open_entry) return null');
  });

  it('wires the closing classes and the animationend unmount', () => {
    expect(src).toContain('className={overlayClassName}');
    expect(src).toContain('className={panelClassName}');
    expect(src).toContain('onAnimationEnd={onAnimationEnd}');
  });

  it('carries no inline enter animation that would override the class', () => {
    // Inline `style.animation` beats the class, which would silently disable
    // the exit swap. The animation lives ONLY in the .tech-sheet-* classes.
    expect(src).not.toMatch(/animation:\s*'tech-/);
  });
});

describe('sheet exit — ClockSupersedeSheet payload latch', () => {
  const src = read('src/components/tech/ClockSupersedeSheet.jsx');

  it('adopts the a11y half of the sheet contract too (useDialogLifecycle)', () => {
    // Close-out gauntlet finding 2026-08-14: this sheet hand-set role="dialog"
    // with no focus trap/Escape/return-focus while its siblings carried the
    // full MODAL-01 contract. Escape mirrors the backdrop tap (onCancel).
    expect(src).toContain("import { useDialogLifecycle } from '@/lib/useDialogLifecycle';");
    expect(src).toContain('useDialogLifecycle({ open: isOpen, onClose: onCancel, panelRef })');
    expect(src).toContain('{...dialogProps}');
    expect(src).not.toContain('role="dialog"');
  });

  it('latches the last open precheck for the closing frames', () => {
    // The parent closes by nulling `precheck`; without the latch the sheet
    // would blank mid-slide (label/elapsed text gone while still on screen).
    // State adjusted during render, not a ref — react-hooks/refs bans reading
    // a ref while rendering.
    expect(src).toContain('if (isOpen && latched !== precheck) setLatched(precheck);');
    expect(src).toContain('const shown = isOpen ? precheck : latched;');
  });
});
