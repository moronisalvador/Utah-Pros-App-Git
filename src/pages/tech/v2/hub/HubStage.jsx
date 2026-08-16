/**
 * ════════════════════════════════════════════════
 * FILE: HubStage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The heart of the Job Hub — "the Stage." It reads the tech's own clock on the
 *   selected visit and reshapes around where they are: a purpose card before they
 *   leave, the three clock buttons while they work, a travel/on-site/total
 *   breakdown once they're done. Everything else — the crew, the office note, the
 *   task checklist and the field tools — stays reachable in EVERY state; the stage
 *   only changes what's big, never what's available. A tech who isn't on this
 *   visit's crew is asked to confirm once, then gets the same clock as everyone
 *   else; a tech clocked into a different job sees a "go there" banner.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z2 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/components/tech/TimeTracker,
 *              @/components/tech/v2 (apptHref), @/lib/techDateUtils,
 *              ./useVisitClock
 *   Data:      reads → job_time_entries (via useVisitClock). writes → none here
 *              (children own their writes; TimeTracker owns the clock).
 *
 * NOTES / GOTCHAS:
 *   - TimeTracker MUST receive the get_appointment_detail object (has .jobs and
 *     the full crew shape), NEVER the get_job_hub appointment row (crew differs,
 *     .jobs absent) — silent-data-loss trap, challenge-confirmed.
 *   - "Whose clock" is the VIEWER's own entry (useVisitClock keyed to employee).
 *     Non-crew → the clock is offered behind a one-tap acknowledgement, NOT
 *     withheld (2026-08-16; the legacy page never withheld it and nothing
 *     server-side does). Cancelled visit → wrapped-gray, no actions at all.
 * ════════════════════════════════════════════════
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import TimeTracker from '@/components/tech/TimeTracker';
import { apptHref } from '@/components/tech/v2';
import { useVisitClock } from './useVisitClock.js';
import { isOnCrew, stageBucket, shouldShowElsewhere } from './hubStageState.js';
import { todayInCompanyTimeZone } from '@/lib/companyDate';
import { relativeDate, formatTime } from '@/lib/techDateUtils';

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
 *   visit: object, jobId: string, appointments?: Array,
 *   clockedElsewhere?: object|null, onSelectVisit?: (id:string)=>void,
 *   onMutation?: (kind:string)=>void, stageMeta?: string|null,
 * }} props
 */
export default function HubStage({
  visit, jobId, appointments = [],
  clockedElsewhere, onSelectVisit, onMutation, stageMeta,
}) {
  const { t } = useTranslation(['hub', 'tracker']);
  const { employee, db } = useAuth();
  const navigate = useNavigate();

  const apptId = visit?.id;
  const clock = useVisitClock(db, apptId, employee?.id, jobId);

  const crew = visit?.appointment_crew || [];
  const isCrew = isOnCrew(crew, employee?.id);
  const isCancelled = visit?.status === 'cancelled';

  // A tech who is NOT on the crew may still clock in — they just acknowledge it
  // first. The legacy appointment page never gated this (TechAppointment renders
  // TimeTracker unconditionally), and nothing server-side enforces crew on the
  // clock path, so the Hub's original hard gate removed a real ability — cover
  // shifts, a tech picking up a job they were not scheduled on — while
  // protecting nothing. Owner-directed 2026-08-16: show the clock, ask once.
  //
  // Deliberately does NOT write appointment_crew. Self-assignment was the other
  // option on the table and was not chosen; this keeps the change to the UI it
  // regressed, and leaves the schedule's meaning to whoever owns the schedule.
  const [crewAck, setCrewAck] = useState(false);
  // Reset per visit, or acknowledging one visit would silently unlock the next
  // one the tech switches to inside the same mounted Hub.
  //
  // Adjusted DURING RENDER, not in an effect: React's documented way to reset
  // state on a changed prop, and the only one the lint rule allows
  // (react-hooks/set-state-in-effect is an error here). An effect would also
  // leave one paint where the previous visit's acknowledgement still applied.
  const [ackedAppt, setAckedAppt] = useState(apptId);
  if (apptId !== ackedAppt) {
    setAckedAppt(apptId);
    setCrewAck(false);
  }

  const canClock = (isCrew || crewAck) && !isCancelled;
  const showElsewhere = shouldShowElsewhere(clockedElsewhere, apptId);

  // Stage bucket: cancelled → wrapped-gray; else from the viewer's own clock.
  const stage = stageBucket(clock.status, isCancelled);


  // "Today 9:00 – 11:30 AM" — the booked window, localized (formatTime is 12h in
  // en, 24h in pt/es). It rides the clock card's status line so the tech can see
  // what they agreed to without opening the appointment.
  const windowLabel = visit?.time_start
    ? [relativeDate(visit.date), [formatTime(visit.time_start), visit.time_end ? formatTime(visit.time_end) : null].filter(Boolean).join(' – ')]
      .filter(Boolean).join(' ')
    : (visit?.date ? relativeDate(visit.date) : null);

  // A live "on job" figure for the STARTED station — this is what replaces the
  // big ticking timer the owner rejected. Minutes until an hour, then "2h 8m";
  // it freezes at paused_at while paused, and TimeTracker prefers the recorded
  // payroll value once the visit is finished.
  const ci = clock.currentEntry?.clock_in ? Date.parse(clock.currentEntry.clock_in) : null;
  const onJobLiveLabel = (() => {
    if (!ci || clock.currentEntry?.clock_out) return null;
    const end = clock.status === 'paused' && clock.currentEntry?.paused_at
      ? Date.parse(clock.currentEntry.paused_at)
      : clock.nowMs;
    if (!Number.isFinite(end)) return null;
    return t('tracker:onJobLabel', { value: fmtMinutes(Math.max(0, end - ci) / 60000) });
  })();

  // Next visit on this job (WRAPPED "what's next" card).
  const today = todayInCompanyTimeZone();
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

      {/* The pre-departure "purpose card" was removed 2026-08-08. It printed the
          visit title and the time window — both of which the hero sub-line and the
          clock card's status line now carry, so the screen said the same two things
          three times. It also rendered the window as raw "09:00:00–11:30:00".
          The visit's TYPE was the one thing only it showed; if that needs to come
          back it belongs on the clock line, not in a card of its own. */}

      {/* No big running timer here by design. It used to be a StageClock counting
          up in ~40px type; the owner cut it — "no need for a big clock scaring the
          technicians about time ticking". The duration now sits under the STARTED
          station as a quiet label, which is what Housecall Pro does too. */}

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
          <TimeTracker
            appt={visit}
            employee={employee}
            db={db}
            onUpdate={() => onMutation?.('clock')}
            windowLabel={windowLabel}
            onEdit={visit?.id ? () => navigate(`/tech/appointment/${visit.id}/edit`) : null}
            onJobLiveLabel={onJobLiveLabel}
            stageMeta={stageMeta}
          />
        </div>
      ) : !isCancelled && (
        <div className="tv2-hub-readonly">
          <span className="tv2-hub-readonly__text">{t('stage.notOnCrew')}</span>
          <button
            type="button"
            className="tv2-hub-readonly__go"
            onClick={() => setCrewAck(true)}
          >
            {t('stage.clockInAnyway')}
          </button>
        </div>
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

      {/* Crew, THEN the office note — owner-directed order ("I think I want the
          office notes in a separate card under the team card"). Who is coming
          reads faster than what the office typed, and the note is the thing you
          stop and read, so it earns the lower, quieter slot. */}
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

      {/* Office note — its own card, under the crew. Gate codes live here, so it
          stays visible in ALL states including cancelled. */}
      {visit?.notes && (
        <section className="tv2-hub-section">
          <div className="tv2-hub-section__title">{t('stage.officeNotes')}</div>
          <div className="tv2-hub-notes">{visit.notes}</div>
        </section>
      )}

      {/* The checklist and the field tools MOVED to the section list below
          (H2-b). They are still reachable in every stage state — the Tasks and
          Dry Logs rows are always rendered, and both default open in
          appointment mode — but they are no longer stacked inside the stage,
          which is what made this screen one very long page. */}
    </div>
  );
}
