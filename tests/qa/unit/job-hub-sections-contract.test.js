/**
 * ════════════════════════════════════════════════
 * FILE: job-hub-sections-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the couplings in the Job Hub's section list that are easy to break
 *   later and silent when they break — chiefly that every existing way into a
 *   section still lands on something real, and that the one gate deciding
 *   whether a job dries is asked in every place that shows drying UI.
 *
 * WHY THIS EXISTS:
 *   The wave plan calls this out as its sequencing trap: the More sheet's
 *   "Take a reading" points at wherever the moisture log lives, so moving the
 *   log without moving the target lands that menu item nowhere. It fails
 *   SILENTLY — no error, no console warning, just a menu item that does
 *   nothing. That trap sprang for real on 2026-08-19, when drying moved off
 *   the Hub body onto its own screen; these assertions moved with it rather
 *   than being deleted, which is the only reason they still protect anything.
 *
 * NOTES / GOTCHAS:
 *   - Source-contract test (credential-free lane). Rendering is covered by
 *     HubSections.render.test.jsx; tapping through is a device gate.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const HUB = 'src/pages/tech/v2/hub';

describe('Job Hub — the section list (H2-b)', () => {
  it('retired HubBelowFold rather than leaving two layout owners', () => {
    expect(() => read(`${HUB}/HubBelowFold.jsx`)).toThrow();
    const page = read('src/pages/tech/v2/TechJobHub.jsx');
    expect(page).toContain("import HubSections from './hub/HubSections.jsx'");
    expect(page).not.toContain('HubBelowFold');
  });

  it('the take-a-reading target and the drying log moved together', () => {
    // The sequencing trap, in its 2026-08-19 form. HubTools now lives on its
    // own route, so the More sheet must NAVIGATE there — a leftover scroll to
    // a ref no page renders any more is the silent failure described above.
    const drylogs = read('src/pages/tech/v2/TechDryLogs.jsx');
    expect(drylogs).toContain('HubTools');

    // Exactly one owner. A second copy on the Hub body or a stage would mean
    // two moisture logs disagreeing about the same job.
    for (const orphan of ['HubSections.jsx', 'HubStage.jsx', 'JobStage.jsx']) {
      const source = read(`${HUB}/${orphan}`);
      expect(source, orphan).not.toContain('HubTools');
      expect(source, orphan).not.toContain('toolsRef');
    }

    // …and the page wires the menu item at the destination, not at a ref.
    const page = read('src/pages/tech/v2/TechJobHub.jsx');
    expect(page).toContain('onTakeReading={openDryLogs}');
    expect(page).toContain('/dry-logs`');
    expect(page).not.toContain('toolsSignal');
    expect(page).not.toContain('toolsRef');
  });

  it('the action bar button and the route it opens agree on the address', () => {
    // A button and a route that disagree by one character is a dead tap that
    // every build, lint and unit gate passes over.
    const bar = read(`${HUB}/HubActionBar.jsx`);
    expect(bar).toContain('/dry-logs`');

    const app = read('src/App.jsx');
    expect(app).toContain('tech/job/:jobId/dry-logs');
    // Registered in the SHARED tech block, so the native build gets it too.
    // A page in the native registry with no route is a silent dead link the
    // build cannot see (Lead Center, 2026-08-08).
    expect(app.indexOf('tech/job/:jobId/dry-logs'))
      .toBeGreaterThan(app.indexOf('function TechRoutes()'));
    expect(app.indexOf('tech/job/:jobId/dry-logs'))
      .toBeLessThan(app.indexOf('function NativeRoutes()'));

    // Same flag as its parent: the only way in is the Hub.
    expect(app).toMatch(/tech\/job\/:jobId\/dry-logs[^\n]*page:tech_job_hub/);

    for (const registry of ['web', 'native']) {
      const src = read(`src/routes/buildTargetPages.${registry}.jsx`);
      expect(src, registry).toContain("import('@/pages/tech/v2/TechDryLogs')");
      expect(src, registry).toContain('TechDryLogs,');
    }
    expect(read('scripts/native-bundle-boundary.mjs'))
      .toContain("'src/pages/tech/v2/TechDryLogs.jsx'");
  });

  it('every surface showing drying UI asks the SAME division gate', () => {
    // A row offered in one place and not the other is the bug the shared helper
    // exists to prevent. Four consumers, one helper, no second opinion. Since
    // 2026-08-19 the drying consumers are the action-bar BUTTON and the ROUTE
    // it opens — a button that should not exist pointing at a route that would
    // refuse is the same divergence wearing different clothes.
    for (const file of [
      `${HUB}/HubActionBar.jsx`,
      `${HUB}/HubMoreSheet.jsx`,
      'src/pages/tech/v2/TechDryLogs.jsx',
      'src/components/tech/GenerateReportButton.jsx',
    ]) {
      expect(read(file), file).toContain('showsDryingTools');
    }
    // And it is written as hide-for-reconstruction, never as an allowlist: the
    // two MITIGATION_DIVS constants in this repo disagree about `fire`.
    const helpers = read(`${HUB}/hubHelpers.js`);
    expect(helpers).toContain("return division !== 'reconstruction';");
  });

  it('GenerateReportButton keeps its division prop OPTIONAL', () => {
    // The legacy appointment screen renders it prop-less and must be untouched.
    const source = read('src/components/tech/GenerateReportButton.jsx');
    expect(source).toContain('division === undefined || showsDryingTools(division)');
    expect(read('src/pages/tech/TechAppointment.jsx')).not.toContain('division={');
  });

  it('the checklist only drops its own header when a section carries it', () => {
    const checklist = read(`${HUB}/HubChecklist.jsx`);
    expect(checklist).toContain('embedded = false');
    // The section supplies title, count and the Edit-list link.
    const sections = read(`${HUB}/HubSections.jsx`);
    expect(sections).toContain('embedded');
    expect(sections).toContain("t('stage.editTasks')");
  });

  it('the hero Customer pill navigates instead of scrolling', () => {
    const page = read('src/pages/tech/v2/TechJobHub.jsx');
    expect(page).toContain('customerHref(primary.id, jobId)');
    // Passing undefined when there is no contact — the header already hides the
    // pill on a falsy handler, so a contact-less job never gets a dead tap.
    expect(page).toContain('primary?.id ?');
  });

  it('opening and closing a row is instant, and the chevron has a fallback', () => {
    // motion-standard.md §3: these are high-frequency controls, so instant is
    // CORRECT. §5: animating height is banned outright, and every transition
    // needs a reduced-motion fallback.
    const section = read(`${HUB}/HubSection.jsx`);
    expect(section).toContain('{open && ');
    expect(section).not.toMatch(/transition[^\n]*height/);

    const css = read('src/pages/tech/v2/job-hub.css');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('tv2-hub-collapse__chev');
  });

  it('every new hub module is in the sorted native allowlist', async () => {
    const { NATIVE_PAGE_ALLOWLIST } = await import('../../../scripts/native-bundle-boundary.mjs');
    expect(NATIVE_PAGE_ALLOWLIST).toContain(`${HUB}/HubSection.jsx`);
    expect(NATIVE_PAGE_ALLOWLIST).toContain(`${HUB}/HubSections.jsx`);
    expect(NATIVE_PAGE_ALLOWLIST).not.toContain(`${HUB}/HubBelowFold.jsx`);
    expect([...NATIVE_PAGE_ALLOWLIST]).toEqual([...NATIVE_PAGE_ALLOWLIST].sort());
  });
});
