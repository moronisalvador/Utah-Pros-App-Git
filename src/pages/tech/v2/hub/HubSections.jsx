/**
 * ════════════════════════════════════════════════
 * FILE: HubSections.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Everything on the Job Hub below the clock, as a short list of rows a
 *   technician opens one at a time: Dry Logs, Tasks, Rooms and Visits — then the
 *   Job & Claim reference card, the photos and notes, and the report button.
 *
 *   It replaces the old arrangement, where all of that was stacked open on one
 *   very long page. Nothing was removed; it was re-housed.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (the section list of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next, @tanstack/react-query
 *   Internal:  @/contexts/AuthContext, @/components/tech/v2 (StatusChip),
 *              @/components/tech/GenerateReportButton, @/components/tech/RoomCard,
 *              @/lib/techQuery, ./HubSection, ./HubTools, ./HubChecklist,
 *              ./JobClaimSection, ./PhotosNotes, ./hubHelpers
 *   Data:      reads → job_documents, but ONLY through the byte-identical
 *              queryKey + queryFn PhotosNotes already uses, so react-query
 *              dedupes to one request and one cache entry (room cover photos).
 *              Everything else arrives as props.
 *
 * NOTES / GOTCHAS:
 *   - THIS FILE REPLACED HubBelowFold.jsx. Its VisitRow and its upcoming/past
 *     split moved here verbatim. Keeping a file whose only job was ordering
 *     would have left two owners for one layout.
 *   - FOUR rows, not the artifact's five. "Activity" means a real event feed
 *     (owner ruling, 2026-08-15), so it is a follow-up slice with its own data
 *     work — not the photos-and-notes zone wearing a different label.
 *   - Dry Logs is HIDDEN on a reconstruction job (showsDryingTools). The More
 *     sheet's take-a-reading row reads the same helper: a row that appears in
 *     one place and not the other is the bug that gate exists to prevent.
 *   - EVERY COLLAPSIBLE ROW DEFAULTS CLOSED, in both modes, matching the
 *     approved artifact. This was briefly built the other way (Dry Logs and
 *     Tasks open in appointment mode, on the argument that a collapsed moisture
 *     log hides live stalled badges). The owner ruled on 2026-08-15 against the
 *     RENDERED screen: with no readings, no equipment and no tasks — the common
 *     case today, and until H2-e ships — those two open rows are ~500px of
 *     empty state before Rooms and Visits. Do not re-open them by default
 *     without new data to put in them.
 *   - Visits is the ONE exception: it defaults open in JOB mode, because job
 *     mode has no clock card and the visit list is then the primary content.
 *   - Photos & Notes is deliberately NOT collapsible: it owns the docs query the
 *     room covers dedupe against, and the action bar's Notes button scrolls to
 *     it. A collapsed landing is a dead one.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { StatusChip } from '@/components/tech/v2';
import GenerateReportButton from '@/components/tech/GenerateReportButton';
import RoomCard from '@/components/tech/RoomCard';
import { techKeys } from '@/lib/techQuery';
import { DIV_GRADIENTS } from '@/pages/tech/techConstants';
import HubSection from './HubSection.jsx';
import HubTools from './HubTools.jsx';
import HubChecklist from './HubChecklist.jsx';
import JobClaimSection from './JobClaimSection.jsx';
import PhotosNotes from './PhotosNotes.jsx';
import { buildDocsQuery, showsDryingTools, dryingSummary } from './hubHelpers.js';
import { todayInCompanyTimeZone, companyDateOf } from '@/lib/companyDate';

const DONE = ['completed', 'cancelled'];

// ─── SECTION: Helpers ──────────────

/** One visit in the switcher. Moved verbatim from HubBelowFold. */
function VisitRow({ appt, selected, onSelect, t }) {
  const crewNames = (appt.crew || []).map((c) => (c.full_name || '').split(' ')[0]).filter(Boolean).join(', ');
  const title = appt.title || (appt.type || '').replace(/_/g, ' ') || t('below.aVisit');
  return (
    <button type="button" className={`tv2-hub-visit${selected ? ' is-selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <div className="tv2-hub-visit__top">
        <span className="tv2-hub-visit__title">{title}</span>
        <StatusChip status={appt.status} />
      </div>
      <div className="tv2-hub-visit__meta">
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {appt.date}{appt.time_start ? ` · ${appt.time_start.slice(0, 5)}` : ''}
        </span>
        {crewNames && <><span>·</span><span>{t('below.crewLabel', { names: crewNames })}</span></>}
        {appt.task_total > 0 && <><span>·</span><span>{t('below.tasksLabel', { done: appt.task_completed, total: appt.task_total })}</span></>}
      </div>
      {selected && <span className="tv2-hub-visit__badge">{t('below.viewing')}</span>}
    </button>
  );
}

/**
 * The rooms grid. Mounted only while its section is open, so a closed row costs
 * nothing — and its docs query uses the SAME key and fn PhotosNotes uses, so
 * react-query serves both from one request rather than fetching twice.
 */
function RoomsGrid({ jobId, rooms, division, claimId, onAddRoom, t }) {
  const navigate = useNavigate();
  const { db } = useAuth();

  const docsQuery = useQuery({
    queryKey: [...techKeys.hub(jobId), 'docs', jobId],
    queryFn: () => db.select('job_documents', buildDocsQuery({ jobId })),
    enabled: !!jobId,
  });

  // Docs come back newest-first, so the first photo seen for a room is its cover.
  const coverByRoom = {};
  for (const d of (Array.isArray(docsQuery.data) ? docsQuery.data : [])) {
    if (d.category === 'photo' && d.room_id && !coverByRoom[d.room_id]) {
      coverByRoom[d.room_id] = d.file_path;
    }
  }

  const list = Array.isArray(rooms) ? rooms : [];
  const gradient = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;

  return (
    <>
      <div className="tv2-hub-roomgrid">
        <button type="button" className="tv2-hub-roomadd" onClick={onAddRoom}>
          <span className="tv2-hub-roomadd__ic">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
          <span className="tv2-hub-roomadd__t">{t('rooms.add')}</span>
        </button>
        {list.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            coverFilePath={coverByRoom[room.id]}
            divisionGradient={gradient}
            // TechRoomDetail is claim-scoped. A claim-less OOP job gets
            // display-only tiles rather than a tap into a route that cannot
            // resolve. Not a regression: the Hub shows no rooms grid today.
            onClick={claimId ? () => navigate(`/tech/claims/${claimId}/rooms/${room.id}`) : undefined}
          />
        ))}
      </div>
      {list.length === 0 && <div className="tv2-hub-empty">{t('rooms.none')}</div>}
      {list.length > 0 && !claimId && <div className="tv2-hub-more">{t('rooms.noClaimHint')}</div>}
    </>
  );
}

// ─── SECTION: Render ──────────────

/**
 * @param {{ jobId: string, jobNumber?: string, job: object, appointments?: Array,
 *           selectedId?: string|null, contacts?: Array, claim?: object|null,
 *           isAdmin?: boolean, isJobMode?: boolean, roomsEnabled?: boolean,
 *           rooms?: Array|null, onCreateRoom?: Function, onAddRoom?: Function,
 *           onMutation?: (kind:string)=>void, onSelect: (id:string)=>void,
 *           notesRef?: object, contactsRef?: object, toolsRef?: object,
 *           toolsSignal?: number,
 *           canToggleTasks?: boolean }} props
 */
export default function HubSections({
  jobId, jobNumber, job, appointments = [], selectedId, contacts = [], claim,
  isAdmin, isJobMode, roomsEnabled, rooms, onCreateRoom, onAddRoom, onMutation, onSelect,
  notesRef, contactsRef, toolsRef, toolsSignal = 0,
  canToggleTasks = true,
}) {
  const { t } = useTranslation('hub');
  const navigate = useNavigate();
  const today = todayInCompanyTimeZone();

  const upcoming = appointments
    .filter((a) => a.date >= today && !DONE.includes(a.status))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time_start || '').localeCompare(b.time_start || ''));
  const past = appointments
    .filter((a) => a.date < today || DONE.includes(a.status))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time_start || '').localeCompare(a.time_start || ''));

  // Free from the hub frame row — no extra fetch for the Tasks count.
  const selectedAppt = appointments.find((a) => a.id === selectedId) || null;
  const taskDone = selectedAppt?.task_completed || 0;
  const taskTotal = selectedAppt?.task_total || 0;

  const roomCount = Array.isArray(rooms) ? rooms.length : 0;
  const showDrying = showsDryingTools(job?.division);

  // ── Drying summary for the COLLAPSED Dry Logs row (H2-e1) ──
  // The query lives HERE and not in HubTools because a collapsed row mounts
  // none of its children — that is deliberate and tested — so a summary the
  // tech reads without opening the row cannot be fetched by the thing inside
  // it. Accepted cost, stated rather than hidden: on a drying job the readings
  // now load with the Hub instead of on first open. `showDrying` still means a
  // reconstruction job fetches nothing, and the moisture flag still gates it.
  //
  // Reviewed and kept 2026-08-16, so it is a decision and not an oversight.
  // Two alternatives were on the table and both are worse HERE:
  //   - read only what is already cached (no forced fetch). That guts the
  //     feature — a tech who has never opened Dry Logs is exactly who the
  //     summary is for, and they would be the one who never sees it.
  //   - a narrow get_job_drying_summary RPC returning {day,dry,total}. Better
  //     shape, and the right answer eventually — but it is a MIGRATION, and
  //     this release was deliberately scoped to no schema change.
  // The precedent is direct: photos-today in TechJobHub already fetches the
  // whole job_documents list eagerly to derive one integer, and readings are
  // the smaller of the two. For a tech who does open the row this is the same
  // request moved earlier, and warm by the time they get there.
  // If this ever needs to shrink, the aggregate RPC is the move.
  //
  // The key and fn are BYTE-IDENTICAL to HubTools.jsx's readings query, so
  // react-query serves both from one request and one cache entry. Re-diff
  // HubTools before changing either half: a drifted key silently becomes a
  // second fetch of the whole readings list, with nothing failing to say so.
  // (Same technique and same warning as the photos-today count in TechJobHub.)
  const { db, isFeatureEnabled } = useAuth();
  const moistureEnabled = isFeatureEnabled('page:tech_moisture');
  const readingsQuery = useQuery({
    queryKey: [...techKeys.hub(jobId), 'readings'],
    queryFn: () => db.rpc('get_job_readings', { p_job_id: jobId }),
    enabled: !!(showDrying && moistureEnabled && jobId),
  });
  const drying = dryingSummary(readingsQuery.data, { today }, companyDateOf);
  const dryingLabel = drying
    ? [t('sections.dryingDay', { n: drying.day }), t('sections.dryingDry', { dry: drying.dry, total: drying.total })].join(' · ')
    : null;

  return (
    <>
      {/* 1 — Dry Logs. Collapsed by default in BOTH modes, matching the approved
          artifact (owner ruling, 2026-08-15, made against the rendered screen:
          with no readings and no equipment the open row is ~350px of empty
          state, which is the common case today and stays so until H2-e).
          The More sheet's "Take a reading" scrolls here and bumps toolsSignal,
          which forces the row open — so that entry point still lands on an open
          row even though the default is closed. */}
      {showDrying && (
        <div ref={toolsRef}>
          <HubSection
            title={t('sections.dryLogs')}
            summary={dryingLabel}
            defaultOpen={false}
            openSignal={toolsSignal}
          >
            <HubTools jobId={jobId} rooms={rooms} onCreateRoom={onCreateRoom} onMutation={onMutation} />
          </HubSection>
        </div>
      )}

      {/* 2 — Tasks. Appointment mode only: the artifact's job-mode screen has no
          Tasks card, and job mode already shows an open-task count on its stat
          card, so a second one here would be the same number twice. */}
      {!isJobMode && selectedId && (
        <HubSection
          title={t('sections.tasks')}
          count={taskTotal > 0 ? `${taskDone}/${taskTotal}` : null}
          defaultOpen={false}
          headerAction={(
            <button
              type="button"
              className="tv2-hub-linkbtn"
              onClick={() => navigate(`/tech/appointment/${selectedId}/edit?section=tasks`)}
            >
              {t('stage.editTasks')}
            </button>
          )}
        >
          {/* embedded: the checklist drops its own header, because this section
              now owns the title, the count and the Edit-list link. */}
          <HubChecklist apptId={selectedId} jobId={jobId} canToggle={canToggleTasks} onMutation={onMutation} embedded />
        </HubSection>
      )}

      {/* 3 — Rooms. */}
      {roomsEnabled && (
        <HubSection title={t('sections.rooms')} count={roomCount > 0 ? roomCount : null} defaultOpen={false}>
          <RoomsGrid
            jobId={jobId}
            rooms={rooms}
            division={job?.division}
            claimId={claim?.id}
            onAddRoom={onAddRoom}
            t={t}
          />
        </HubSection>
      )}

      {/* 4 — Visits (drives ?appt=). */}
      <HubSection
        title={t('below.visits')}
        count={appointments.length > 0 ? appointments.length : null}
        defaultOpen={isJobMode}
      >
        {appointments.length === 0 ? (
          <div className="tv2-hub-visit-empty">{t('below.noVisits')}</div>
        ) : (
          <>
            {upcoming.length > 0 && <div className="tv2-hub-visit-sublabel">{t('below.upcoming')}</div>}
            {upcoming.map((a) => <VisitRow key={a.id} appt={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} t={t} />)}
            {past.length > 0 && <div className="tv2-hub-visit-sublabel">{t('below.past')}</div>}
            {past.map((a) => <VisitRow key={a.id} appt={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} t={t} />)}
          </>
        )}

        <button type="button" className="tv2-hub-visit-add" onClick={() => navigate(`/tech/new-appointment?jobId=${jobId}`)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {t('below.scheduleAppt')}
        </button>
      </HubSection>

      {/* Job & Claim — kept. It is the Hub's only home for adjuster contact,
          carrier/policy/claim numbers, admin-only deductible and A/R notes. Its
          openSignal plumbing is gone now the hero pill navigates to the
          customer page instead of scrolling here. */}
      <div ref={contactsRef}>
        <JobClaimSection
          job={job}
          contacts={contacts}
          claim={claim}
          isAdmin={isAdmin}
        />
      </div>

      {/* Photos & Notes — the action bar's Notes scroll target. */}
      <div ref={notesRef}>
        <PhotosNotes
          jobId={jobId}
          appointmentId={selectedId}
          rooms={rooms}
          onCreateRoom={onCreateRoom}
          onMutation={onMutation}
        />
      </div>

      {/* Generate report (self-gated). `division` is what hides the water-loss
          report on a reconstruction job. */}
      <GenerateReportButton jobId={jobId} jobNumber={jobNumber} division={job?.division} />
    </>
  );
}
