/**
 * ════════════════════════════════════════════════
 * FILE: css-structural-integrity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that every `{` in the stylesheet has a matching `}`.
 *
 *   That sounds trivial. It is not. On 2026-07-30 a merge resolution dropped a
 *   single closing brace near the end of src/index.css. CSS has no "unclosed
 *   rule" error — the parser simply treats everything that follows as NESTED
 *   inside the unclosed rule. So an entire block of styles was silently
 *   re-parented under
 *     :root[data-native="true"] .public-native-shell > .login-page
 *   and stopped applying anywhere in the app, while still *appearing* in the
 *   built CSS. It shipped to dev AND main.
 *
 *   Nothing else caught it: the Vite build succeeded (the nesting is valid
 *   CSS), 3,855 tests passed, the bundle-size gate passed, and even grepping
 *   the deployed file for the rule "found" it — because the selector was a
 *   substring of the nested one. A brace count is the one check that does.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  src/index.css
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - Braces inside strings/url() would confuse a naive count, so those are
 *     stripped first, along with comments.
 *   - This is a STRUCTURAL check, not a style check. It says nothing about
 *     whether the CSS is good — only that it parses the way it reads.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Remove comments and quoted strings so their braces never skew the count. */
const strip = (css) => css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''");

const STYLESHEETS = ['src/index.css'];

describe('CSS structural integrity', () => {
  for (const file of STYLESHEETS) {
    it(`${file} has balanced braces`, () => {
      const css = strip(readFileSync(join(root, file), 'utf8'));
      const open = (css.match(/{/g) || []).length;
      const close = (css.match(/}/g) || []).length;
      expect(
        close,
        `${file}: ${open} '{' vs ${close} '}'. An unclosed rule does NOT fail the `
        + 'build — it silently nests everything after it, so those styles stop applying '
        + 'while still appearing in the output. Find the rule that never closes.',
      ).toBe(open);
    });

    it(`${file} never closes more than it opens at any point`, () => {
      // A running depth that goes negative means a stray '}' ended a rule early —
      // the same silent-breakage class of bug, caught from the other direction.
      const css = strip(readFileSync(join(root, file), 'utf8'));
      let depth = 0;
      let line = 1;
      for (const ch of css) {
        if (ch === '\n') line += 1;
        else if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        if (depth < 0) break;
      }
      expect(depth, `${file}: unbalanced near line ${line}`).toBeGreaterThanOrEqual(0);
    });
  }
});
