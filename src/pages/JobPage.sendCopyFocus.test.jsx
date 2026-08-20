/**
 * ════════════════════════════════════════════════
 * FILE: JobPage.sendCopyFocus.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the bug that shipped on 2026-08-19 cannot come back: a text box that
 *   threw away what you were typing. The owner reported it as "every key stroke
 *   makes me have to click the composing field again to continue typing", and it
 *   made the send-a-copy field unusable — they could not finish typing an email
 *   address.
 *
 * WHAT ACTUALLY BROKE, because the shape matters more than the instance:
 *   `SRRow` is declared INSIDE the JobPage module's SignRequestsSection body, so
 *   every render creates a new function identity. React compares component types
 *   by identity, sees a different type at that position, and UNMOUNTS the whole
 *   row to mount a fresh one. For static content that is invisible. For an
 *   <input> it is fatal: the DOM node holding focus and the caret is destroyed
 *   and rebuilt on every keystroke, because each keystroke set state.
 *
 *   The same footgun is recorded for animations in motion-standard.md §5. It
 *   costs focus here and a restarted animation there; one root cause.
 *
 * WHY THIS TEST IS A SOURCE CONTRACT, not a render test:
 *   6,620 tests passed over the defect. Rendering JobPage needs auth, router,
 *   react-query and a job fixture, and even then a jsdom "focus" assertion would
 *   be testing happy-dom rather than WebKit. What is checkable, cheaply and
 *   exactly, is the STRUCTURAL rule that makes the bug impossible: no stateful
 *   input may live inside SRRow's subtree. That is the invariant; the focus loss
 *   was only its symptom.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = readFileSync(join(ROOT, 'src/pages/JobPage.jsx'), 'utf8');

/** The SignRequestsSection body, where SRRow lives and rows are built. */
function signRequestsSection() {
  const start = SRC.indexOf('function SignRequestsSection(');
  expect(start, 'SignRequestsSection must exist').toBeGreaterThan(-1);
  const end = SRC.indexOf('\nfunction ', start + 1);
  return SRC.slice(start, end === -1 ? SRC.length : end);
}

describe('JobPage send-a-copy — the focus-loss defect cannot return', () => {
  it('SRRow is still declared in the component body, so the hazard is real', () => {
    // If someone later hoists SRRow to module scope, that is a FIX and this
    // assertion should be deleted along with the rest of this guard — not
    // worked around. Pinning the hazard keeps the reason legible until then.
    expect(signRequestsSection()).toMatch(/const SRRow\s*=\s*\(\{/);
  });

  it('no <input>, <textarea> or <select> is rendered inside a row action', () => {
    // The actual invariant. An input in `actions` is remounted on every parent
    // render, which destroys focus and the caret mid-typing.
    const section = signRequestsSection();
    const actionBlocks = [...section.matchAll(/actions=\{<>([\s\S]*?)<\/>\}/g)].map((m) => m[1]);
    expect(actionBlocks.length, 'expected the SRRow action blocks to be found').toBeGreaterThan(0);
    for (const [i, block] of actionBlocks.entries()) {
      expect(block, `action block ${i} must not contain an input`).not.toMatch(/<input\b/);
      expect(block, `action block ${i} must not contain a textarea`).not.toMatch(/<textarea\b/);
      expect(block, `action block ${i} must not contain a select`).not.toMatch(/<select\b/);
    }
  });

  it('the send-a-copy field lives in the shared Modal instead', () => {
    // Modal portals to document.body, so its input is not a child of SRRow and
    // no amount of row re-rendering can remount it. It also brings role=dialog,
    // the focus trap, ESC and overlay close, which the inline row never had.
    expect(SRC).toContain("import { ErrorState, EmptyState, Modal } from '@/components/ui';");
    const section = signRequestsSection();
    expect(section).toMatch(/<Modal\b[\s\S]*?open=\{!!sendCopyTarget\}/);
    expect(section).toContain('id="sendcopy-email"');
    // The input is INSIDE the Modal, not before it.
    expect(section.indexOf('<Modal')).toBeLessThan(section.indexOf('id="sendcopy-email"'));
  });

  it('the dialog cannot be dismissed out from under an in-flight send', () => {
    expect(signRequestsSection()).toContain('closeDisabled={sendingCopy}');
  });

  it('focus lands in the address field when the dialog opens', () => {
    const section = signRequestsSection();
    expect(section).toContain('initialFocusRef={sendCopyInputRef}');
    expect(section).toContain('ref={sendCopyInputRef}');
  });
});
