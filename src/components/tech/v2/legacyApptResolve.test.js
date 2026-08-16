/**
 * ════════════════════════════════════════════════
 * FILE: legacyApptResolve.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the two decisions behind the appointment redirect: when a technician
 *   with the Job Hub should be forwarded to it, and what the forwarding address
 *   looks like. The cases that matter are the ones where forwarding is WRONG —
 *   an appointment with no job, and an appointment the viewer isn't allowed to
 *   see — because getting those wrong turns a working page into a dead end.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { resolveApptRedirect, buildHubApptUrl } from './legacyApptResolve.js';

describe('resolveApptRedirect', () => {
  it('redirects an appointment that belongs to a job', () => {
    expect(resolveApptRedirect({ id: 'a1', job_id: 'j1' }))
      .toEqual({ redirect: true, jobId: 'j1' });
  });

  it('does NOT redirect an appointment with no job', () => {
    // A personal block or an office event. The Hub is job-rooted, so there is
    // nowhere to send them — the legacy page still renders it.
    expect(resolveApptRedirect({ id: 'a1', job_id: null }))
      .toEqual({ redirect: false, jobId: null });
  });

  it('does NOT redirect when the RPC returned nothing', () => {
    // get_appointment_detail returns NULL for a private appointment the caller
    // may not see. That must degrade to the legacy page's own not-found
    // handling, never to a redirect loop or an error screen.
    expect(resolveApptRedirect(null)).toEqual({ redirect: false, jobId: null });
    expect(resolveApptRedirect(undefined)).toEqual({ redirect: false, jobId: null });
  });

  it('does NOT redirect on a malformed payload', () => {
    expect(resolveApptRedirect('nope')).toEqual({ redirect: false, jobId: null });
    expect(resolveApptRedirect({})).toEqual({ redirect: false, jobId: null });
    expect(resolveApptRedirect({ job_id: 42 })).toEqual({ redirect: false, jobId: null });
  });
});

describe('buildHubApptUrl', () => {
  it('pins ?appt= so the Hub opens the visit the link was about', () => {
    // The pin is what satisfies resolveHero rule 2. Without it the Hub picks a
    // default visit and a months-old push opens the wrong one.
    expect(buildHubApptUrl('j1', 'a1')).toBe('/tech/job/j1?appt=a1');
  });

  it('keeps other query params from the incoming URL', () => {
    expect(buildHubApptUrl('j1', 'a1', '?from=push&x=2'))
      .toBe('/tech/job/j1?from=push&x=2&appt=a1');
  });

  it('overwrites a conflicting appt param rather than duplicating it', () => {
    expect(buildHubApptUrl('j1', 'a1', '?appt=stale'))
      .toBe('/tech/job/j1?appt=a1');
  });
});
