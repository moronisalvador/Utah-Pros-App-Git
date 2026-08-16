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
 *       appointment-OR-job query so no older photo/note silently disappears;
 *   (4) the collapsed Dry Logs summary counts the right spots on the right day —
 *       including the cases that only show up on a real job, like a threshold
 *       that has not been set yet.
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
import { selectVisitId, resolveHero, showWorkAuthBanner, buildDocsQuery, showsDryingTools, dryingSummary } from './hubHelpers.js';

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

describe('resolveHero — visit hero vs job hero (spec §12.5)', () => {
  const futureAppt = mkAppt('a-future', '2026-07-10', 'scheduled');
  const todayAppt = mkAppt('a-today', TODAY, 'scheduled');
  const pastAppt = mkAppt('a-past', '2026-06-20', 'completed');
  const appts = [futureAppt, todayAppt, pastAppt];

  const hero = (apptParam, list = appts, employeeId = ME) =>
    resolveHero({ appointments: list, apptParam, employeeId, todayStr: TODAY });

  describe('rule 1 — a running clock always wins', () => {
    it.each(['en_route', 'in_progress', 'paused'])(
      'leads with the %s visit even when the URL names a different one',
      (status) => {
        const live = mkAppt('a-live', TODAY, status);
        const result = hero('a-past', [...appts, live]);
        expect(result).toMatchObject({ mode: 'appointment', visitId: 'a-live', reason: 'clock-running' });
      },
    );

    it('ignores a visit running for SOMEONE ELSE — that is not my clock', () => {
      const theirs = mkAppt('a-theirs', TODAY, 'in_progress', {
        crew: [{ employee_id: OTHER, full_name: 'Other Tech', role: 'lead' }],
      });
      // No ?appt=, so with their visit discounted this falls through to job mode.
      expect(hero(null, [theirs])).toMatchObject({ mode: 'job', visitId: null });
    });
  });

  describe('rule 2 — an appointment sent me here', () => {
    it('leads with the named visit when the URL pins one on this job', () => {
      expect(hero('a-past')).toMatchObject({
        mode: 'appointment', visitId: 'a-past', reason: 'from-appointment',
      });
    });

    it('does NOT trust a stale id that belongs to another job', () => {
      expect(hero('a-from-another-job')).toMatchObject({ mode: 'job', visitId: null });
    });
  });

  describe('rule 3 — I opened the job itself', () => {
    it('leads with the job when nothing is running and no visit was named', () => {
      expect(hero(null)).toMatchObject({ mode: 'job', visitId: null, reason: 'job-nav' });
    });

    it('leads with the job when the job has no visits at all', () => {
      expect(hero(null, [])).toMatchObject({ mode: 'job', visitId: null, reason: 'no-visits' });
    });

    it('never returns a visitId in job mode — that is what keeps the clock off the screen', () => {
      // A Finish button for a visit nobody started is the exact defect this prevents.
      expect(hero(null).visitId).toBeNull();
      expect(hero(null, []).visitId).toBeNull();
      expect(hero('not-on-this-job').visitId).toBeNull();
    });
  });

  describe('nextVisitId — what the "Next visit" row offers', () => {
    it('offers the soonest upcoming visit in job mode', () => {
      expect(hero(null).nextVisitId).toBe('a-today');
    });

    it('excludes the visit already being shown in appointment mode', () => {
      expect(hero('a-today').nextVisitId).toBe('a-future');
    });

    it('is null when every visit is done or in the past', () => {
      expect(hero(null, [pastAppt]).nextVisitId).toBeNull();
    });

    it('skips a cancelled visit', () => {
      const cancelled = mkAppt('a-cancelled', TODAY, 'cancelled', { time_start: '07:00:00' });
      expect(hero(null, [cancelled, futureAppt]).nextVisitId).toBe('a-future');
    });
  });

  it('tolerates a missing appointments array', () => {
    expect(resolveHero({ apptParam: null, employeeId: ME, todayStr: TODAY }))
      .toMatchObject({ mode: 'job', visitId: null });
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

describe('showsDryingTools', () => {
  it('hides the drying tools on a reconstruction job', () => {
    // The owner requirement this exists for: a reconstruction job was rendering
    // the Moisture and Equipment blocks as permanent empty states with live
    // "+ Add reading" buttons.
    expect(showsDryingTools('reconstruction')).toBe(false);
  });

  it('leaves every other division exactly as it is today', () => {
    for (const division of ['water', 'mold', 'fire', 'contents', 'remodeling']) {
      expect(showsDryingTools(division), division).toBe(true);
    }
  });

  it('shows them when the division is unknown', () => {
    // Written as HIDE-for-reconstruction rather than allow-the-mitigation-
    // divisions, deliberately: the two MITIGATION_DIVS constants in this repo
    // disagree about `fire`, so an allowlist would silently change fire jobs.
    // An absent division must not blank a working screen either.
    expect(showsDryingTools(null)).toBe(true);
    expect(showsDryingTools(undefined)).toBe(true);
    expect(showsDryingTools('')).toBe(true);
  });
});

// ─── SECTION: dryingSummary ──────────────
// The collapsed Dry Logs card. Each block below pins one of the four rules in
// the helper's JSDoc; they are decisions, not implementation details, so a
// future change that flips one should fail here rather than quietly ship.

describe('dryingSummary', () => {
  // Company day = the calendar day in America/Denver. Injected rather than
  // imported so these cases are deterministic on any machine: the mapper just
  // takes the date half of the ISO string.
  const dayOf = (instant) => String(instant).slice(0, 10);
  const TODAY_D = '2026-08-16';

  const mkReading = (opts = {}) => ({
    taken_at: `${TODAY_D}T15:00:00Z`,
    room_id: 'room-1',
    location_description: 'North wall',
    material: 'drywall',
    is_affected: true,
    mc_pct: 20,
    drying_goal_pct: 15,
    dry_standard_pct: 13,
    ...opts,
  });

  it('counts a wet and a dry spot, and numbers the drying day from the first reading', () => {
    const readings = [
      mkReading({ location_description: 'North wall', mc_pct: 12 }),           // dry
      mkReading({ location_description: 'South wall', mc_pct: 22 }),           // wet
      mkReading({ location_description: 'North wall', mc_pct: 40, taken_at: '2026-08-14T15:00:00Z' }),
    ];
    // Day 1 is 08-14, so 08-16 is day 3. The stale 08-14 North wall reading is
    // superseded by the newer one and must not be counted twice.
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf)).toEqual({ day: 3, dry: 1, total: 2 });
  });

  it('buckets the day on taken_at and IGNORES reading_date', () => {
    // reading_date is DEFAULT CURRENT_DATE in the database session's timezone
    // and insert_reading never sets it, so it is not company time. A row whose
    // reading_date disagrees with taken_at must follow taken_at.
    const readings = [mkReading({ taken_at: '2026-08-10T15:00:00Z', reading_date: '2001-01-01' })];
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf).day).toBe(7);
  });

  it('takes only the LATEST reading per room + location + material', () => {
    // get_job_readings returns newest-first, so first-seen wins. Three readings
    // of one spot is one spot.
    const readings = [
      mkReading({ mc_pct: 10 }),
      mkReading({ mc_pct: 30 }),
      mkReading({ mc_pct: 40 }),
    ];
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf)).toEqual({ day: 1, dry: 1, total: 1 });
  });

  it('treats the same location in different rooms or materials as separate spots', () => {
    const readings = [
      mkReading({ room_id: 'room-1', mc_pct: 10 }),
      mkReading({ room_id: 'room-2', mc_pct: 30 }),
      mkReading({ room_id: 'room-1', material: 'framing', mc_pct: 10 }),
    ];
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf)).toEqual({ day: 1, dry: 2, total: 3 });
  });

  it('excludes unaffected readings — they set the standard, they are not being dried', () => {
    const readings = [
      mkReading({ location_description: 'Wet spot', mc_pct: 30 }),
      mkReading({ location_description: 'Reference', is_affected: false, mc_pct: 8 }),
    ];
    // Counting the reference reading would report 1 of 2 dry on a job with
    // nothing dry at all.
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf)).toEqual({ day: 1, dry: 0, total: 1 });
  });

  it('drops unclassifiable readings from the denominator, never counts them wet or dry', () => {
    // Both threshold columns stay NULL until an unaffected reading exists for
    // that material — the normal early state on a fresh job.
    const readings = [
      mkReading({ location_description: 'A', mc_pct: 12 }),
      mkReading({ location_description: 'B', drying_goal_pct: null, dry_standard_pct: null, mc_pct: 30 }),
      mkReading({ location_description: 'C', mc_pct: null }),
    ];
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf)).toEqual({ day: 1, dry: 1, total: 1 });
  });

  it('falls back to dry_standard_pct when there is no drying goal', () => {
    const at = (mc, goal, std) => [mkReading({ mc_pct: mc, drying_goal_pct: goal, dry_standard_pct: std })];
    expect(dryingSummary(at(12, null, 13), { today: TODAY_D }, dayOf).dry).toBe(1);
    expect(dryingSummary(at(14, null, 13), { today: TODAY_D }, dayOf).dry).toBe(0);
  });

  it('counts a reading exactly at the goal as dry', () => {
    const readings = [mkReading({ mc_pct: 15, drying_goal_pct: 15 })];
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf).dry).toBe(1);
  });

  it('returns null when there is nothing worth showing, so the row renders as it does today', () => {
    expect(dryingSummary([], { today: TODAY_D }, dayOf)).toBe(null);
    expect(dryingSummary(null, { today: TODAY_D }, dayOf)).toBe(null);
    expect(dryingSummary(undefined, { today: TODAY_D }, dayOf)).toBe(null);
    // Readings exist but none can be classified — the common early state.
    expect(dryingSummary(
      [mkReading({ drying_goal_pct: null, dry_standard_pct: null })],
      { today: TODAY_D }, dayOf,
    )).toBe(null);
    // Only unaffected reference readings so far.
    expect(dryingSummary([mkReading({ is_affected: false })], { today: TODAY_D }, dayOf)).toBe(null);
  });

  it('returns null rather than guessing when its inputs are missing', () => {
    expect(dryingSummary([mkReading()], {}, dayOf)).toBe(null);
    expect(dryingSummary([mkReading()], { today: TODAY_D }, undefined)).toBe(null);
  });

  it('survives a null row and a reading with no taken_at', () => {
    const readings = [null, mkReading({ taken_at: null, location_description: 'No stamp', mc_pct: 12 })];
    // The undated reading still counts toward wet/dry; it just cannot start the
    // clock. With no dated reading at all there is no day, so: null.
    expect(dryingSummary(readings, { today: TODAY_D }, dayOf)).toBe(null);
  });

  it('spans a DST boundary without dropping or adding a day', () => {
    // US DST ends 2026-11-01. Anchoring at UTC noon is what keeps this exact.
    const readings = [mkReading({ taken_at: '2026-10-30T15:00:00Z' })];
    expect(dryingSummary(readings, { today: '2026-11-03' }, dayOf).day).toBe(5);
  });
});
