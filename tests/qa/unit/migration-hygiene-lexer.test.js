/**
 * ════════════════════════════════════════════════
 * FILE: migration-hygiene-lexer.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The migration safety checker has to ignore comments and quoted text so it
 *   doesn't get confused by prose. It used to do that with a couple of
 *   find-and-replace rules, and those rules quietly deleted large stretches of
 *   real database code — hiding the very commands the checker exists to police.
 *   This checks that it still reads the file properly instead of going back to
 *   find-and-replace.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  scripts/check-migration-hygiene.mjs
 *   Data:      reads  → the checker's own source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - SOURCE CONTRACT, not behaviour. The checker is a top-level runner with no
 *     exports that calls process.exit(1), so importing it from a test would run
 *     the whole gate and could kill the runner. Making stripComments importable
 *     (export + a run-directly guard) is a worthwhile follow-up; until then the
 *     behavioural verification is running `node scripts/check-migration-hygiene.mjs`,
 *     which on 2026-08-07 reported 0 failures across 45 checked migrations with
 *     the lexer in place.
 *   - The two bugs this pins were found on 2026-08-07 and were BOTH silent:
 *       1. `'...'` replaced with the `s` flag, with no concept of dollar-quoting,
 *          so a quote inside a $fn$ body paired with one outside it. Measured on
 *          20260807220000: 84.2% of the file blanked, REVOKE and GRANT included.
 *       2. Strings stripped BEFORE line comments, so an apostrophe inside a `--`
 *          comment ("…Postgres's built-in…") opened a bogus literal that ran on.
 *     Verified consequence: with the old rules, a real `GRANT ... TO anon` added
 *     to 20260807220000 was NOT detected by the anon-allowlist rule. The lexer
 *     detects it. That is a security-relevant false negative in a blocking gate.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = readFileSync(join(ROOT, 'scripts', 'check-migration-hygiene.mjs'), 'utf8');

describe('migration hygiene stripper', () => {
  it('understands dollar-quoted bodies', () => {
    // Without this the checker cannot tell a quote inside a function body from
    // one outside it, and blanks everything between them.
    expect(SOURCE).toMatch(/\$\(\[A-Za-z_\]\[A-Za-z0-9_\]\*\)\?\\\$/);
    expect(SOURCE).toContain('dollar');
  });

  it('consumes line comments before string literals', () => {
    // Ordering is the whole bug: an apostrophe inside a `--` comment must never
    // be able to open a string literal.
    const stripper = SOURCE.slice(SOURCE.indexOf('function stripComments'));
    const commentAt = stripper.indexOf("startsWith('--'");
    const stringAt = stripper.indexOf('sql[i] === "\'"');
    expect(commentAt, 'line-comment branch not found').toBeGreaterThan(-1);
    expect(stringAt, 'string-literal branch not found').toBeGreaterThan(-1);
    expect(commentAt).toBeLessThan(stringAt);
  });

  it('has not regressed to the two regex replacements', () => {
    // The exact shapes that shipped the bugs. Their return is what this pins.
    expect(SOURCE).not.toMatch(/replace\(\/'\(\?:\[\^'\]\|''\)\*'\/gs/);
    expect(SOURCE).not.toMatch(/\.replace\(\/--\[\^\\n\]\*\/g, ''\)/);
  });

  it('still applies the four rules it is the gate for', () => {
    // A stripper rewrite must not quietly drop a rule.
    expect(SOURCE).toContain('missing paired rollback');
    expect(SOURCE).toContain('`-- public: <reason>` comment');
    expect(SOURCE).toContain('without any `REVOKE ... FROM PUBLIC`');
    expect(SOURCE).toContain('destructive-approved');
  });
});
