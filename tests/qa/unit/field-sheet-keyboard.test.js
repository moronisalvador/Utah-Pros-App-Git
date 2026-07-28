/**
 * KB-03 — the four field bottom-sheets must clear the on-screen keyboard.
 *
 * Found by auditing every tech surface that pairs a `position:'fixed'` element
 * with a text input, after the owner reported the message composer hidden behind
 * the keyboard (KB-02). These four are the same bug in a different shape.
 *
 * Each sheet is a fixed `inset:0` overlay with `alignItems:'flex-end'` holding a
 * panel capped at N dvh. capacitor.config sets Keyboard.resize "none", so the
 * LAYOUT viewport never shrinks and `dvh` never changes — the panel stays pinned
 * to the bottom of the screen, behind the keyboard, along with whatever the tech
 * is typing into and the button they need to press.
 *
 * Source-contract assertions: this repo's vitest environment is `node` with no
 * jsdom, so these sheets cannot be rendered here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The dvh cap differs per sheet on purpose — a photo note needs less height than
// a full reading entry. The keyboard fix has to preserve each one.
const SHEETS = [
  ['src/components/tech/AddRoomSheet.jsx', '80dvh'],
  ['src/components/tech/ReadingEntrySheet.jsx', '88dvh'],
  ['src/components/tech/PhotoNoteSheet.jsx', '70dvh'],
  ['src/components/tech/EquipmentPlacementSheet.jsx', '85dvh'],
];

describe.each(SHEETS)('KB-03 — %s', (file, dvh) => {
  const src = read(file);

  it('subscribes to the keyboard inset', () => {
    expect(src).toContain("import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset'");
    expect(src).toContain('const kbInset = useNativeKeyboardInset();');
  });

  it('lifts the overlay so the whole sheet rides above the keyboard', () => {
    // On the overlay, not the panel: the panel is bottom-anchored inside it, so
    // padding the overlay is what actually moves the sheet up.
    const overlay = src.slice(src.indexOf("position: 'fixed'"), src.indexOf("role=\"dialog\""));
    expect(overlay).toContain("alignItems: 'flex-end'");
    expect(overlay).toContain('paddingBottom: kbInset || undefined');
  });

  it(`clamps the panel height so lifting it does not push the header off the top`, () => {
    // Without this the sheet keeps its full height, gets pushed up by the
    // keyboard, and loses its title and close button off the top of the screen.
    expect(src).toContain(`maxHeight: kbInset > 0 ? \`calc(${dvh} - \${kbInset}px)\` : '${dvh}'`);
  });

  it('drops the home-indicator inset while the keyboard covers it', () => {
    // Same call the message composer already makes: with the keyboard up the
    // safe-area inset is dead space between the sheet and the keys.
    expect(src).toContain("paddingBottom: kbInset > 0 ? 12 : 'max(12px, env(safe-area-inset-bottom, 12px))'");
  });

  it('keeps the resting layout byte-identical for the PWA', () => {
    // useNativeKeyboardInset returns 0 on web and attaches no listener, so every
    // keyboard-aware value above collapses to exactly what shipped before:
    // paddingBottom omitted, maxHeight the plain dvh string, safe-area inset kept.
    expect(src).toContain(`: '${dvh}'`);
    expect(src).toContain("'max(12px, env(safe-area-inset-bottom, 12px))'");
    expect(src).toContain('kbInset || undefined');
  });
});

describe('KB-03 — the hook it depends on stays native-only', () => {
  it('returns 0 and attaches nothing on web', () => {
    // This is the single line that keeps the owner's PWA-frozen constraint true
    // across all four sheets at once. If it ever changes, the PWA layout moves.
    const hook = read('src/lib/useNativeKeyboardInset.js');
    expect(hook).toContain('if (!Capacitor.isNativePlatform()) return undefined;');
    expect(hook).toContain('const [inset, setInset] = useState(0);');
  });
});

// The other half of the sweep: screens that dock a BAR to the tab bar rather than
// opening a sheet. With the keyboard up the tab bar and the home indicator are both
// behind it, so the resting offset floats the bar into the middle of the keys.
const DOCKED_BARS = [
  ['src/pages/tech/TechDemoSheet.jsx', 2],   // main footer + the review overlay's
  ['src/pages/tech/TechAppointment.jsx', 1],
  ['src/pages/tech/TechRoomDetail.jsx', 1],
  ['src/pages/tech/TechJobAlbum.jsx', 1],
  ['src/pages/tech/TechClaimAlbum.jsx', 1],
];

describe.each(DOCKED_BARS)('KB-03 — %s docked bar', (file, count) => {
  const src = read(file);

  it('sits flush on the keyboard instead of on the hidden tab bar', () => {
    // Exact count, not "at least one": TechDemoSheet has TWO docked footers (the
    // sheet's own and the review overlay's) and fixing only one leaves the submit
    // screen broken while the main screen looks correct.
    const hits = (src.match(/bottom: ?kbInset > 0 \?/g) || []).length;
    expect(hits).toBe(count);
  });

  it('keeps the exact resting offset for the PWA', () => {
    // Every keyboard-aware bottom keeps its original calc() as the else branch, so
    // with kbInset 0 the computed value is what shipped.
    expect(src).toContain('var(--tech-nav-height, 64px)');
    expect(src).toContain('env(safe-area-inset-bottom');
  });

  it('reads the inset from the shared native-only hook', () => {
    expect(src).toContain("import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset'");
    expect(src).toContain('const kbInset = useNativeKeyboardInset();');
  });
});

describe('KB-03 — the Scope Sheet can scroll its fields clear of the keyboard', () => {
  const src = read('src/pages/tech/TechDemoSheet.jsx');

  it('grows both scroll containers by the keyboard height', () => {
    // Lifting the footer is not enough on its own: without extra scroll slack a
    // field near the bottom cannot be brought above the keyboard at all. This is
    // the same pair of changes KB-01 needed in the four forms.
    expect(src).toContain('calc(180px + env(safe-area-inset-bottom, 0px) + ${kbInset}px)');
    expect(src).toContain('env(safe-area-inset-bottom, 0px) + ${kbInset}px)');
  });

  it('wires the hook into BOTH components that render a docked footer', () => {
    // ReviewScreen is a separate component with its own fixed footer; missing it
    // leaves the submit screen broken while the main sheet looks fixed.
    const hooks = src.split('const kbInset = useNativeKeyboardInset();').length - 1;
    expect(hooks).toBe(2);
  });
});

describe('KB-03 — no fixed-position tech surface with an input is left unhandled', () => {
  it('has keyboard handling on every sheet and form known to need it', () => {
    // The audit that found these four. If a new screen pairs a fixed element with
    // a text input, add it here deliberately — either wired up, or listed below
    // with a reason, so the next person does not have to re-run the sweep.
    const WIRED = [
      'src/components/tech/AddRoomSheet.jsx',
      'src/components/tech/ReadingEntrySheet.jsx',
      'src/components/tech/PhotoNoteSheet.jsx',
      'src/components/tech/EquipmentPlacementSheet.jsx',
      'src/components/tech/EsignRequestSheet.jsx',
      'src/pages/tech/TechNewAppointment.jsx',
      'src/pages/tech/TechEditAppointment.jsx',
      'src/pages/tech/TechNewJob.jsx',
      'src/pages/tech/TechNewCustomer.jsx',
      'src/pages/tech/TechDemoSheet.jsx',
      'src/pages/tech/TechAppointment.jsx',
      'src/pages/tech/TechRoomDetail.jsx',
      'src/pages/tech/TechJobAlbum.jsx',
      'src/pages/tech/TechClaimAlbum.jsx',
      'src/pages/tech/v2/messages/ThreadView.jsx',
    ];
    for (const file of WIRED) {
      expect(read(file), file).toMatch(/useNativeKeyboardInset|observeKeyboardInset/);
    }
  });
});
