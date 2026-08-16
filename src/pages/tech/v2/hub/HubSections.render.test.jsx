/**
 * ════════════════════════════════════════════════
 * FILE: HubSections.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Renders the Job Hub's section list and checks the right rows appear for the
 *   right job. The cases that matter are the ones where a row must NOT be there:
 *   the drying log on a reconstruction job, and the Tasks row on a job nobody is
 *   visiting.
 *
 *   It is the FIRST render coverage in the hub folder. The rest of that folder's
 *   historical gap is not closed here — new work ships with tests; a backfill is
 *   its own job.
 *
 * NOTES / GOTCHAS:
 *   - Runs in the `node` environment against static markup. It proves STRUCTURE
 *     and GATING — which rows exist, and what is inside them when open — and NOT
 *     interaction. Tapping a header open, scrolling to Dry Logs from the More
 *     sheet, and the feel of it are device checks, named as owner gates.
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

describe('HubSections — the four-row section list', () => {
  it('renders four rows in appointment mode, in the approved order', () => {
    const output = render({ isJobMode: false });
    const order = ['Dry logs', 'Tasks', 'Rooms', 'Visits'].map((label) => output.indexOf(label));
    expect(order.every((i) => i > -1), 'every row must render').toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('does NOT render an Activity row — that is a real event feed, shipping later', () => {
    // Owner ruling 2026-08-15. The artifact draws five rows; the fifth means a
    // genuine event feed, not the photos-and-notes zone relabelled.
    expect(render({ isJobMode: false })).not.toContain('Activity');
  });

  it('hides Dry logs on a reconstruction job', () => {
    // The owner requirement: reconstruction jobs must stop being shown
    // mitigation-only UI. It rendered as permanent empty states with live
    // "+ Add reading" buttons.
    const output = render({ isJobMode: false, job: { id: 'job-1', division: 'reconstruction' } });
    expect(output).not.toContain('Dry logs');
    // …and everything else still stands.
    expect(output).toContain('Tasks');
    expect(output).toContain('Visits');
  });

  it('keeps Dry logs on every other division', () => {
    for (const division of ['water', 'mold', 'fire']) {
      expect(render({ isJobMode: false, job: { id: 'job-1', division } }), division)
        .toContain('Dry logs');
    }
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

  it('keeps Dry logs and Tasks CLOSED by default in both modes', () => {
    // Matches the approved artifact. This shipped the other way first (both
    // open in appointment mode, to keep stalled badges visible); the owner
    // ruled against it on 2026-08-15 after seeing it rendered — with no
    // readings, no equipment and no tasks, which is the common case until
    // H2-e, the two open rows were ~500px of empty state.
    //
    // Asserted on section CONTENT, not on aria-expanded: a closed row renders
    // no children at all, and aria-expanded="true" appears somewhere in BOTH
    // modes, so it cannot tell the two apart.
    const visit = render({ isJobMode: false });
    expect(visit, 'Dry logs closed in appointment mode').not.toContain('Moisture');
    expect(visit, 'Tasks closed in appointment mode').not.toContain('Add task');
    // The row itself is still THERE — collapsed, not removed.
    expect(visit, 'Dry logs row present').toContain('Dry logs');
    expect(visit, 'Tasks row present').toContain('Tasks');

    const job = render({ isJobMode: true, selectedId: null });
    expect(job, 'Dry logs closed in job mode').not.toContain('Moisture');
    // Job mode opens Visits instead — the row a job-nav viewer actually wants,
    // and the one deliberate exception to closed-by-default.
    expect(job, 'Visits open in job mode').toContain('Schedule appointment');
  });

  it('a closed row mounts none of its children, so it costs no query', () => {
    // This is what lets the Rooms and Dry Logs rows carry live data without
    // slowing a cold start.
    const job = render({ isJobMode: true, selectedId: null });
    expect(job).not.toContain('No readings yet');
  });
});
