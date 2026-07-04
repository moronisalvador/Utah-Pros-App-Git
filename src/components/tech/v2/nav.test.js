/**
 * ════════════════════════════════════════════════
 * FILE: nav.test.js  (tech v2 nav helpers)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the appointment/job link helpers point at the right screen — the
 *   legacy detail pages by default, and the new Job Hub only after the per-user
 *   hub switch is turned on (which AuthContext does from the page:tech_job_hub
 *   flag). Turning it back off returns every link to the legacy pages, which is
 *   the "easy revert" guarantee.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./nav.js
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, afterEach } from 'vitest';
import { apptHref, jobHref, setHubNav, isHubNav } from './nav.js';

// The switch is a module singleton — reset after every test so order can't leak.
afterEach(() => setHubNav(false));

describe('nav helpers — hub switch off (default)', () => {
  it('appointments open the legacy appointment page', () => {
    expect(apptHref('appt-1', 'job-1')).toBe('/tech/appointment/appt-1');
  });
  it('jobs open the legacy job page', () => {
    expect(jobHref('job-1')).toBe('/tech/jobs/job-1');
  });
  it('isHubNav reflects the off state', () => {
    expect(isHubNav()).toBe(false);
  });
});

describe('nav helpers — hub switch on (flag enabled for this viewer)', () => {
  it('appointments open the hub, rooted at the job with ?appt=', () => {
    setHubNav(true);
    expect(apptHref('appt-1', 'job-1')).toBe('/tech/job/job-1?appt=appt-1');
  });
  it('jobs open the hub', () => {
    setHubNav(true);
    expect(jobHref('job-1')).toBe('/tech/job/job-1');
  });
  it('an appointment with no jobId still falls back to legacy (hub is job-rooted)', () => {
    setHubNav(true);
    expect(apptHref('appt-1')).toBe('/tech/appointment/appt-1');
  });
  it('isHubNav reflects the on state', () => {
    setHubNav(true);
    expect(isHubNav()).toBe(true);
  });
});

describe('nav helpers — revert', () => {
  it('flipping the switch back off returns every link to legacy', () => {
    setHubNav(true);
    expect(jobHref('job-1')).toBe('/tech/job/job-1');
    setHubNav(false); // the DevTools flag-off path
    expect(jobHref('job-1')).toBe('/tech/jobs/job-1');
    expect(apptHref('appt-1', 'job-1')).toBe('/tech/appointment/appt-1');
  });
});
