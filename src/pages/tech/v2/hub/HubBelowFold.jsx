/**
 * ════════════════════════════════════════════════
 * FILE: HubBelowFold.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Everything on the Job Hub below the stage, in a deliberate order: first the
 *   visit switcher (which appointment am I looking at, and a button to schedule
 *   a new one), then the collapsible "Job & Claim" reference card (kept ABOVE
 *   the photos so the adjuster-call flow never scrolls past a gallery), then the
 *   photos-and-notes zone, and finally the "Generate report" button. Each zone
 *   is its own component; this file just lays them out in the right sequence.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z4 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/components/tech/v2 (StatusChip), @/components/tech/GenerateReportButton,
 *              ./JobClaimSection, ./PhotosNotes
 *   Data:      none directly (PhotosNotes fetches its own job_documents;
 *              appointments/contacts/claim/job arrive as props)
 *
 * NOTES / GOTCHAS:
 *   - The switcher writes the selection up via onSelect (the page owns ?appt=).
 *   - Order is binding (reference before gallery) per the Job Hub v2 spec.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/tech/v2';
import GenerateReportButton from '@/components/tech/GenerateReportButton';
import JobClaimSection from './JobClaimSection.jsx';
import PhotosNotes from './PhotosNotes.jsx';

const DONE = ['completed', 'cancelled'];

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
 * @param {{ jobId: string, jobNumber?: string, job: object, appointments?: Array,
 *           selectedId?: string|null, contacts?: Array, claim?: object|null,
 *           isAdmin?: boolean, rooms?: Array|null, onCreateRoom?: Function,
 *           onMutation?: (kind:string)=>void, onSelect: (id:string)=>void }} props
 */
export default function HubBelowFold({
  jobId, jobNumber, job, appointments = [], selectedId, contacts = [], claim,
  isAdmin, rooms, onCreateRoom, onMutation, onSelect,
}) {
  const { t } = useTranslation('hub');
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];

  const upcoming = appointments
    .filter((a) => a.date >= today && !DONE.includes(a.status))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time_start || '').localeCompare(b.time_start || ''));
  const past = appointments
    .filter((a) => a.date < today || DONE.includes(a.status))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time_start || '').localeCompare(a.time_start || ''));

  return (
    <>
      {/* 1 — Visits switcher (drives ?appt=). */}
      <section className="tv2-hub-section">
        <div className="tv2-hub-section__title">
          {t('below.visits')}{appointments.length > 0 && <span className="tv2-hub-section__count">{appointments.length}</span>}
        </div>

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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          {t('below.scheduleAppt')}
        </button>
      </section>

      {/* 2 — Job & Claim (collapsible, ABOVE photos — order is binding). */}
      <JobClaimSection job={job} contacts={contacts} claim={claim} isAdmin={isAdmin} />

      {/* 3 — Photos & Notes. */}
      <PhotosNotes
        jobId={jobId}
        appointmentId={selectedId}
        rooms={rooms}
        onCreateRoom={onCreateRoom}
        onMutation={onMutation}
      />

      {/* 4 — Generate report (self-gated). */}
      <GenerateReportButton jobId={jobId} jobNumber={jobNumber} />
    </>
  );
}
