/**
 * ════════════════════════════════════════════════
 * FILE: TechJobHub.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Job Hub v2 — "the visit is the screen." One field-tech surface for a job that
 *   already knows where the tech is in their visit. A compact fixed header up top
 *   (Z1), the Stage in the middle that reshapes around the tech's own clock (Z2),
 *   a docked bar of thumb-zone capture buttons at the bottom (Z3), and below the
 *   fold the visit switcher plus Job & Claim / photo stubs (Z4). It replaces M1's
 *   "every drawer open" stack behind the same route and the same feature flag.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/job/:jobId?appt=<id>  (behind page:tech_job_hub)
 *   Rendered by:  src/App.jsx (inside the TechLayout shell)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, @tanstack/react-query, react-i18next
 *   Internal:  @/contexts/AuthContext, @/components/PullToRefresh, @/lib/techQuery,
 *              @/lib/toast, @/lib/clockPrecheck (runOmwPrecheck),
 *              ./hub/* (HubHeader, HubStage, HubDock, HubBelowFold, AdminJobMenu,
 *              hubHelpers)
 *   Data:      reads → get_job_hub (frame incl. contacts[]), get_appointment_detail
 *                       (selected visit), get_job_rooms, clock_omw_precheck (via
 *                       runOmwPrecheck — the "clocked elsewhere" banner)
 *              writes → children own their writes; onMutation invalidates the
 *                       shared tech caches (dash/schedule + the hub kind).
 *
 * NOTES / GOTCHAS:
 *   - Reads through React Query (cache-first paint via the idb persister), NOT
 *     M1's local useState. Every hub sub-query caches under the ['tech','hub',
 *     jobId] prefix so any mutation's hub-invalidation repaints the whole surface.
 *   - The visit picker keeps the URL's ?appt= in sync; a stale/absent id falls
 *     back to today's / next via selectVisitId (reused as-is).
 *   - TimeTracker (inside HubStage) gets the get_appointment_detail object, never
 *     the get_job_hub appointment row (crew shapes differ; .jobs is absent).
 * ════════════════════════════════════════════════
 */
import { useCallback, useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { SkeletonList } from '@/components/tech/v2';
import { techKeys, invalidateTech } from '@/lib/techQuery';
import { runOmwPrecheck } from '@/lib/clockPrecheck';
import { toast } from '@/lib/toast';
import HubHeader from './hub/HubHeader.jsx';
import HubStage from './hub/HubStage.jsx';
import HubDock from './hub/HubDock.jsx';
import HubBelowFold from './hub/HubBelowFold.jsx';
import AdminJobMenu from './hub/AdminJobMenu.jsx';
import { selectVisitId } from './hub/hubHelpers.js';

const todayISO = () => new Date().toISOString().split('T')[0];

export default function TechJobHub() {
  const { t } = useTranslation('hub');
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { employee, db, isFeatureEnabled } = useAuth();
  const queryClient = useQueryClient();
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');
  const [menuOpen, setMenuOpen] = useState(false);

  // ── Frame (cache-first) ──
  const hubQuery = useQuery({
    queryKey: techKeys.hub(jobId),
    queryFn: () => db.rpc('get_job_hub', { p_job_id: jobId }),
    enabled: !!jobId,
  });
  const hub = hubQuery.data || null;
  const appointments = hub?.appointments || [];
  const apptParam = searchParams.get('appt');
  const selectedId = selectVisitId(appointments, apptParam, employee?.id, todayISO());

  // Keep ?appt= in sync with the resolved selection (replace — no history spam).
  useEffect(() => {
    if (selectedId && apptParam !== selectedId) {
      const next = new URLSearchParams(searchParams);
      next.set('appt', selectedId);
      setSearchParams(next, { replace: true });
    }
  }, [selectedId, apptParam, searchParams, setSearchParams]);

  // ── Selected visit detail (cache-first, under the hub prefix) ──
  const visitQuery = useQuery({
    queryKey: [...techKeys.hub(jobId), 'visit', selectedId],
    queryFn: () => db.rpc('get_appointment_detail', { p_appointment_id: selectedId }),
    enabled: !!selectedId,
  });

  // ── "Clocked into another job" (the OMW precheck returns the other open entry) ──
  const elsewhereQuery = useQuery({
    queryKey: [...techKeys.hub(jobId), 'elsewhere', selectedId, employee?.id],
    queryFn: async () => (await runOmwPrecheck(db, selectedId, employee?.id))?.open_entry || null,
    enabled: !!(selectedId && employee?.id),
  });

  // ── Rooms (job-scoped; own kind so a room mutation refreshes it) ──
  const roomsQuery = useQuery({
    queryKey: techKeys.rooms(jobId),
    queryFn: () => db.rpc('get_job_rooms', { p_job_id: jobId }),
    enabled: !!(roomsEnabled && jobId),
  });

  const onMutation = useCallback((kind) => invalidateTech(queryClient, kind), [queryClient]);

  const onRefresh = useCallback(async () => {
    try { await queryClient.invalidateQueries({ queryKey: ['tech', 'hub'] }); }
    catch { toast(t('states.refreshFailed'), 'error'); }
  }, [queryClient, t]);

  const handleCreateRoom = useCallback(async (name) => {
    if (!jobId) throw new Error('Job not loaded');
    const created = await db.rpc('create_room', {
      p_job_id: jobId, p_name: name, p_created_by: employee?.id, p_client_id: crypto?.randomUUID?.() || null,
    });
    onMutation('room');
    return created;
  }, [db, jobId, employee?.id, onMutation]);

  const selectVisit = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('appt', id);
    setSearchParams(next, { replace: true });
  };

  // ── Cold start only (no cached data): skeleton, never a spinner over content ──
  if (hubQuery.isPending) return <SkeletonList rows={6} />;

  // ── Not-found / load-error: Back + Retry (TJD parity, not a dead end) ──
  if (hubQuery.isError || !hub || !hub.job) {
    return (
      <div className="tv2-hub-page">
        <div className="tv2-hub-errorscreen">
          <div className="tv2-hub-errorscreen__title">{t('states.loadErrorTitle')}</div>
          <div className="tv2-hub-errorscreen__sub">{t('states.loadErrorSub')}</div>
          <div className="tv2-hub-errorscreen__actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>{t('states.back')}</button>
            <button type="button" className="btn btn-primary" onClick={() => hubQuery.refetch()}>{t('states.retry')}</button>
          </div>
        </div>
      </div>
    );
  }

  const job = hub.job;
  const claim = hub.claim;
  const contacts = Array.isArray(hub.contacts) ? hub.contacts : [];
  const primary = contacts.find((c) => c.is_primary) || contacts[0] || null;
  const visit = visitQuery.data || null;

  const title = primary?.name || job.insured_name || t('states.unknownCustomer');
  const phone = primary?.phone || job.client_phone || null;
  const address = [job.address, job.city, job.state].filter(Boolean).join(', ');
  const selectedAppt = appointments.find((a) => a.id === selectedId) || null;
  const isAdmin = employee?.role === 'admin' || employee?.role === 'manager';

  return (
    <div className="tv2-hub-page">
      <HubHeader
        jobId={jobId}
        jobNumber={job.job_number}
        title={title}
        address={address}
        status={selectedAppt?.status}
        claim={claim}
        isPrivate={visit?.is_private}
        workAuthSigned={hub.work_auth_signed !== false}
        isAdmin={isAdmin}
        onMenu={() => setMenuOpen(true)}
      />

      <PullToRefresh onRefresh={onRefresh} className="tv2-hub-scroll">
        {selectedId && visit ? (
          <HubStage
            visit={visit}
            job={job}
            jobId={jobId}
            address={address}
            appointments={appointments}
            rooms={roomsQuery.data || null}
            onCreateRoom={handleCreateRoom}
            clockedElsewhere={elsewhereQuery.data || null}
            onSelectVisit={selectVisit}
            onMutation={onMutation}
          />
        ) : selectedId ? (
          <div className="tv2-hub-section"><div className="tv2-hub-empty">{t('states.visitUnavailable')}</div></div>
        ) : null}

        <HubBelowFold
          jobId={jobId}
          jobNumber={job.job_number}
          appointments={appointments}
          selectedId={selectedId}
          contacts={contacts}
          claim={claim}
          onSelect={selectVisit}
        />
      </PullToRefresh>

      <HubDock
        jobId={jobId}
        appointmentId={selectedId}
        phone={phone}
        address={address}
        rooms={roomsQuery.data || null}
        onCreateRoom={handleCreateRoom}
        onMutation={onMutation}
      />

      <AdminJobMenu open={menuOpen} onClose={() => setMenuOpen(false)} job={job} claim={claim} onMerged={() => onMutation('appointment')} />
    </div>
  );
}
