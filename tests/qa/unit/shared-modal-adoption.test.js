/**
 * ════════════════════════════════════════════════
 * FILE: shared-modal-adoption.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   That the seven office pop-ups which used to be built by hand are still built on
 *   the one shared pop-up component — the thing that gives them a proper label for
 *   screen readers, keyboard trapping, and Escape-to-close. It also checks none of
 *   them refers to a piece of the screen that no longer exists, which is a mistake
 *   that gets past the build and every other test.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  reads the seven dialog sources, ui/Modal.jsx, index.css and
 *              pages/Conversations.jsx as TEXT — nothing is rendered here
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Source contract only. The primitive's actual behaviour is proven by
 *     src/components/ui/Modal.initialFocus.test.jsx and Modal.focus.test.jsx,
 *     which render it. Both halves are needed — see the note below.
 * ════════════════════════════════════════════════
 *
 * Seven dialogs that hand-rolled `.conv-modal-backdrop` / `.conv-modal` now build on
 * the shared <Modal>, which is what gives them role="dialog", aria-modal, an
 * accessible name, a focus trap, Escape/overlay close and body scroll-lock. None of
 * that was present while the markup was hand-rolled.
 *
 * This is a SOURCE contract, not a behavioural one: it proves these files are still
 * wired to the shared primitive. The behaviour of the primitive itself is proven by
 * src/components/ui/Modal.initialFocus.test.jsx and Modal.focus.test.jsx, which
 * render it. Both halves are needed — a render test of Modal keeps passing if one of
 * these files quietly reverts to a bare div, and this file keeps passing if Modal's
 * own focus handling breaks.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const MIGRATED = [
  'src/components/NewInvoiceModal.jsx',
  'src/components/AddRelatedJobModal.jsx',
  'src/components/SendEsignModal.jsx',
  'src/components/AddContactModal.jsx',
  'src/components/NewEstimateModal.jsx',
  'src/components/EditContactModal.jsx',
  'src/components/CreateJobModal.jsx',
];

// The dialogs that open ON a search field. These are the ones a plain `autoFocus`
// silently fails on, because Modal focuses the first focusable (the ✕) from an
// effect that runs after React has applied autoFocus.
const SEARCH_LED = [
  'src/components/NewInvoiceModal.jsx',
  'src/components/NewEstimateModal.jsx',
  'src/components/CreateJobModal.jsx',
];

describe.each(MIGRATED)('shared <Modal> adoption — %s', (file) => {
  const src = read(file);

  it('renders the shared Modal', () => {
    expect(src).toMatch(/import \{[^}]*\bModal\b[^}]*\} from '@\/components\/ui'/);
    expect(src).toContain('<Modal');
  });

  it('no longer hand-rolls the backdrop or panel', () => {
    // Per-file attribution. The repo-wide ban below is the actual anti-drift guard;
    // this one names WHICH file regressed when it does.
    expect(src).not.toContain('conv-modal-backdrop');
    expect(src).not.toContain('className="conv-modal');
  });

  it('lets the dialog animate out before the caller unmounts it', () => {
    // Every call site mounts these conditionally ({show && <Dialog/>}), so without a
    // local open flag + onExited the panel vanishes instantly on close, which
    // motion-standard.md §3 treats as a defect ("every enter has an exit").
    expect(src).toContain('onExited={onClose}');
    expect(src).toMatch(/const\s*\[\s*open\s*,\s*setOpen\s*\]\s*=\s*useState\(true\)/);
  });
});

describe.each(SEARCH_LED)('opens on its search field — %s', (file) => {
  const src = read(file);

  it('names the field with initialFocusRef rather than autoFocus', () => {
    expect(src).toContain('initialFocusRef={searchInputRef}');
    expect(src).toContain('ref={searchInputRef}');
    // autoFocus here is not merely redundant — it reads as if it works, and does not.
    expect(src).not.toContain('autoFocus');
  });
});

describe('shared Modal contract these dialogs depend on', () => {
  const modal = read('src/components/ui/Modal.jsx');

  it('supports an opt-in initial focus target that cannot escape the panel', () => {
    expect(modal).toContain('initialFocusRef');
    expect(modal).toContain('panel?.contains(requested)');
  });

  it('keeps Escape scoped to the innermost dialog', () => {
    // New Job opens New Contact on top of itself. Both add a capture-phase listener
    // to document, and stopPropagation does NOT stop a sibling listener on the same
    // node — so only an explicit stack keeps one Escape from closing both.
    expect(modal).toContain('openStack.push(token)');
    expect(modal).toContain('if (openStack[openStack.length - 1] !== token) return;');
  });
});

/**
 * Migrating these dialogs meant deleting each one's hand-rolled header, and with it the
 * local IconX it used for its own ✕. In CreateJobModal that icon was ALSO used by the
 * "clear selected client" chip further down, so deleting it left an undefined component
 * that threw a ReferenceError the moment a client was picked.
 *
 * Nothing caught it: `npm run build` succeeded, the eslint ratchet reported zero
 * regressions, and 6,160 tests passed. Core `no-undef` IS enabled here but does not
 * inspect JSX element names — that is `react/jsx-no-undef`, and eslint-plugin-react is
 * not installed. So this whole class of crash is invisible to the current lint setup.
 * Scoped to the files this change owns; making it repo-wide needs that plugin.
 */
const stripCommentsAndStrings = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

describe.each([...MIGRATED, 'src/components/ui/Modal.jsx'])(
  'every JSX component is defined or imported — %s',
  (file) => {
    it('references no undefined component', () => {
      const src = stripCommentsAndStrings(read(file));
      const used = new Set(
        [...src.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)].map((m) => m[1]),
      );
      const declared = new Set(
        [...src.matchAll(/(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]),
      );
      for (const m of src.matchAll(/import\s+([\s\S]+?)\s+from\s/g)) {
        for (const id of m[1].matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) declared.add(id[1]);
      }
      const undefinedRefs = [...used].filter((c) => !declared.has(c) && c !== 'Fragment');
      expect(undefinedRefs).toEqual([]);
    });
  },
);

/**
 * The MIGRATED list above is a hardcoded snapshot: it proves those seven do not
 * REVERT, but an EIGHTH hand-rolled dialog added anywhere else in src/ would sail
 * straight past it. This is the actual anti-drift guard, and it is deliberately
 * absolute — there is no allowlist and no legacy exception.
 *
 * That became possible on 2026-08-14: PR #646 (merge c8688002) moved the last other
 * consumer, Conversations.jsx's New Conversation dialog, onto the shared Modal. With
 * these seven, the `.conv-modal*` kit has ZERO callers, so its CSS was retired in the
 * same change (`docs/ux-motion-rollout-plan.md` §90 called for exactly that once all
 * seven migrated — "net-negative, the wave's headroom source").
 *
 * Both directions are asserted on purpose. Banning only the markup would let someone
 * re-add the CSS; asserting only the CSS is gone would let someone re-add the markup
 * against selectors that no longer exist and get an unstyled overlay.
 */
const walk = (dir) => readdirSync(join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory()
    ? walk(`${dir}/${e.name}`)
    : (/\.jsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])));

describe('the .conv-modal kit is retired repo-wide', () => {
  it('no file under src/ hand-rolls a .conv-modal dialog', () => {
    const offenders = walk('src')
      .filter((f) => !f.endsWith('.test.js') && !f.endsWith('.test.jsx'))
      .filter((f) => {
        const src = read(f);
        return src.includes('conv-modal-backdrop') || src.includes('className="conv-modal');
      });
    expect(offenders).toEqual([]);
  });

  it('its CSS is gone, so nothing can quietly re-adopt it', () => {
    expect(read('src/index.css')).not.toContain('.conv-modal');
  });
});
