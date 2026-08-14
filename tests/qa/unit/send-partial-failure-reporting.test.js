/**
 * ════════════════════════════════════════════════
 * FILE: send-partial-failure-reporting.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Makes sure EVERY screen that sends a customer message tells the user when
 *   the message only partly went out. The send worker answers "OK" for a
 *   partly-delivered send — some recipients skipped for consent, or some photos
 *   of a multi-photo text failing — because the parts that did go out are real.
 *   A screen that reads only the first row of that answer shows a clean send and
 *   the user never learns. That is exactly what happened: the field-tech thread
 *   reported it and the office inbox did not (PR #644 review).
 *
 *   This is a SOURCE-CONTRACT test: both send surfaces are large page/hook
 *   modules that cannot be mounted cheaply, so it reads their source and asserts
 *   each one consumes the shared notice. Its real job is to fail when someone
 *   adds a THIRD send surface — or quietly deletes the reporting from one.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  reads src/pages/Conversations.jsx,
 *              src/pages/tech/v2/messages/useThread.js, src/lib/sendResult.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path, { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

// Every surface that POSTs a customer message through the send worker.
const SEND_SURFACES = [
  'src/pages/Conversations.jsx',
  'src/pages/tech/v2/messages/useThread.js',
];

describe('partial-failure reporting on every send surface', () => {
  it.each(SEND_SURFACES)('%s consumes the shared partial-send notice', (rel) => {
    const source = read(rel);
    expect(source).toContain("from '@/lib/sendResult'");
    expect(source).toMatch(/partialSendNotice\(\s*data\.twilio\s*\)/);
    // The notice must actually be raised, with its own severity — not computed
    // and dropped, and not hardcoded to one type.
    expect(source).toMatch(/\(\s*notice\.message\s*,\s*notice\.type\s*\)/);
  });

  it('no send surface hand-rolls its own partial-failure wording', () => {
    // One implementation is the point: the two composers are copy-paste twins,
    // and this exact reporting drifted between them once already.
    for (const rel of SEND_SURFACES) {
      const source = read(rel);
      expect(source).not.toMatch(/photos sent —/);
      expect(source).not.toMatch(/not reached`/);
    }
  });

  it('lists every surface that posts to /api/send-message', () => {
    // A new send surface must be added to SEND_SURFACES above (and must report
    // partial failure), rather than silently shipping without it.
    const searched = [
      ...readdirSync(path.join(root, 'src/pages'), { recursive: true })
        .filter((f) => typeof f === 'string' && /\.(jsx?|tsx?)$/.test(f))
        .map((f) => path.posix.join('src/pages', f.split(path.sep).join('/'))),
    ];
    const posters = searched.filter((rel) => {
      if (rel.includes('.test.')) return false;
      const source = read(rel);
      // The actual call, not a doc-comment mention of the route.
      return /fetch\(\s*[`'"][^`'"]*\/api\/send-message/.test(source);
    });
    expect([...posters].sort()).toEqual([...SEND_SURFACES].sort());
  });
});
