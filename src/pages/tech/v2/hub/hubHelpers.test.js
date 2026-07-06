/**
 * ════════════════════════════════════════════════
 * FILE: hubHelpers.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the small pure helpers behind the merged Job Hub screen so the
 *   riskiest bits of the merge are proven, not assumed. It proves three things:
 *   (1) the visit picker selects the right appointment whether the URL's ?appt=
 *       is present, missing, or a stale id that isn't on this job — always
 *       falling back to today's / the next visit;
 *   (2) the "No signed Work Authorization" banner fires under exactly the same
 *       conditions as BOTH legacy pages it replaces (job present AND not signed,
 *       never during load, never on a job-less private appointment);
 *   (3) the job_documents fallback query string is byte-identical to the legacy
 *       appointment-OR-job query so no older photo/note silently disappears.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Internal:  ./hubHelpers (selectVisitId, showWorkAuthBanner, buildDocsQuery)
 *   Data:      none (pure functions, literal fixtures)
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { selectVisitId, showWorkAuthBanner, buildDocsQuery } from './hubHelpers.js';

const TODAY = '2026-07-04';
const ME = 'emp-me';
const OTHER = 'emp-other';

// A job's appointments as get_job_hub returns them (sorted date DESC), with the
// crew shape { employee_id, full_name, role }.
const mkAppt = (id, date, status, opts = {}) => ({
  id, job_id: 'job-1', date, status,
  time_start: opts.time_start ?? '09:00:00',
  crew: opts.crew ?? [{ employee_id: ME, full_name: 'Me Tech', role: 'lead' }],
  ...opts,
});

describe('selectVisitId — visit-picker selection', () => {
  const appts = [
    mkAppt('a-future', '2026-07-10', 'scheduled'),
    mkAppt('a-today', TODAY, 'scheduled'),
    mkAppt('a-past', '2026-06-20', 'completed'),
  ];

  it('honors a valid ?appt= id that is on this job', () => {
    expect(selectVisitId(appts, 'a-past', ME, TODAY)).toBe('a-past');
  });

  it('falls back to the default when ?appt= is absent', () => {
    // today's mine wins over the future one
    expect(selectVisitId(appts, null, ME, TODAY)).toBe('a-today');
  });

  it('ignores a STALE ?appt= id not on this job and uses the default', () => {
    expect(selectVisitId(appts, 'a-does-not-exist', ME, TODAY)).toBe('a-today');
  });

  it('prefers a live appointment the tech is on over today/next', () => {
    const live = [
      mkAppt('a-today', TODAY, 'scheduled'),
      mkAppt('a-live', TODAY, 'in_progress'),
    ];
    expect(selectVisitId(live, null, ME, TODAY)).toBe('a-live');
  });

  it('a live appointment the tech is NOT on does not hijack the selection', () => {
    const live = [
      mkAppt('a-today', TODAY, 'scheduled'),
      mkAppt('a-live-other', TODAY, 'in_progress', { crew: [{ employee_id: OTHER, full_name: 'Someone Else', role: 'lead' }] }),
    ];
    expect(selectVisitId(live, null, ME, TODAY)).toBe('a-today');
  });

  it('falls to the next upcoming when nothing is today', () => {
    const future = [mkAppt('a-future', '2026-07-10', 'scheduled'), mkAppt('a-past', '2026-06-20', 'completed')];
    expect(selectVisitId(future, null, ME, TODAY)).toBe('a-future');
  });

  it('falls to the most recent past visit when there is no upcoming work', () => {
    const past = [
      mkAppt('a-old', '2026-06-01', 'completed'),
      mkAppt('a-recent', '2026-06-25', 'completed'),
    ];
    expect(selectVisitId(past, null, ME, TODAY)).toBe('a-recent');
  });

  it('returns null when the job has no appointments', () => {
    expect(selectVisitId([], 'anything', ME, TODAY)).toBeNull();
    expect(selectVisitId(null, null, ME, TODAY)).toBeNull();
  });
});

describe('showWorkAuthBanner — predicate parity with both legacy pages', () => {
  it('shows when a job is present and work auth is not signed (both legacy pages)', () => {
    expect(showWorkAuthBanner({ job: { id: 'job-1' }, work_auth_signed: false })).toBe(true);
  });

  it('hides when work auth IS signed', () => {
    expect(showWorkAuthBanner({ job: { id: 'job-1' }, work_auth_signed: true })).toBe(false);
  });

  it('never flashes during load (no hub payload yet → assume signed)', () => {
    expect(showWorkAuthBanner(null)).toBe(false);
    expect(showWorkAuthBanner(undefined)).toBe(false);
  });

  it('hides on a job-less appointment (TechAppointment sets signed=true when no parent job)', () => {
    expect(showWorkAuthBanner({ job: null, work_auth_signed: false })).toBe(false);
    expect(showWorkAuthBanner({ work_auth_signed: false })).toBe(false);
  });
});

describe('buildDocsQuery — job_documents fallback parity', () => {
  it('matches the legacy TechAppointment OR-fallback when both ids are known', () => {
    // Parity target — TechAppointment.jsx:156
    expect(buildDocsQuery({ appointmentId: 'appt-1', jobId: 'job-1' }))
      .toBe('or=(appointment_id.eq.appt-1,job_id.eq.job-1)&select=*&order=created_at.desc');
  });

  it('matches the legacy appointment-only query when the job id is unknown', () => {
    // Parity target — TechAppointment.jsx:157
    expect(buildDocsQuery({ appointmentId: 'appt-1', jobId: null }))
      .toBe('appointment_id=eq.appt-1&select=*&order=created_at.desc');
  });

  it('builds a job-wide query for the hub gallery when only the job id is known', () => {
    expect(buildDocsQuery({ appointmentId: null, jobId: 'job-1' }))
      .toBe('job_id=eq.job-1&select=*&order=created_at.desc');
  });

  it('returns null when neither id is known (nothing to query)', () => {
    expect(buildDocsQuery({ appointmentId: null, jobId: null })).toBeNull();
  });
});
