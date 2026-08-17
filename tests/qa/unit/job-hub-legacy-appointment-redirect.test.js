/**
 * ════════════════════════════════════════════════
 * FILE: job-hub-legacy-appointment-redirect.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that a technician who has the new Job Hub can never be dropped back
 *   onto the old APPOINTMENT screen — the twin of the job-route check beside
 *   this file, and the one that reaches further. Push notifications stored the
 *   old appointment address for months, so a notification from weeks ago still
 *   opens it, and controls inside the Hub itself pointed there too.
 *
 * WHY THIS EXISTS:
 *   The owner reported landing on a legacy job page that "still has the call
 *   button" (2026-08-08). That path was closed for /tech/jobs/:id and left open
 *   for /tech/appointment/:id — the identical defect, still live.
 *
 * NOTES / GOTCHAS:
 *   - Source-contract test (credential-free lane). It proves the wiring exists,
 *     not that the browser navigates — the behavioural proof is a device.
 *   - The last case is a RECURSIVE scan of src/**, not a fixed file list: the
 *     job-route test's four-file list could only catch a caller someone
 *     remembered to add to it. The allowlist below is the whole set of
 *     legitimate constructions, each with its reason.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this file, not process.cwd(): `process` is not a defined global
// under the lint config (the ratchet catches it even though `npx eslint .` does
// not). Same pattern as the sibling source-contract tests in this directory.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// The only files allowed to name the legacy appointment path directly.
const HARDCODE_ALLOWLIST = new Set([
  // The sanctioned constructor. apptHref() IS the legacy URL when no job id is
  // available, which is the contract the redirect guard completes.
  'src/components/tech/v2/nav.js',
  'src/components/tech/v2/nav.test.js',
  // The legacy job page itself. A Hub viewer never renders it — LegacyJobRedirect
  // replaces it first — so its own links cannot reach a Hub user. It is deleted
  // wholesale at the H3 cutover; rewiring a page scheduled for deletion would be
  // churn.
  'src/pages/tech/TechJobDetail.jsx',
  // The legacy appointment page: self-references in its own doc header, plus its
  // links into its own /edit child.
  'src/pages/tech/TechAppointment.jsx',
]);

const SCAN_EXT = new Set(['.js', '.jsx']);
// `/tech/appointment/${x}` with no sub-path. The lookahead keeps the Hub's
// legitimate /edit links (HubChecklist "Edit list", HubStage's clock-card edit)
// legal — that screen is a real destination, not a stale address.
const HARDCODED_APPT = /`\/tech\/appointment\/\$\{[^}]+\}(?!\/edit)/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    const dot = entry.lastIndexOf('.');
    if (dot > 0 && SCAN_EXT.has(entry.slice(dot))) out.push(full);
  }
  return out;
}

describe('Job Hub — legacy appointment route redirect', () => {
  it('wraps the legacy /tech/appointment/:id route in the redirect', () => {
    const app = read('src/App.jsx');
    const line = app
      .split('\n')
      .find((l) => l.includes('path="tech/appointment/:id"'));
    expect(line, 'the legacy appointment route must still exist').toBeTruthy();
    expect(line).toContain('LegacyAppointmentRedirect');
    expect(line).toContain('TechAppointment');
  });

  it('leaves the /edit child unwrapped — the Hub links into it', () => {
    const app = read('src/App.jsx');
    const line = app
      .split('\n')
      .find((l) => l.includes('path="tech/appointment/:id/edit"'));
    expect(line, 'the edit route must still exist').toBeTruthy();
    expect(line).not.toContain('LegacyAppointmentRedirect');
  });

  it('imports the guard statically, not as a lazy chunk', () => {
    // A route guard that arrives late would render the legacy page first and
    // then swap — a visible flash of the exact screen we are redirecting away
    // from.
    const app = read('src/App.jsx');
    expect(app).toContain(
      "import LegacyAppointmentRedirect from '@/components/tech/v2/LegacyAppointmentRedirect'",
    );
  });

  it('decides with isHubNav — the same switch apptHref uses', () => {
    const guard = read('src/components/tech/v2/LegacyAppointmentRedirect.jsx');
    expect(guard).toContain("import { isHubNav } from './nav.js'");
    expect(guard).toContain('isHubNav()');
    // Never a second, hand-rolled derivation of "does this viewer have the Hub".
    expect(guard).not.toContain('page:tech_job_hub');
    expect(guard).not.toContain('dev_only_user_id');
  });

  it('fires no lookup at all for a viewer without the Hub', () => {
    // The flag-off path must cost nothing: no RPC, no skeleton, no delay. The
    // legacy page is still their real destination.
    const guard = read('src/components/tech/v2/LegacyAppointmentRedirect.jsx');
    expect(guard).toContain('enabled: !!(hubNav && id)');
    expect(guard).toContain('if (!hubNav || !id) return children;');
  });

  it('shows a skeleton while resolving, never the page it is replacing', () => {
    const guard = read('src/components/tech/v2/LegacyAppointmentRedirect.jsx');
    expect(guard).toContain('detailQuery.isPending');
    expect(guard).toContain('SkeletonList');
  });

  it('resolves the job through the legacy page\'s own loader', () => {
    // get_appointment_detail is what TechAppointment itself calls, so the
    // redirect can see exactly what the page could have shown — including the
    // private-appointment filter, which returns NULL rather than leaking.
    // There is no CREATE POLICY for `appointments` in supabase/migrations, so a
    // direct table read here would not be a proven-granted path.
    const guard = read('src/components/tech/v2/LegacyAppointmentRedirect.jsx');
    expect(guard).toContain("db.rpc('get_appointment_detail'");
    expect(guard).not.toContain("db.select('appointments'");
  });

  it('seeds the Hub visit cache so the redirect costs no extra round trip', () => {
    const guard = read('src/components/tech/v2/LegacyAppointmentRedirect.jsx');
    expect(guard).toContain("queryClient.setQueryData([...techKeys.hub(jobId), 'visit', id], detail)");
  });

  it('redirects with ?appt= pinned, replacing history and keeping state', () => {
    const guard = read('src/components/tech/v2/LegacyAppointmentRedirect.jsx');
    expect(guard).toContain('buildHubApptUrl(jobId, id, location.search)');
    expect(guard).toContain('state={location.state}');
    expect(guard).toContain('replace');
    const helper = read('src/components/tech/v2/legacyApptResolve.js');
    expect(helper).toContain("params.set('appt', appointmentId)");
    expect(helper).toContain('`/tech/job/${jobId}?${params.toString()}`');
  });

  it('still renders the legacy page for a job-less or unresolvable appointment', () => {
    const guard = read('src/components/tech/v2/LegacyAppointmentRedirect.jsx');
    expect(guard).toContain('if (!redirect) return children;');
    // retry:false — a private appointment resolves to null legitimately, and
    // retrying a legitimate null just delays the legacy page.
    expect(guard).toContain('retry: false');
  });

  it('no caller outside the allowlist hardcodes the legacy appointment path', () => {
    const offenders = [];
    for (const full of walk(join(ROOT, 'src'))) {
      const rel = relative(ROOT, full).split(sep).join('/');
      if (HARDCODE_ALLOWLIST.has(rel)) continue;
      const bad = HARDCODED_APPT.exec(readFileSync(full, 'utf8'));
      if (bad) offenders.push(`${rel}: ${bad[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the three known callers route through apptHref', () => {
    // Named individually because the scan above only proves the ABSENCE of a
    // hardcoded path — deleting the navigation entirely would also pass it.
    expect(read('src/components/tech/TimeTracker.jsx'))
      .toContain('navigate(apptHref(apptId, jobId))');
    expect(read('src/components/tech/StalledWidget.jsx'))
      .toContain('navigate(apptHref(r.appointment_id, r.job_id))');
    expect(read('src/lib/techShellRoutes.js'))
      .toContain('if (appt) return apptHref(appt[1]);');
    // ClockSupersedeSheet must forward the job id or TimeTracker's call above
    // silently degrades to the legacy URL for every supersede.
    expect(read('src/components/tech/ClockSupersedeSheet.jsx'))
      .toContain('onGoToJob(open.appointment_id, open.job_id)');
  });
});
