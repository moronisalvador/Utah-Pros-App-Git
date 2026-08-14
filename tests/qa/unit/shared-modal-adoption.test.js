/**
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
import { readFileSync } from 'node:fs';
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
    // .conv-modal* is still LIVE css — Conversations.jsx's New Conversation dialog
    // uses it — so this asserts these seven stopped using it, not that it is gone.
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

describe('.conv-modal CSS is still required', () => {
  it('is kept while Conversations.jsx still renders it', () => {
    // Guards against a follow-up "cleanup" deleting the shared kit on the strength of
    // these seven migrations alone.
    const css = read('src/index.css');
    const conversations = read('src/pages/Conversations.jsx');
    if (conversations.includes('conv-modal-backdrop')) {
      expect(css).toContain('.conv-modal-backdrop');
      expect(css).toContain('.conv-modal {');
    }
  });
});
