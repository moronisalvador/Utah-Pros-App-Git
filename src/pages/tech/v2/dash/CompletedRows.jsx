/**
 * ════════════════════════════════════════════════
 * FILE: CompletedRows.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "done today" list at the bottom of the dashboard. Each finished visit
 *   shows its time and client, plus the time breakdown for that visit —
 *   travel, on-site, and total — so the tech never sees a bare "3.5h" with no
 *   context (a hard rule for the tech app). Tapping a row opens the visit.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (section of the dashboard)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/tech/v2/nav (apptHref), ./dashHelpers (fmtHours)
 *   Data:      reads  → job_time_entries (this tech's entries for the visit,
 *                        to compute the per-visit travel / on-site / total)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The main dashboard payload (get_tech_dashboard) intentionally carries only
 *     the OPEN clock entry, so the per-visit breakdown for COMPLETED visits is
 *     fetched here, once per completed row (typically 1-4 a day). This is a
 *     read-only side fetch, separate from the single aggregate query — it does
 *     not re-run on clock mutations (a completed visit's stored hours are fixed).
 *   - Sums the STORED hours + travel_minutes columns (never recomputes from
 *     timestamps) — same contract as the hours math in get_tech_dashboard.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apptHref } from '@/components/tech/v2/nav.js';
import { fmtHours } from './dashHelpers.js';
import { formatTime } from '@/lib/techDateUtils';

function CompletedRow({ appt, employee, db }) {
  const { t } = useTranslation(['dash', 'tech']);
  const navigate = useNavigate();
  const [totals, setTotals] = useState(null); // { travel, onSite, total } in hours

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await db.select(
          'job_time_entries',
          `appointment_id=eq.${appt.id}&employee_id=eq.${employee.id}&select=hours,travel_minutes`,
        );
        if (cancelled) return;
        const onSite = (rows || []).reduce((s, r) => s + Number(r.hours || 0), 0);
        const travel = (rows || []).reduce((s, r) => s + Number(r.travel_minutes || 0), 0) / 60;
        setTotals({ travel, onSite, total: travel + onSite });
      } catch {
        if (!cancelled) setTotals({ travel: 0, onSite: 0, total: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, [db, appt.id, employee.id]);

  const time = formatTime(appt.time_start);
  const label = appt.jobs?.insured_name || appt.title || t('tech:misc.appointment');

  return (
    <button type="button" className="tv2-dash-completed-row" onClick={() => navigate(apptHref(appt.id, appt.job_id))}>
      <span className="tv2-dash-completed-row__head">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--status-completed-color)" strokeWidth="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
        {time && <span className="tv2-dash-completed-row__time">{time}</span>}
        <span className="tv2-dash-completed-row__label">{label}</span>
      </span>
      {totals && (
        <span className="tv2-dash-completed-row__breakdown">
          <span>{t('hours.travel')} {fmtHours(totals.travel)}</span>
          <span>·</span>
          <span>{t('hours.onSite')} {fmtHours(totals.onSite)}</span>
          <span>·</span>
          <strong>{t('hours.total')} {fmtHours(totals.total)}</strong>
        </span>
      )}
    </button>
  );
}

/**
 * @param {{ completed: object[], employee: object, db: object }} props
 */
export default function CompletedRows({ completed, employee, db }) {
  const { t } = useTranslation('dash');
  if (!completed || completed.length === 0) return null;
  return (
    <div className="tv2-dash-completed">
      <div className="tv2-dash-section-title">{t('completedToday')}</div>
      {completed.map((a) => (
        <CompletedRow key={a.id} appt={a} employee={employee} db={db} />
      ))}
    </div>
  );
}
