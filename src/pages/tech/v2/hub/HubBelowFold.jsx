/**
 * ════════════════════════════════════════════════
 * FILE: HubBelowFold.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The part of the Job Hub below the stage. In H1 this is deliberately minimal:
 *   a working "which visit am I looking at" switcher (needed to move between
 *   visits and exercise every stage state), plus small placeholder cards for
 *   Job & Claim details and the photo gallery that H2 will build out in full.
 *   Keeping these as stubs protects the stage's design budget (the whole reason
 *   H1 and H2 are split).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z4 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/components/tech/v2 (StatusChip), @/components/tech/GenerateReportButton
 *   Data:      none (appointments/contacts/claim arrive as props)
 *
 * NOTES / GOTCHAS:
 *   - The switcher writes the selection up via onSelect (the page owns ?appt=).
 *   - Job & Claim + Photos are intentionally compact stubs marked "H2"; do not
 *     flesh them out here.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/tech/v2';
import GenerateReportButton from '@/components/tech/GenerateReportButton';

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
 * @param {{ jobId: string, jobNumber?: string, appointments?: Array, selectedId?: string|null,
 *           contacts?: Array, claim?: object|null, onSelect: (id:string)=>void }} props
 */
export default function HubBelowFold({ jobId, jobNumber, appointments = [], selectedId, contacts = [], claim, onSelect }) {
  const { t } = useTranslation('hub');
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];

  const upcoming = appointments
    .filter((a) => a.date >= today && !DONE.includes(a.status))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time_start || '').localeCompare(b.time_start || ''));
  const past = appointments
    .filter((a) => a.date < today || DONE.includes(a.status))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time_start || '').localeCompare(a.time_start || ''));

  const primary = contacts.find((c) => c.is_primary) || contacts[0] || null;

  return (
    <>
      {/* Visits switcher (functional — drives ?appt=) */}
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

      {/* Job & Claim — compact stub (H2 completes) */}
      <section className="tv2-hub-section">
        <div className="tv2-hub-section__head">
          <span className="tv2-hub-section__title">{t('below.jobClaim')}</span>
          <span className="tv2-hub-h2tag">{t('below.h2tag')}</span>
        </div>
        {primary && (
          <div className="tv2-hub-stubcontact">
            <span className="tv2-hub-stubcontact__name">{primary.name}{primary.role ? ` · ${primary.role}` : ''}</span>
            {primary.phone && <a className="tv2-hub-stubcontact__phone" href={`tel:${primary.phone}`}>{primary.phone}</a>}
          </div>
        )}
        {claim && (
          <button type="button" className="tv2-hub-claimlink" onClick={() => navigate(`/tech/claims/${claim.id}`)}>
            <span>{t('below.viewClaim', { number: claim.claim_number || '' })}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}
      </section>

      {/* Photos & Notes — compact stub (H2 completes) */}
      <section className="tv2-hub-section">
        <div className="tv2-hub-section__head">
          <span className="tv2-hub-section__title">{t('below.photos')}</span>
          <span className="tv2-hub-h2tag">{t('below.h2tag')}</span>
        </div>
        <button type="button" className="tv2-hub-seeall" onClick={() => navigate(`/tech/jobs/${jobId}/photos`)}>
          {t('below.seeAllPhotos')}
        </button>
      </section>

      <GenerateReportButton jobId={jobId} jobNumber={jobNumber} />
    </>
  );
}
