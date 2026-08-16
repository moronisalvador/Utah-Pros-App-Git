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
 *   "Take a reading" scrolls to wherever the moisture log lives, so moving the
 *   log without moving the target lands that menu item nowhere. A scroll to a
 *   ref that no longer exists fails silently — no error, no console warning,
 *   just a menu item that does nothing.
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

  it('the take-a-reading target and the Dry Logs row moved together', () => {
    // The sequencing trap. HubTools is now housed in HubSections, so the ref
    // the More sheet scrolls to must be there too — not still on a stage that
    // no longer renders it.
    const sections = read(`${HUB}/HubSections.jsx`);
    expect(sections).toContain('HubTools');
    expect(sections).toContain('ref={toolsRef}');

    for (const stage of ['HubStage.jsx', 'JobStage.jsx']) {
      const source = read(`${HUB}/${stage}`);
      expect(source, stage).not.toContain('HubTools');
      expect(source, stage).not.toContain('toolsRef');
    }

    // …and the page still wires both halves: the scroll AND the open signal,
    // because the row it lands on can be collapsed.
    const page = read('src/pages/tech/v2/TechJobHub.jsx');
    expect(page).toContain('onTakeReading={scrollToTools}');
    expect(page).toContain('setToolsSignal');
    expect(page).toContain('toolsSignal={toolsSignal}');
  });

  it('every surface showing drying UI asks the SAME division gate', () => {
    // A row offered in one place and not the other is the bug the shared helper
    // exists to prevent. Four consumers, one helper, no second opinion.
    for (const file of [
      `${HUB}/HubSections.jsx`,
      `${HUB}/HubMoreSheet.jsx`,
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
