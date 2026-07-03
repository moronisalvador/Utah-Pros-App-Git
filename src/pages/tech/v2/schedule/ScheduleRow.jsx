/**
 * ════════════════════════════════════════════════
 * FILE: ScheduleRow.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One appointment as it appears in the schedule's agenda list. It shows the time,
 *   who/where, a status pill you can read from across a room, and small extras when
 *   they apply — the division, how many tasks are done, a lock for private events, a
 *   "multi-day" badge, and a milestone marker. Personal events (no job) get their
 *   own look so they don't read like job visits. Tapping the row opens the
 *   appointment (or, after the later Job Hub merge, the job) — always through the
 *   shared nav helper, never a hardcoded path.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (list row)
 *   Rendered by:  AgendaView (and the day-timeline's tap targets reuse the same nav)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/tech/v2 (StatusChip, apptHref), ./scheduleFormat
 *   Data:      none (pure presentational — parent supplies the appointment)
 *
 * NOTES / GOTCHAS:
 *   - The left accent bar uses the appointment's own calendar color when set, else
 *     a distinct purple for events, else the status color. The STATUS CHIP is the
 *     dominant color read; the division is only a small demoted pill.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusChip, apptHref } from '@/components/tech/v2';
import { fmtTime, fmtDuration, divisionMeta, isEvent, statusVar } from './scheduleFormat.js';

const EVENT_ACCENT = '#7c3aed'; // events read distinctly from job work

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/**
 * @param {{ appt: object }} props
 */
export default function ScheduleRow({ appt }) {
  const navigate = useNavigate();
  const event = isEvent(appt);
  const job = appt.jobs;
  const accent = appt.color || (event ? EVENT_ACCENT : statusVar(appt.status, 'color'));

  const primary = job?.insured_name || appt.title || (event ? 'Event' : 'Appointment');
  const secondary = job?.insured_name ? (appt.title || '') : (job ? [job.address, job.city].filter(Boolean).join(', ') : (appt.notes || ''));

  const div = job?.division ? divisionMeta(job.division) : null;
  const total = Number(appt.task_total || 0);
  const done = Number(appt.task_completed || 0);
  const multiDay = Number(appt.duration_days || 1) > 1;
  const duration = fmtDuration(appt.time_start, appt.time_end);

  return (
    <button
      type="button"
      className={`tv2-sched-row${event ? ' tv2-sched-row--event' : ''}`}
      onClick={() => navigate(apptHref(appt.id, appt.job_id))}
    >
      <span className="tv2-sched-row__bar" style={{ background: accent }} aria-hidden="true" />
      <span className="tv2-sched-row__time">
        <span className="tv2-sched-row__time-start">{appt.time_start ? fmtTime(appt.time_start) : 'All day'}</span>
        {duration && <span className="tv2-sched-row__time-dur">{duration}</span>}
      </span>
      <span className="tv2-sched-row__body">
        <span className="tv2-sched-row__title">
          {appt.is_milestone && <span className="tv2-sched-row__milestone" aria-label="Milestone">◆</span>}
          {primary}
          {appt.is_private && <span className="tv2-sched-row__lock" aria-label="Private"><LockIcon /></span>}
        </span>
        {secondary && <span className="tv2-sched-row__sub">{secondary}</span>}
        <span className="tv2-sched-row__meta">
          <StatusChip status={appt.status} />
          {div && <span className="tv2-sched-pill" style={{ background: div.bg, color: div.color }}>{div.label}</span>}
          {multiDay && <span className="tv2-sched-pill tv2-sched-pill--span">{appt.duration_days}-day</span>}
          {total > 0 && <span className="tv2-sched-row__tasks">{done}/{total} tasks</span>}
        </span>
      </span>
      <span className="tv2-sched-row__chevron" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 6 15 12 9 18" /></svg>
      </span>
    </button>
  );
}
