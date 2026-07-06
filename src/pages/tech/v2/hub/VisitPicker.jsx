/**
 * ════════════════════════════════════════════════
 * FILE: VisitPicker.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The list of a job's visits (appointments), split into Upcoming and Past.
 *   Tapping a visit selects it — it does NOT open a new screen; instead the rest
 *   of the hub (timer, tasks, crew, readings, equipment) re-scopes to that visit
 *   and the web address updates to ?appt=<id>. The currently-selected visit is
 *   highlighted. A "Schedule appointment" button adds a new visit to this job.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/pages/tech/techConstants (APPT_STATUS_COLORS),
 *              @/lib/techDateUtils (formatTime, relativeDate),
 *              index.css (.tv2-hub-visit-*)
 *   Data:      none (appointments arrive as props, get_job_hub shape)
 *
 * NOTES / GOTCHAS:
 *   - Grouping/sorting mirrors the legacy TechJobDetail Upcoming/Past split so
 *     the visit ordering is unchanged through the merge.
 * ════════════════════════════════════════════════
 */
import { useNavigate } from 'react-router-dom';
import { APPT_STATUS_COLORS } from '@/pages/tech/techConstants';
import { formatTime, relativeDate } from '@/lib/techDateUtils';

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function VisitRow({ appt, selected, onSelect }) {
  const sc = APPT_STATUS_COLORS[appt.status] || APPT_STATUS_COLORS.scheduled;
  const title = appt.title || titleCase(appt.type || 'Appointment');
  const crewNames = (appt.crew || [])
    .map((c) => (c.full_name || '').split(' ')[0])
    .filter(Boolean).join(', ');
  const time = formatTime(appt.time_start);

  return (
    <button
      type="button"
      className={`tv2-hub-visit${selected ? ' is-selected' : ''}`}
      style={{ borderLeftColor: sc.color }}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="tv2-hub-visit__top">
        <span className="tv2-hub-visit__title">{title}</span>
        <span
          className="tv2-hub-visit__status"
          style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
        >
          {(appt.status || 'scheduled').replace(/_/g, ' ')}
        </span>
      </div>
      <div className="tv2-hub-visit__meta">
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {relativeDate(appt.date)}{time ? ` · ${time}` : ''}
        </span>
        {crewNames && <><span>·</span><span>Crew: {crewNames}</span></>}
        {appt.task_total > 0 && <><span>·</span><span>{appt.task_completed}/{appt.task_total} tasks</span></>}
      </div>
      {selected && <span className="tv2-hub-visit__badge">Viewing</span>}
    </button>
  );
}

export default function VisitPicker({ appointments, selectedId, onSelect, jobId }) {
  const navigate = useNavigate();
  const today = new Date().toISOString().split('T')[0];

  const upcoming = appointments
    .filter((a) => a.date >= today && !['completed', 'cancelled'].includes(a.status))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time_start || '').localeCompare(b.time_start || ''));
  const past = appointments
    .filter((a) => a.date < today || ['completed', 'cancelled'].includes(a.status))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.time_start || '').localeCompare(a.time_start || ''));

  const scheduleBtn = (
    <button
      type="button"
      className="tv2-hub-visit-add"
      onClick={() => navigate(`/tech/new-appointment?jobId=${jobId}`)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      Schedule appointment
    </button>
  );

  return (
    <div className="tv2-hub-section">
      <div className="tech-section-header-sticky">
        Visits {appointments.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 400, letterSpacing: 'normal', textTransform: 'none', color: 'var(--text-secondary)' }}>
            {appointments.length}
          </span>
        )}
      </div>

      {appointments.length === 0 ? (
        <div style={{
          margin: '8px 0 0', padding: 16, borderRadius: 12,
          background: 'var(--bg-secondary)', border: '1px dashed var(--border-color)',
          fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center',
        }}>
          No appointments scheduled for this job yet.
        </div>
      ) : (
        <>
          {upcoming.length > 0 && <div className="tv2-hub-visit-sublabel">Upcoming</div>}
          {upcoming.map((a) => (
            <VisitRow key={a.id} appt={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
          ))}
          {past.length > 0 && <div className="tv2-hub-visit-sublabel">Past</div>}
          {past.map((a) => (
            <VisitRow key={a.id} appt={a} selected={a.id === selectedId} onSelect={() => onSelect(a.id)} />
          ))}
        </>
      )}
      {scheduleBtn}
    </div>
  );
}
