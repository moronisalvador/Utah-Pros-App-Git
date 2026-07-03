/**
 * ════════════════════════════════════════════════
 * FILE: ApptListRow.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One tappable row for an appointment in a v2 list (schedule or dashboard). It
 *   shows the time, the title, who/where, a status pill, and the task progress —
 *   everything a tech needs to recognize the visit at a glance — and opens the
 *   right detail screen when tapped. It's a shared building block so the schedule
 *   and dashboard look and behave identically.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared primitive)
 *   Rendered by:  v2 schedule agenda + dashboard lists
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  StatusChip, nav (apptHref), index.css (.tv2-appt-row)
 *   Data:      none (pure presentational — parent supplies the appointment)
 *
 * NOTES / GOTCHAS:
 *   - Navigation goes through apptHref() (never a hardcoded path) so the M2 hub
 *     cutover is a one-line flip.
 *   - The left accent bar uses the appointment's own color when present, else a
 *     neutral token — status still owns the pill color.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import StatusChip from './StatusChip.jsx';
import { apptHref } from './nav.js';

// 'HH:MM:SS' or 'HH:MM' → '8:30 AM'. Returns '' for null/all-day.
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = Number(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

/**
 * @param {{ appt: object, onNavigate?: (href: string) => void }} props
 */
export default function ApptListRow({ appt, onNavigate }) {
  const navigate = useNavigate();
  const href = apptHref(appt.id, appt.job_id);
  const go = () => (onNavigate ? onNavigate(href) : navigate(href));

  const time = fmtTime(appt.time_start);
  const job = appt.jobs;
  const where = job ? [job.insured_name, job.city].filter(Boolean).join(' · ') : (appt.notes || '');
  const total = Number(appt.task_total || 0);
  const done = Number(appt.task_completed || 0);
  const accent = appt.color || 'var(--tech-accent)';

  return (
    <button type="button" className="tv2-appt-row" onClick={go}>
      <span className="tv2-appt-row__bar" style={{ background: accent }} aria-hidden="true" />
      <span className="tv2-appt-row__body">
        <span className="tv2-appt-row__title">{appt.title || 'Appointment'}</span>
        <span className="tv2-appt-row__meta">
          {time && <>{time}</>}
          {time && where && ' · '}
          {where}
          {total > 0 && <> · {done}/{total} tasks</>}
        </span>
      </span>
      <StatusChip status={appt.status} />
    </button>
  );
}
