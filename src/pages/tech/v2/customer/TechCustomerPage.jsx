/**
 * ════════════════════════════════════════════════
 * FILE: TechCustomerPage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The customer screen for the field app — the person, not the job. It shows who
 *   the customer is with one tap to call, text or email them, the insurance
 *   details for the job the technician came from, and everyone else attached to
 *   that job. A technician can correct any of it right here, standing in front of
 *   the customer, without a laptop.
 *
 *   Arriving from the Job Hub it already knows the job, so it also shows that
 *   job's carrier, policy and claim numbers, and the job's other contacts.
 *   Opened on its own — straight after adding a new customer, say — it shows the
 *   person and the insurance details recorded against them.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/customer/:contactId?job=<jobId>
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, @tanstack/react-query, react-i18next
 *   Internal:  @/contexts/AuthContext, @/components/PullToRefresh,
 *              @/components/tech/v2 (SkeletonList), @/components/ui
 *              (ErrorState, EmptyState), @/lib/techQuery, @/lib/toast,
 *              @/lib/backNav, ./CustomerInfoSection, ./InsuranceSection,
 *              ./AdditionalContactsSection, ./customerHelpers
 *   Data:      reads  → get_job_hub (job mode — the SAME react-query key the Hub
 *                        uses, so arriving from the Hub paints with no new round
 *                        trip), contacts (contact mode)
 *              writes → contacts, jobs (insurance columns), contact_jobs — all
 *                        through the sections; every one already granted to
 *                        authenticated, so this screen needs NO migration.
 *
 * NOTES / GOTCHAS:
 *   - NO MIGRATION. contacts update/insert, the jobs insurance columns and
 *     contact_jobs insert/update/delete are all already granted to
 *     `authenticated` (the `anon_`-prefixed policy NAMES on contact_jobs are a
 *     rename vestige — the roles are authenticated). Verified against the policy
 *     migrations, not assumed.
 *   - CONSENT IS UNTOUCHABLE HERE. Phone and email are editable; `opt_in_*`,
 *     `opt_out_*` and `dnd` are not, and customerHelpers.buildContactPatch
 *     cannot emit them (AGENTS.md §14).
 *   - Three distinct states, never conflated (loading-error-states.md §2):
 *     cold-start skeleton, ErrorState with retry on a failed load, and a
 *     DIFFERENT not-found EmptyState when the load succeeded and the contact
 *     simply is not there.
 *   - Pull-to-refresh is the SILENT refetch and wraps the content BELOW the
 *     fixed header, never the header (tech-mobile-ux.md). No hand-rolled
 *     visibility listener anywhere — react-query's own refetchOnWindowFocus
 *     covers resume, silently (page-lifecycle.md §2).
 *   - Mutations invalidate the `contact` kind, which repaints `customer` AND
 *     `hub`: the Hub's hero title and contacts list both come out of
 *     get_job_hub, so a rename here must not leave the old name on the Hub.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { SkeletonList } from '@/components/tech/v2';
import { ErrorState, EmptyState } from '@/components/ui';
import { techKeys, invalidateTech } from '@/lib/techQuery';
import { toast } from '@/lib/toast';
import { goBackOr } from '@/lib/backNav';
import CustomerInfoSection from './CustomerInfoSection.jsx';
import InsuranceSection from './InsuranceSection.jsx';
import AdditionalContactsSection from './AdditionalContactsSection.jsx';
import { splitJobContacts, linkRoleOf } from './customerHelpers.js';
// Route-lazy: these styles ship in this chunk, not the app's boot CSS.
import './customer-page.css';

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function initialsOf(name) {
  if (!name) return '?';
  return name.split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function TechCustomerPage() {
  const { t } = useTranslation('customer');
  const { contactId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { db } = useAuth();
  const queryClient = useQueryClient();

  const jobId = searchParams.get('job');

  // JOB MODE — the same key the Hub caches under, so arriving from the Hub
  // paints instantly and this screen costs no extra round trip.
  const hubQuery = useQuery({
    queryKey: techKeys.hub(jobId),
    queryFn: () => db.rpc('get_job_hub', { p_job_id: jobId }),
    enabled: !!jobId,
  });

  // CONTACT MODE — the person on their own. Named columns, never select=*
  // (perf-budget.md §3).
  const contactQuery = useQuery({
    queryKey: techKeys.customer(contactId),
    queryFn: async () => {
      const rows = await db.select(
        'contacts',
        `id=eq.${contactId}&select=id,name,phone,email,company,role,insurance_carrier,policy_number&limit=1`,
      );
      return rows?.[0] || null;
    },
    enabled: !!contactId && !jobId,
  });

  const active = jobId ? hubQuery : contactQuery;

  const onMutation = useCallback(async () => {
    await invalidateTech(queryClient, 'contact');
  }, [queryClient]);

  const onRefresh = useCallback(async () => {
    // Silent: no loading flag flips, so pull-to-refresh never unmounts the page
    // mid-gesture (page-lifecycle.md §1).
    try { await active.refetch(); }
    catch { toast(t('states.refreshFailed'), 'error'); }
  }, [active, t]);

  // ── Cold start only ──
  if (active.isPending) return <SkeletonList rows={6} />;

  const hub = jobId ? hubQuery.data : null;
  const job = hub?.job || null;
  const claim = hub?.claim || null;
  const jobContacts = Array.isArray(hub?.contacts) ? hub.contacts : [];
  const { current: linkedContact, others } = splitJobContacts(jobContacts, contactId);
  const contact = jobId ? linkedContact : contactQuery.data;

  // ── Failed load — NEVER the empty state (loading-error-states.md §1) ──
  if (active.isError) {
    return (
      <div className="tv2-cust-page">
        <ErrorState
          message={t('states.loadError')}
          onRetry={() => active.refetch()}
          secondary={(
            <button type="button" className="btn btn-secondary" onClick={() => goBackOr(navigate, '/tech')}>
              {t('common.back')}
            </button>
          )}
        />
      </div>
    );
  }

  // ── Loaded, but this contact is not here. A DIFFERENT state from the above:
  //    "we could not ask" and "there is nobody by that id" are not the same
  //    thing, and telling a tech to retry a lookup that succeeded is a dead end.
  if (!contact) {
    return (
      <div className="tv2-cust-page">
        <EmptyState
          icon="👤"
          title={t('states.notFoundTitle')}
          sub={jobId ? t('states.notFoundOnJobSub') : t('states.notFoundSub')}
          action={(
            <button type="button" className="btn btn-secondary" onClick={() => goBackOr(navigate, '/tech')}>
              {t('common.back')}
            </button>
          )}
        />
      </div>
    );
  }

  // Both savers RETHROW after toasting. The caller closes its edit form on a
  // resolved promise, so swallowing the error here discarded whatever the tech
  // had typed — a phone number corrected on site, gone, with only a toast to
  // say so. This is the same rule tech-mobile-ux.md states for TechAppointment's
  // reading handlers: an entry surface treats "resolved" as "saved", so a failed
  // save must never resolve. AdditionalContactsSection already got this right.
  const saveContact = async (patch) => {
    if (Object.keys(patch).length === 0) return;
    try {
      await db.update('contacts', `id=eq.${contact.id}`, { ...patch, updated_at: new Date().toISOString() });
      await onMutation();
      toast(t('states.saved'));
    } catch (error) {
      toast(t('states.saveFailed'), 'error');
      throw error;
    }
  };

  const saveJobInsurance = async (patch) => {
    if (Object.keys(patch).length === 0 || !job?.id) return;
    try {
      await db.update('jobs', `id=eq.${job.id}`, patch);
      await onMutation();
      toast(t('states.saved'));
    } catch (error) {
      toast(t('states.saveFailed'), 'error');
      throw error;
    }
  };

  const role = linkRoleOf(contact) || contact.role;

  return (
    <div className="tv2-cust-page">
      {/* Fixed header — it does NOT move on pull-to-refresh. */}
      <header className="tv2-cust-header">
        <button
          type="button"
          className="tv2-cust-header__back"
          onClick={() => goBackOr(navigate, '/tech')}
          aria-label={t('common.back')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="tv2-cust-header__title">{t('title')}</span>
      </header>

      <PullToRefresh onRefresh={onRefresh} className="tv2-cust-scroll">
        <div className="tv2-cust-identity">
          <div className="tv2-cust-identity__avatar" aria-hidden="true">{initialsOf(contact.name)}</div>
          <div className="tv2-cust-identity__body">
            <div className="tv2-cust-identity__name">{contact.name || t('contacts.unnamed')}</div>
            <div className="tv2-cust-identity__meta">
              {role && <span className="tv2-cust-role">{titleCase(role)}</span>}
              {job?.job_number && <span className="tv2-cust-role">{job.job_number}</span>}
            </div>
          </div>
        </div>

        <CustomerInfoSection contact={contact} onSave={saveContact} />

        <InsuranceSection
          job={job}
          claim={claim}
          contact={contact}
          onSaveJob={saveJobInsurance}
          onSaveContact={saveContact}
        />

        {/* Job mode only: without a job there is nothing to attach anyone TO. */}
        {jobId && job?.id && (
          <AdditionalContactsSection jobId={job.id} contacts={others} onChanged={onMutation} />
        )}
      </PullToRefresh>
    </div>
  );
}
