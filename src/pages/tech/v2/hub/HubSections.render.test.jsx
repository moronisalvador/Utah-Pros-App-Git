/**
 * ════════════════════════════════════════════════
 * FILE: HubSections.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Renders the Job Hub's section list and checks the right rows appear for the
 *   right job. The case that matters most is the one where a row must NOT be
 *   there: the Tasks row on a job nobody is visiting.
 *
 *   It is the FIRST render coverage in the hub folder. The rest of that folder's
 *   historical gap is not closed here — new work ships with tests; a backfill is
 *   its own job.
 *
 * NOTES / GOTCHAS:
 *   - Runs in the `node` environment against static markup. It proves STRUCTURE
 *     and GATING — which rows exist, and what is inside them when open — and NOT
 *     interaction. Tapping a header open, opening Dry logs from the More sheet,
 *     and the feel of it are device checks, named as owner gates.
 *   - Dry Logs is NO LONGER one of these rows (owner ruling 2026-08-19): it is
 *     a screen at /tech/job/:jobId/dry-logs, reached from the action bar. The
 *     division-gate cases that used to live here moved to
 *     tests/qa/unit/job-hub-sections-contract.test.js, which now pins the
 *     button, the route and the page against the same showsDryingTools helper.
 *     Deleting them outright would have quietly dropped the reconstruction
 *     guarantee the owner asked for.
 *   - Sections default OPEN in appointment mode, so their contents are visible
 *     to these assertions there and deliberately absent in job mode.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const authState = vi.hoisted(() => ({ flags: {} }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: { rpc: vi.fn(async () => []), select: vi.fn(async () => []), baseUrl: 'https://example.test' },
    employee: { id: 'employee-1', role: 'field_tech' },
    isFeatureEnabled: (key) => authState.flags[key] !== false,
  }),
}));

const { default: i18n } = await import('@/i18n');
const { default: HubSections } = await import('./HubSections.jsx');

const APPOINTMENTS = [
  {
    id: 'appt-1', date: '2999-01-01', time_start: '09:00:00', status: 'scheduled',
    title: 'Initial inspection', task_total: 4, task_completed: 1, crew: [],
  },
];

function render(props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tech/job/job-1']}>
        <HubSections
          jobId="job-1"
          jobNumber="W-2606-025"
          job={{ id: 'job-1', division: 'water', job_number: 'W-2606-025' }}
          appointments={APPOINTMENTS}
          selectedId="appt-1"
          contacts={[]}
          claim={{ id: 'claim-1', claim_number: 'CLM-1' }}
          rooms={[]}
          roomsEnabled
          onSelect={() => {}}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  authState.flags = {};
  i18n.changeLanguage('en');
});

describe('HubSections — the three-row section list', () => {
  it('renders three rows in appointment mode, in the approved order', () => {
    const output = render({ isJobMode: false });
    const order = ['Tasks', 'Rooms', 'Visits'].map((label) => output.indexOf(label));
    expect(order.every((i) => i > -1), 'every row must render').toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('renders NO Dry logs row on any division — it is a screen now', () => {
    // The relocation, asserted where it is visible. On water/mold/fire the row
    // used to be present; on reconstruction it was hidden. Now none of the
    // four render it here, and the division gate lives with the button and the
    // route instead (job-hub-sections-contract.test.js).
    for (const division of ['water', 'mold', 'fire', 'reconstruction']) {
      expect(render({ isJobMode: false, job: { id: 'job-1', division } }), division)
        .not.toContain('Dry logs');
    }
  });

  it('does NOT render an Activity row — that is a real event feed, shipping later', () => {
    // Owner ruling 2026-08-15. The artifact draws five rows; the fifth means a
    // genuine event feed, not the photos-and-notes zone relabelled.
    expect(render({ isJobMode: false })).not.toContain('Activity');
  });

  it('leaves the rest of the list standing on a reconstruction job', () => {
    // The owner requirement that produced the drying gate in the first place:
    // a reconstruction job must not be shown mitigation-only UI — and must not
    // lose anything else along with it.
    const output = render({ isJobMode: false, job: { id: 'job-1', division: 'reconstruction' } });
    expect(output).toContain('Tasks');
    expect(output).toContain('Visits');
  });

  it('drops the Tasks row in job mode — the stat card already carries the count', () => {
    const output = render({ isJobMode: true, selectedId: null });
    expect(output).not.toContain('Tasks');
    expect(output).toContain('Visits');
  });

  it('shows the visit task count on the Tasks header without a second fetch', () => {
    // task_completed / task_total ride the hub frame row already on screen.
    expect(render({ isJobMode: false })).toContain('1/4');
  });

  it('hides the Rooms row when the rooms feature is off', () => {
    const output = render({ isJobMode: false, roomsEnabled: false });
    expect(output).not.toContain('>Rooms<');
  });

  it('keeps Job & Claim, Photos & Notes and the report button below the rows', () => {
    const output = render({ isJobMode: false });
    expect(output).toContain('Job &amp; Claim');
    expect(output).toContain('Photos');
    // The rows come first; the reference card and gallery stay beneath them.
    expect(output.indexOf('Visits')).toBeLessThan(output.indexOf('Job &amp; Claim'));
  });

  it('keeps Tasks CLOSED by default in both modes', () => {
    // Matches the approved artifact. This shipped the other way first (open in
    // appointment mode); the owner ruled against it on 2026-08-15 after seeing
    // it rendered — with no tasks, the common case, the open row was empty
    // state pushing Rooms and Visits down the screen.
    //
    // Asserted on section CONTENT, not on aria-expanded: a closed row renders
    // no children at all, and aria-expanded="true" appears somewhere in BOTH
    // modes, so it cannot tell the two apart.
    const visit = render({ isJobMode: false });
    expect(visit, 'Tasks closed in appointment mode').not.toContain('Add task');
    // The row itself is still THERE — collapsed, not removed.
    expect(visit, 'Tasks row present').toContain('Tasks');

    const job = render({ isJobMode: true, selectedId: null });
    // Job mode opens Visits instead — the row a job-nav viewer actually wants,
    // and the one deliberate exception to closed-by-default.
    expect(job, 'Visits open in job mode').toContain('Schedule appointment');
  });

  it('a closed row mounts none of its CHILDREN, so their queries do not fire', () => {
    // This is what lets the Rooms row carry live data without slowing a cold
    // start. Simpler than it was: the H2-e1 caveat here described the Dry Logs
    // summary that HubSections fetched eagerly to fill a collapsed label. Both
    // the row and that fetch left on 2026-08-19, so the list is free again.
    const job = render({ isJobMode: true, selectedId: null });
    expect(job).not.toContain('No rooms yet');
  });
});
