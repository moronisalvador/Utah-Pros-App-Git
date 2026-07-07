/**
 * ════════════════════════════════════════════════
 * FILE: HubStage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The heart of the Job Hub — "the Stage." It reads the tech's own clock on the
 *   selected visit and reshapes around where they are: a purpose card before they
 *   leave, a big running timer while they work, a travel/on-site/total breakdown
 *   once they're done. The clock's buttons stay in the TimeTracker beneath it,
 *   untouched. Everything else — office notes, crew, the task checklist, and the
 *   field tools — stays reachable in EVERY state; the stage only changes what's
 *   big, never what's available. A tech who isn't on this visit's crew sees it
 *   read-only; a tech clocked into a different job sees a "go there" banner.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z2 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/components/tech/TimeTracker,
 *              @/components/tech/v2 (apptHref), ./useVisitClock, ./StageClock,
 *              ./HubChecklist, ./HubTools
 *   Data:      reads → job_time_entries (via useVisitClock). writes → none here
 *              (children own their writes; TimeTracker owns the clock).
 *
 * NOTES / GOTCHAS:
 *   - TimeTracker MUST receive the get_appointment_detail object (has .jobs and
 *     the full crew shape), NEVER the get_job_hub appointment row (crew differs,
 *     .jobs absent) — silent-data-loss trap, challenge-confirmed.
 *   - "Whose clock" is the VIEWER's own entry (useVisitClock keyed to employee).
 *     Non-crew → no clock actions. Cancelled visit → wrapped-gray, no actions.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import TimeTracker from '@/components/tech/TimeTracker';
import { apptHref } from '@/components/tech/v2';
import { useVisitClock } from './useVisitClock.js';
import { isOnCrew, stageBucket, shouldShowElsewhere } from './hubStageState.js';
import StageClock from './StageClock.jsx';
import HubChecklist from './HubChecklist.jsx';
import HubTools from './HubTools.jsx';

function fmtMinutes(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

/**
 * @param {{
 *   visit: object, job: object, jobId: string, address?: string,
 *   appointments?: Array, rooms: Array|null, onCreateRoom: Function,
 *   clockedElsewhere?: object|null, onSelectVisit?: (id:string)=>void,
 *   onMutation?: (kind:string)=>void,
 * }} props
 */
export default function HubStage({
  visit, job, jobId, address, appointments = [], rooms, onCreateRoom,
  clockedElsewhere, onSelectVisit, onMutation,
}) {
  const { t } = useTranslation('hub');
  const { employee, db } = useAuth();
  const navigate = useNavigate();

  const apptId = visit?.id;
  const clock = useVisitClock(db, apptId, employee?.id, jobId);

  const crew = visit?.appointment_crew || [];
  const isCrew = isOnCrew(crew, employee?.id);
  const isCancelled = visit?.status === 'cancelled';
  const canClock = isCrew && !isCancelled;
  const showElsewhere = shouldShowElsewhere(clockedElsewhere, apptId);

  // Stage bucket: cancelled → wrapped-gray; else from the viewer's own clock.
  const stage = stageBucket(clock.status, isCancelled);

  const timeWindow = [visit?.time_start, visit?.time_end].filter(Boolean).join('–') || null;
  const typeLabel = titleCase(visit?.type);

  // Next visit on this job (WRAPPED "what's next" card).
  const today = new Date().toISOString().split('T')[0];
  const nextVisit = appointments
    .filter((a) => a.id !== apptId && a.date >= today && !['completed', 'cancelled'].includes(a.status))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time_start || '').localeCompare(b.time_start || ''))[0] || null;

  return (
    <div className={`tv2-hub-stage tv2-hub-stage--${stage}`}>
      {/* Clocked-into-another-job banner (captures still tag THIS visit). */}
      {showElsewhere && (
        <div className="tv2-hub-elsewhere">
          <span className="tv2-hub-elsewhere__text">
            {t('banner.clockedElsewhere', {
              job: clockedElsewhere.job_number
                ? `${clockedElsewhere.job_number}${clockedElsewhere.insured_name ? ' — ' + clockedElsewhere.insured_name : ''}`
                : (clockedElsewhere.insured_name || clockedElsewhere.title || t('banner.anotherJob')),
            })}
          </span>
          {clockedElsewhere.appointment_id && (
            <button type="button" className="tv2-hub-elsewhere__go" onClick={() => navigate(apptHref(clockedElsewhere.appointment_id, clockedElsewhere.job_id))}>
              {t('banner.goThere')}
            </button>
          )}
        </div>
      )}

      {/* ── Clock zone (emphasis varies by state) ── */}
      {isCancelled && (
        <div className="tv2-hub-cancelled">{t('stage.cancelledVisit')}</div>
      )}

      {!isCancelled && stage === 'arriving' && (
        <div className="tv2-hub-purpose">
          <div className="tv2-hub-purpose__title">{visit?.title || typeLabel || t('stage.thisVisit')}</div>
          <div className="tv2-hub-purpose__meta">
            {typeLabel && <span className="tv2-hub-chip">{typeLabel}</span>}
            {timeWindow && <span className="tv2-hub-purpose__time">{timeWindow}</span>}
          </div>
        </div>
      )}

      {!isCancelled && stage === 'working' && isCrew && <StageClock clock={clock} />}

      {!isCancelled && stage === 'wrapped' && clock.currentEntry && (
        <div className="tv2-hub-breakdown">
          <div className="tv2-hub-breakdown__label">{t('stage.timeBreakdown')}</div>
          <div className="tv2-hub-breakdown__grid">
            <div><span className="tv2-hub-breakdown__k">{t('stage.travel')}</span><span className="tv2-hub-breakdown__v">{fmtMinutes(clock.totalTravelMinutes)}</span></div>
            <div><span className="tv2-hub-breakdown__k">{t('stage.onSiteLabel')}</span><span className="tv2-hub-breakdown__v">{fmtMinutes(clock.totalOnSiteMinutes)}</span></div>
            <div><span className="tv2-hub-breakdown__k">{t('stage.total')}</span><span className="tv2-hub-breakdown__v is-total">{fmtMinutes(clock.totalMinutes)}</span></div>
          </div>
        </div>
      )}

      {/* TimeTracker — all clock ACTIONS; only for a crew member on a live visit.
          Receives the get_appointment_detail object exactly (never the hub row). */}
      {canClock ? (
        <div className="tv2-hub-tracker">
          <TimeTracker appt={visit} employee={employee} db={db} onUpdate={() => onMutation?.('clock')} />
        </div>
      ) : !isCancelled && (
        <div className="tv2-hub-readonly">{t('stage.readOnly')}</div>
      )}

      {/* Next visit on this job (WRAPPED) — tap switches visit. */}
      {stage === 'wrapped' && nextVisit && (
        <button type="button" className="tv2-hub-nextvisit" onClick={() => onSelectVisit?.(nextVisit.id)}>
          <div>
            <div className="tv2-hub-nextvisit__label">{t('stage.nextVisit')}</div>
            <div className="tv2-hub-nextvisit__title">{nextVisit.title || titleCase(nextVisit.type)} · {nextVisit.date}</div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      )}

      {/* Office notes — visible in ALL states (gate codes live here). */}
      {visit?.notes && (
        <section className="tv2-hub-section">
          <div className="tv2-hub-section__title">{t('stage.officeNotes')}</div>
          <div className="tv2-hub-notes">{visit.notes}</div>
        </section>
      )}

      {/* Crew — visible in ALL states. */}
      {crew.length > 0 && (
        <section className="tv2-hub-section">
          <div className="tv2-hub-section__title">{t('stage.crew')}</div>
          <div className="tv2-hub-crew">
            {crew.map((c) => {
              const emp = c.employees || {};
              const name = emp.display_name || emp.full_name || '?';
              const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
              const isLead = c.role === 'lead' || c.role === 'crew_lead';
              return (
                <div key={c.id || c.employee_id} className="tv2-hub-crew__row">
                  <div className="tv2-hub-crew__avatar">{initials}</div>
                  <span className="tv2-hub-crew__name">{name}</span>
                  {isLead && <span className="tv2-hub-badge tv2-hub-badge--lead">{t('stage.lead')}</span>}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Checklist — the work surface; reachable in ALL states. */}
      <HubChecklist apptId={apptId} jobId={jobId} canToggle={isCrew} onMutation={onMutation} />

      {/* Field tools (moisture log + equipment list + scope) — ALL states. */}
      <HubTools job={job} jobId={jobId} address={address} rooms={rooms} onCreateRoom={onCreateRoom} onMutation={onMutation} />
    </div>
  );
}
