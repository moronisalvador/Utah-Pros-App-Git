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
import { useCallback, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';
import { SkeletonList } from '@/components/tech/v2';
import { techKeys, invalidateTech } from '@/lib/techQuery';
import { runOmwPrecheck } from '@/lib/clockPrecheck';
import { toast } from '@/lib/toast';
import { goBackOr } from '@/lib/backNav';
import HubHeader from './hub/HubHeader.jsx';
import HubActionBar from './hub/HubActionBar.jsx';
import HubMoreSheet from './hub/HubMoreSheet.jsx';
import HubStage from './hub/HubStage.jsx';
import JobStage from './hub/JobStage.jsx';
import HubDock from './hub/HubDock.jsx';
import HubBelowFold from './hub/HubBelowFold.jsx';
import AdminJobMenu from './hub/AdminJobMenu.jsx';
import { resolveHero, showWorkAuthBanner } from './hub/hubHelpers.js';
import { todayInCompanyTimeZone } from '@/lib/companyDate';
import { DIV_LABEL } from '@/lib/claimUtils';
import { formatLossDate } from '@/lib/techDateUtils';
// Hub styles are route-lazy: they ship in this chunk, not the app's boot CSS.
import './job-hub.css';

const todayISO = () => todayInCompanyTimeZone();

/** Fallback for a division DIV_LABEL does not know yet. */
function titleCaseWord(v) {
  if (!v) return '';
  const w = String(v).replace(/_/g, ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export default function TechJobHub() {
  const { t } = useTranslation('hub');
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { employee, db, isFeatureEnabled } = useAuth();
  const queryClient = useQueryClient();
  const roomsEnabled = isFeatureEnabled('page:tech_rooms');
  const [menuOpen, setMenuOpen] = useState(false);

  // The action bar's Notes button scrolls to the notes that already exist below
  // the fold. It becomes a route once the dedicated Notes page ships (§12.5.3).
  const notesRef = useRef(null);
  const scrollToNotes = useCallback(() => {
    notesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // "More" → the on-site verbs. Its "Take a reading" row scrolls to the tools
  // block rather than opening the entry sheet, because that sheet's state lives
  // inside HubTools; same idiom as Notes above. See HubMoreSheet's header.
  const [moreOpen, setMoreOpen] = useState(false);
  const toolsRef = useRef(null);

  // "Customer" in the hero. The spec points it at a customer PAGE, which does not
  // exist in the tech shell yet — so until it does this opens and scrolls to the
  // Job & Claim card, which already carries the customer's name, one-tap call and
  // email. A real destination beats a pill that goes nowhere; it re-points at the
  // page when that ships. The signal is a counter so a second tap re-opens the
  // card after the tech collapsed it by hand.
  const contactsRef = useRef(null);
  const [customerSignal, setCustomerSignal] = useState(0);
  const showCustomer = useCallback(() => {
    setCustomerSignal((n) => n + 1);
    // after the open commits, so the scroll targets the expanded height
    requestAnimationFrame(() => {
      contactsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);
  const scrollToTools = useCallback(() => {
    toolsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── Frame (cache-first) ──
  const hubQuery = useQuery({
    queryKey: techKeys.hub(jobId),
    queryFn: () => db.rpc('get_job_hub', { p_job_id: jobId }),
    enabled: !!jobId,
  });
  const hub = hubQuery.data || null;
  const appointments = hub?.appointments || [];
  const apptParam = searchParams.get('appt');

  // Which hero leads: a running clock, the appointment that sent us here, or
  // the job itself. `selectedId` is null in job mode BY DESIGN — that is what
  // keeps the clock, the crew and the "Viewing" badge off the job screen.
  const hero = resolveHero({ appointments, apptParam, employeeId: employee?.id, todayStr: todayISO() });
  const selectedId = hero.visitId;
  const nextVisit = appointments.find((a) => a.id === hero.nextVisitId) || null;

  // Keep ?appt= in sync with the resolved selection (replace — no history spam).
  // ONLY in visit mode: writing the param in job mode would immediately satisfy
  // resolveHero's rule 2 on the next render and flip the screen back into an
  // appointment, which is exactly the bug this mode exists to fix.
  useEffect(() => {
    if (hero.mode === 'appointment' && selectedId && apptParam !== selectedId) {
      const next = new URLSearchParams(searchParams);
      next.set('appt', selectedId);
      setSearchParams(next, { replace: true });
    }
  }, [hero.mode, selectedId, apptParam, searchParams, setSearchParams]);

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
            <button type="button" className="btn btn-secondary" onClick={() => goBackOr(navigate, '/tech')}>{t('states.back')}</button>
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
  const isJobMode = hero.mode === 'job';

  // Owner-directed 2026-08-08: the big white line is ALWAYS the client's name, and
  // the line under it is the job's type and date of loss. The visit title used to
  // take the headline in appointment mode, which made the two modes read as two
  // different screens and pushed the customer — the thing a tech actually needs to
  // recognise — into small grey text. The visit title is not lost: it is on the
  // clock card's status line and on every row in the visits list.
  //
  // DIV_LABEL is the app's existing division vocabulary ("Water", "Mold",
  // "Reconstruction"); using it rather than a second hand-written map is what
  // keeps this line agreeing with the rest of the app.
  const heroType = DIV_LABEL[job.division] || titleCaseWord(job.division);
  const heroLoss = job.date_of_loss ? formatLossDate(job.date_of_loss) : null;
  const subtitle = [heroType, heroLoss].filter(Boolean).join(' \u00b7 ');
  const heroStatus = isJobMode ? job.phase : selectedAppt?.status;

  return (
    <div className="tv2-hub-page">
      <HubHeader
        jobNumber={job.job_number}
        title={title}
        address={address}
        division={job.division}
        status={heroStatus}
        subtitle={subtitle}
        claim={claim}
        isPrivate={visit?.is_private}
        isAdmin={isAdmin}
        onMenu={() => setMenuOpen(true)}
        onCustomer={showCustomer}
      />


      <PullToRefresh onRefresh={onRefresh} className="tv2-hub-scroll">
        {/* ORDER IS THE APPROVED ARTIFACT'S: hero → work-auth alert → action bar.
            The alert is the loudest thing on the screen and it must not sit below
            a row of buttons; the action bar scrolls with the content rather than
            being pinned, which is what the artifact shows. */}
        {/* Work-auth alert — §12.5 data rule: every hub screen, either mode,
            until the job is signed. */}
        {showWorkAuthBanner(hub) && (
          <div className="tv2-hub-section" style={{ paddingBottom: 0 }}>
            <button
              type="button"
              className="tv2-hub-wa-alert"
              onClick={() => navigate(`/tech/jobs/${jobId}/documents`, { state: { startEsign: 'work_auth' } })}
            >
              <span className="tv2-hub-wa-alert__ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <span className="tv2-hub-wa-alert__body">
                <span className="tv2-hub-wa-alert__title">{t('states.workAuthTitle')}</span>
                <span className="tv2-hub-wa-alert__sub">{t('states.workAuthSub')}</span>
              </span>
              <svg className="tv2-hub-wa-alert__chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

        <HubActionBar jobId={jobId} phone={phone} onNotes={scrollToNotes} onMore={() => setMoreOpen(true)} />

        {isJobMode ? (
          <JobStage
            jobId={jobId}
            appointments={appointments}
            nextVisit={nextVisit}
            rooms={roomsQuery.data || null}
            roomsEnabled={roomsEnabled}
            onCreateRoom={handleCreateRoom}
            onSelectVisit={selectVisit}
            onMutation={onMutation}
            toolsRef={toolsRef}
          />
        ) : visit ? (
          <HubStage
            visit={visit}
            jobId={jobId}
            appointments={appointments}
            rooms={roomsQuery.data || null}
            onCreateRoom={handleCreateRoom}
            clockedElsewhere={elsewhereQuery.data || null}
            onSelectVisit={selectVisit}
            onMutation={onMutation}
            toolsRef={toolsRef}
          />
        ) : (
          <div className="tv2-hub-section"><div className="tv2-hub-empty">{t('states.visitUnavailable')}</div></div>
        )}

        <HubBelowFold
          notesRef={notesRef}
          contactsRef={contactsRef}
          customerSignal={customerSignal}
          jobId={jobId}
          jobNumber={job.job_number}
          job={job}
          appointments={appointments}
          selectedId={selectedId}
          contacts={contacts}
          claim={claim}
          isAdmin={isAdmin}
          rooms={roomsQuery.data || null}
          onCreateRoom={handleCreateRoom}
          onMutation={onMutation}
          onSelect={selectVisit}
        />
      </PullToRefresh>

      {/* Capture only. The dock's Call/Navigate/Message/More moved above the fold
          (action bar + hero address row); this bar survives solely because it is
          still the only camera on the Job Hub. */}
      <HubDock
        jobId={jobId}
        appointmentId={selectedId}
        rooms={roomsQuery.data || null}
        onCreateRoom={handleCreateRoom}
        onMutation={onMutation}
      />

      <HubMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        job={job}
        jobId={jobId}
        address={address}
        onTakeReading={scrollToTools}
      />

      <AdminJobMenu open={menuOpen} onClose={() => setMenuOpen(false)} job={job} claim={claim} onMerged={() => onMutation('appointment')} />
    </div>
  );
}
