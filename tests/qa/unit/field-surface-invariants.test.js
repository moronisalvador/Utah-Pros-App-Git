/**
 * ════════════════════════════════════════════════
 * FILE: field-surface-invariants.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins a handful of decisions about the field (tech PWA) experience so a later
 *   change cannot quietly undo them.
 *
 *   These were all real, reported bugs, fixed on 2026-07-27:
 *     - Tapping Message left UPR and opened the phone's own texting app, so the
 *       text went out from the technician's personal number and never appeared in
 *       the customer's UPR thread.
 *     - A failed load showed technicians raw database error text
 *       (`RPC get_claim_detail: 401 {"code":"42501",...}`).
 *     - The release gate ran before the build, so an expired evidence file skipped
 *       build and test entirely and hid whether the code even compiled.
 *
 *   Each is cheap to reintroduce by accident, and none of them is loud when it
 *   regresses — a `sms:` link looks fine in review, and a raw error only appears
 *   when something else is already broken. Hence a guard rather than a comment.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — the credential-free `qa` lane, so it runs in CI
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  src/pages/tech/**, src/components/tech/**, .github/workflows/ci.yml
 *   Data:      reads  → source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Source-contract assertions, so they prove INTENT. The behavioural proofs live
 *     in src/lib/openInAppThread.test.js and src/lib/techShellRoutes.test.js; this
 *     file catches the case those cannot — someone reintroducing the old pattern
 *     somewhere new.
 *   - Deliberately narrow. It does not police style; each assertion maps to a bug
 *     that actually reached a technician.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (p) => p.slice(ROOT.length + 1).replace(/\\/g, '/');
const TECH_FILES = [
  ...walk(join(ROOT, 'src', 'pages', 'tech')),
  ...walk(join(ROOT, 'src', 'components', 'tech')),
];
const SRC_FILES = walk(join(ROOT, 'src'));

describe('the Message button stays inside UPR', () => {
  it('no tech surface links to a native sms: address', () => {
    // A text sent from the phone's own app comes from the technician's personal
    // number: it never lands in the customer's UPR thread, office staff cannot see
    // it, and it bypasses the consent chokepoint entirely.
    const offenders = TECH_FILES
      .filter((f) => /['"`]sms:/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders, 'use openInAppThread() / pickerHref() instead of an sms: link').toEqual([]);
  });

  it('keeps the in-app thread helper available', () => {
    expect(existsSync(join(ROOT, 'src/lib/openInAppThread.js'))).toBe(true);
  });
});

describe('technicians are never shown raw database errors', () => {
  it('no page puts a raw error message into user-facing load-error state', () => {
    // loading-error-states.md wants the friendly line on screen; the raw text goes
    // to console.error for diagnosis. Reported case: a technician saw
    // `RPC get_claim_detail: 401 {"code":"42501",...}`.
    const offenders = SRC_FILES
      .filter((f) => /setLoadError\(\s*(e|err|error)\s*\.\s*message/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(
      offenders,
      'console.error the raw failure and pass only the friendly message to setLoadError',
    ).toEqual([]);
  });
});

describe('the release gate cannot hide whether the code builds', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const stepOrder = [...ci.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1].trim());
  const indexOf = (pattern) => stepOrder.findIndex((s) => pattern.test(s));

  it('runs Build and Test before the provenance validation', () => {
    // The original order put provenance first, so a six-hour-old evidence file
    // turned CI red on a clock AND skipped build+test — for hours, nobody knew the
    // code was fine.
    const build = indexOf(/^Build$/);
    const test = indexOf(/^Test$/);
    const provenance = indexOf(/Validate migration provenance/);
    expect(build, 'a Build step must exist').toBeGreaterThanOrEqual(0);
    expect(test, 'a Test step must exist').toBeGreaterThanOrEqual(0);
    expect(provenance, 'a provenance validation step must exist').toBeGreaterThanOrEqual(0);
    expect(provenance).toBeGreaterThan(build);
    expect(provenance).toBeGreaterThan(test);
  });

  it('only enforces evidence freshness on a release PR into main', () => {
    // Staleness is not drift. Blocking every branch on it is what made the gate
    // hated; main IS production, so freshness is enforced there and nowhere else.
    expect(ci).toContain('--strict-freshness');
    const strictBlock = ci.slice(ci.indexOf('release freshness'));
    expect(strictBlock).toContain("github.base_ref == 'main'");
  });
});
