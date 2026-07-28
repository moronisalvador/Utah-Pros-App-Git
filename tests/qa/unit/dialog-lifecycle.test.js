/**
 * MODAL-01 — tech sheets get the dialog lifecycle they were missing.
 *
 * All five sheets already declared role="dialog", which is the part that is easy
 * to remember. None of them had aria-modal, an Escape handler, a focus trap, or
 * focus return — the parts that actually make a dialog usable without a
 * touchscreen. Modal.jsx has had all of it since it was written; the sheets
 * simply never used it.
 *
 * Adopted as a hook rather than by migrating to Modal or a new wrapper, both of
 * which restructure five working sheets' markup and styling. The behaviour is
 * lifted from Modal.jsx:104-134 verbatim so there is ONE contract with two
 * adopters, and the test below pins them together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const hook = read('src/lib/useDialogLifecycle.js');
const modal = read('src/components/ui/Modal.jsx');

const SHEETS = [
  ['src/components/tech/AddRoomSheet.jsx', 'open'],
  ['src/components/tech/ReadingEntrySheet.jsx', 'open'],
  ['src/components/tech/PhotoNoteSheet.jsx', '!!photo'],
  ['src/components/tech/EquipmentPlacementSheet.jsx', 'open'],
  ['src/components/tech/EsignRequestSheet.jsx', 'open'],
];

describe('MODAL-01 — the shared contract', () => {
  it('traps Tab in both directions', () => {
    for (const src of [hook, modal]) {
      expect(src).toContain("if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }");
      expect(src).toContain("else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }");
    }
  });

  it('returns focus to whatever opened it', () => {
    // Without this, focus falls to <body> and a keyboard or VoiceOver user
    // restarts from the top of the page every time a sheet closes.
    for (const src of [hook, modal]) {
      expect(src).toContain('const previouslyFocused = document.activeElement;');
      expect(src).toContain('previouslyFocused?.focus?.();');
    }
  });

  it('closes on Escape, captured so a stacked sheet closes only the top one', () => {
    for (const src of [hook, modal]) {
      expect(src).toContain("if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }");
      expect(src).toContain("document.addEventListener('keydown', onKeyDown, true);");
    }
  });

  it('uses the same definition of focusable as Modal', () => {
    // Two drifting selectors would trap focus differently in two places.
    const sel = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    expect(hook).toContain(sel);
    expect(modal).toContain(sel);
  });

  it('swallows Tab when nothing inside is focusable', () => {
    // Otherwise Tab escapes to the screen behind the sheet, which the person
    // cannot see and did not ask for.
    expect(hook).toContain('if (!items.length) { e.preventDefault(); return; }');
  });

  it('attaches nothing while closed', () => {
    expect(hook).toContain('if (!open) return undefined;');
  });

  it('supplies aria-modal and a programmatically focusable panel', () => {
    expect(hook).toContain("role: 'dialog',");
    expect(hook).toContain("'aria-modal': true,");
    expect(hook).toContain('tabIndex: -1,');
  });
});

describe.each(SHEETS)('MODAL-01 — %s', (file, openExpr) => {
  const src = read(file);

  it('adopts the hook with its own open condition', () => {
    // The condition differs per sheet; passing the wrong one attaches the key
    // handler while the sheet is closed, so it is asserted per file.
    expect(src).toContain("import { useDialogLifecycle } from '@/lib/useDialogLifecycle';");
    // Sheets whose prop is literally `open` use object shorthand; PhotoNoteSheet
    // derives it from `photo` and so names it explicitly.
    const expected = openExpr === 'open'
      ? 'useDialogLifecycle({ open, onClose, panelRef })'
      : `useDialogLifecycle({ open: ${openExpr}, onClose, panelRef })`;
    expect(src).toContain(expected);
  });

  it('spreads the props onto the panel and refs it', () => {
    expect(src).toContain('ref={panelRef}');
    expect(src).toContain('{...dialogProps}');
  });

  it('no longer hardcodes role="dialog" on the panel', () => {
    // The spread supplies it. A leftover literal would silently win or conflict.
    expect(src).not.toContain('        role="dialog"');
  });

  it('keeps its own accessible name', () => {
    // aria-modal without a name announces as an unlabelled dialog.
    expect(src).toMatch(/aria-label="[^"]+"/);
  });
});

describe('MODAL-01 — what is deliberately NOT done here', () => {
  it('does not lock body scroll the way Modal does', () => {
    // These sheets sit in a fixed inset:0 overlay and several own a scroller;
    // freezing the body under them is a visible behaviour change to a working
    // surface, not an accessibility fix.
    expect(modal).toContain("document.body.style.overflow = 'hidden';");
    expect(hook).not.toContain('document.body.style.overflow');
  });

  it('leaves the exit animation to a separate change', () => {
    // motion-standard.md §3 wants a --closing phase instead of an instant
    // unmount, but that needs markup in every sheet. Tracked, not smuggled in.
    // Assert on the MECHANISM, not the word — "closing-mount" appears in the
    // hook's own comment explaining why it is out of scope.
    // setClosing is the mechanism; both `closing-mount` and `onAnimationEnd`
    // appear in the hook's prose explaining why they are out of scope, so a
    // word search would fail on the documentation rather than the behaviour.
    expect(hook).not.toContain('setClosing');
    expect(modal).toContain('setClosing');
  });
});
