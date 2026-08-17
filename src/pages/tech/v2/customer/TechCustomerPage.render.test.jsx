/**
 * ════════════════════════════════════════════════
 * FILE: TechCustomerPage.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Renders the field customer screen in each of the states it can be in — still
 *   loading, failed to load, nobody by that id, opened from a job, and opened on
 *   its own — and checks each one shows the right thing. It is what catches a
 *   screen that renders blank, or a failure that quietly reads as "no customer".
 *
 * NOTES / GOTCHAS:
 *   - This runs in the `node` environment against static markup. It proves
 *     STRUCTURE and GATING — which sections exist in which mode — and NOT
 *     interaction. Tapping Edit, typing and saving is a device check, and it is
 *     named as an owner gate in the PR rather than implied by these passing.
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const dbState = vi.hoisted(() => ({
  hub: null,
  contact: null,
  throwOn: null,
}));

// openInAppThread pulls in the realtime client, which needs Supabase env this
// lane deliberately does not carry. Only getAuthHeader is reached from here.
vi.mock('@/lib/realtime', () => ({ getAuthHeader: async () => ({}) }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    db: {
      rpc: vi.fn(async (fn) => {
        if (dbState.throwOn === fn) throw new Error('boom');
        if (fn === 'get_job_hub') return dbState.hub;
        return [];
      }),
      select: vi.fn(async (table) => {
        if (dbState.throwOn === table) throw new Error('boom');
        if (table === 'contacts') return dbState.contact ? [dbState.contact] : [];
        return [];
      }),
      update: vi.fn(async () => null),
      insert: vi.fn(async () => []),
      delete: vi.fn(async () => null),
    },
    employee: { id: 'employee-1', role: 'field_tech' },
    isFeatureEnabled: () => true,
  }),
}));

const { default: i18n } = await import('@/i18n');
const { default: TechCustomerPage } = await import('./TechCustomerPage.jsx');

/**
 * Render at a URL. `seed` pre-populates the query cache so the component paints
 * its loaded state synchronously — server rendering never awaits a query.
 */
function render(url, seed) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  // A real <Route path> — without one useParams() yields no contactId and every
  // query sits disabled, which renders a skeleton and would pass nothing.
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/tech/customer/:contactId" element={<TechCustomerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const JOB = {
  id: 'job-1',
  job_number: 'W-2606-025',
  insurance_company: 'State Farm',
  policy_number: 'POL-77',
  claim_number: 'CLM-42',
  date_of_loss: '2026-05-04',
  type_of_loss: 'water_damage',
  adjuster_name: 'Dana Fields',
};

const HUB = {
  job: JOB,
  claim: { id: 'claim-1', claim_number: 'CLM-2606-001' },
  contacts: [
    { id: 'c1', link_id: 'l1', is_primary: true, role: 'primary_client', name: 'Ana Reyes', phone: '+18015550100', email: 'ana@example.com' },
    { id: 'c2', link_id: 'l2', role: 'adjuster', name: 'Bo Chen', phone: '+18015550111' },
  ],
};

afterEach(() => {
  i18n.changeLanguage('en');
  dbState.hub = null;
  dbState.contact = null;
  dbState.throwOn = null;
  vi.clearAllMocks();
});

describe('TechCustomerPage — render contract', () => {
  it('shows a skeleton on a cold start, never a blank page', () => {
    const output = render('/tech/customer/c1?job=job-1');
    expect(output).toContain('tv2-skel');
  });

  it('job mode renders identity, insurance and the other job contacts', () => {
    const output = render('/tech/customer/c1?job=job-1', (client) => {
      client.setQueryData(['tech', 'hub', 'job-1'], HUB);
    });

    expect(output).toContain('Ana Reyes');
    expect(output).toContain('W-2606-025');
    // The JOB's insurance, which is what the office screens edit too.
    expect(output).toContain('State Farm');
    expect(output).toContain('POL-77');
    expect(output).toContain('CLM-42');
    // Read-only, claim-owned facts are shown but not editable here.
    expect(output).toContain('Dana Fields');
    // The claim breadcrumb.
    expect(output).toContain('CLM-2606-001');
    // The OTHER contact, not this one, in the additional-contacts section.
    expect(output).toContain('Bo Chen');
    expect(output).toContain('Also on this job');
  });

  it('job mode leads with the contact in the URL, not the job primary', () => {
    const output = render('/tech/customer/c2?job=job-1', (client) => {
      client.setQueryData(['tech', 'hub', 'job-1'], HUB);
    });
    // Bo is the identity; Ana moves into the list below.
    expect(output).toContain('tv2-cust-identity__name">Bo Chen');
    expect(output).toContain('Ana Reyes');
  });

  it('contact mode drops the additional-contacts section entirely', () => {
    // No job means nothing to attach anyone TO — the section would be a lie.
    const output = render('/tech/customer/c1', (client) => {
      client.setQueryData(['tech', 'customer', 'c1'], {
        id: 'c1', name: 'Ana Reyes', phone: '+18015550100', insurance_carrier: 'Allstate', policy_number: 'P-9',
      });
    });

    expect(output).toContain('Ana Reyes');
    expect(output).not.toContain('Also on this job');
    // Contact-level insurance defaults, not a job's.
    expect(output).toContain('Allstate');
    expect(output).toContain('On file');
  });

  it('a failed load renders the error state, NEVER the empty state', async () => {
    // loading-error-states.md §1 — the highest-impact rule on this page. A
    // dropped connection must not read as "this customer does not exist".
    // The error is produced by react-query's own machinery (a rejected
    // fetchQuery), not by hand-setting cache state, so this really is the
    // component's error branch rather than a stand-in for it.
    // retryOnMount:false is REQUIRED, not cosmetic. With it left on (the
    // default), a fresh observer mounting over an errored query flips the
    // observed result straight back to pending/fetching, so the error branch is
    // unreachable in a static-markup harness and the test would silently be
    // asserting against a skeleton.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
    await client
      .fetchQuery({
        queryKey: ['tech', 'customer', 'c1'],
        queryFn: async () => { throw new Error('offline'); },
      })
      .catch(() => {});

    const output = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/tech/customer/c1']}>
          <Routes>
            <Route path="/tech/customer/:contactId" element={<TechCustomerPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(output).toContain('role="alert"');
    expect(output).toContain('Check your connection');
    // The two states are distinct: a failure must not borrow the not-found copy.
    expect(output).not.toContain('Customer not found');
  });

  it('a successful load with no such contact renders a DISTINCT not-found state', () => {
    const output = render('/tech/customer/c9', (client) => {
      client.setQueryData(['tech', 'customer', 'c9'], null);
    });
    expect(output).toContain('Customer not found');
    // Not the failure copy — telling a tech to retry a lookup that succeeded is
    // a dead end.
    expect(output).not.toContain('Check your connection');
  });
});
