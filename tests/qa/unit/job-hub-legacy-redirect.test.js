/**
 * ════════════════════════════════════════════════
 * FILE: job-hub-legacy-redirect.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a technician who has the new Job Hub can never be dropped back
 *   onto the old job screen. The old address still exists — older copies of the
 *   app link to it, and so do notifications sent before the Hub shipped — so the
 *   app forwards those to the Hub instead of showing two different-looking pages
 *   for the same job.
 *
 * WHY THIS EXISTS:
 *   2026-08-08, reported by the owner: "it doesn't have the blue thing in the
 *   background... it still has the call button." That was the LEGACY job page,
 *   reached from a stale link. Job mode of the Hub was already correct; the bug
 *   was that anything could still reach the old page at all.
 *
 * NOTES / GOTCHAS:
 *   - Source-contract test (credential-free lane). It proves the wiring exists,
 *     not that the browser navigates — the behavioural proof is the simulator.
 *   - The redirect MUST read the same switch jobHref() reads. If those two ever
 *     diverge, a link and a redirect can disagree about where a job opens, which
 *     is precisely the class of bug wave 1 shipped with.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not process.cwd(): `process` is not a defined global
// under the lint config (the ratchet catches it even though `npx eslint .` does
// not), and a cwd-relative read would break under any runner started elsewhere.
// Same pattern as the sibling source-contract tests in this directory.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('Job Hub — legacy job route redirect', () => {
  it('wraps the legacy /tech/jobs/:jobId route in the redirect', () => {
    const app = read('src/App.jsx');
    const line = app
      .split('\n')
      .find((l) => l.includes('path="tech/jobs/:jobId"') && !l.includes('/photos') && !l.includes('/documents'));
    expect(line, 'the legacy job route must still exist').toBeTruthy();
    expect(line).toContain('LegacyJobRedirect');
    expect(line).toContain('TechJobDetail');
  });

  it('imports the guard statically, not as a lazy chunk', () => {
    // A route guard that arrives late would render the legacy page first and
    // then swap — a visible flash of the exact screen we are redirecting away
    // from.
    const app = read('src/App.jsx');
    expect(app).toContain("import LegacyJobRedirect from '@/components/tech/v2/LegacyJobRedirect'");
  });

  it('decides with isHubNav — the same switch jobHref uses', () => {
    const guard = read('src/components/tech/v2/LegacyJobRedirect.jsx');
    expect(guard).toContain("import { isHubNav } from './nav.js'");
    expect(guard).toContain('isHubNav()');
    // Never a second, hand-rolled derivation of "does this viewer have the Hub".
    expect(guard).not.toContain('page:tech_job_hub');
    expect(guard).not.toContain('dev_only_user_id');
  });

  it('redirects to the hub route, replacing history and keeping query + state', () => {
    const guard = read('src/components/tech/v2/LegacyJobRedirect.jsx');
    expect(guard).toContain('`/tech/job/${jobId}${location.search || \'\'}`');
    expect(guard).toContain('state={location.state}');
    expect(guard).toContain('replace');
  });

  it('still renders the legacy page for a viewer without the Hub', () => {
    const guard = read('src/components/tech/v2/LegacyJobRedirect.jsx');
    // The fallback is the children, unconditionally — the legacy page is the
    // real destination for every tech the flag is off for.
    expect(guard).toContain('return children;');
  });

  it('no tech-shell caller hardcodes the legacy job path instead of jobHref', () => {
    const offenders = [];
    for (const f of [
      'src/pages/ClaimPage.jsx',
      'src/pages/tech/TechAppointment.jsx',
      'src/pages/tech/TechClaimDetail.jsx',
      'src/pages/tech/TechNewJob.jsx',
    ]) {
      const src = read(f);
      // `/tech/jobs/${...}` with no sub-path is the legacy job screen. The
      // /photos and /documents children are legitimately still addressed there.
      const bad = /`\/tech\/jobs\/\$\{[^}]+\}`/.exec(src);
      if (bad) offenders.push(`${f}: ${bad[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
