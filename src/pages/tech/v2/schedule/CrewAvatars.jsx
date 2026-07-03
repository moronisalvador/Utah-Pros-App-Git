/**
 * ════════════════════════════════════════════════
 * FILE: CrewAvatars.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little row of colored initial circles that shows who's assigned to an
 *   appointment — the same "MB / NS / JS" badges the desktop calendar shows. Each
 *   circle is the employee's color with their initials; if there are more people
 *   than fit, the last circle shows "+N".
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared bit of the schedule UI)
 *   Rendered by:  DayTimeline blocks + agenda ScheduleRow
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  index.css (.tv2-crew)
 *   Data:      none (parent passes the appointment_crew array from the feed)
 *
 * NOTES / GOTCHAS:
 *   - Reads each member's color/name from the crew row's nested `employees` object
 *     (the v2 feed exposes color/avatar_url there). Falls back to a neutral token.
 * ════════════════════════════════════════════════
 */
import React from 'react';

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * @param {{ crew?: object[], max?: number, size?: number }} props
 */
export default function CrewAvatars({ crew, max = 4, size = 18 }) {
  if (!crew || crew.length === 0) return null;
  const shown = crew.slice(0, max);
  const extra = crew.length - shown.length;
  return (
    <span className="tv2-crew" style={{ '--tv2-crew-size': `${size}px` }}>
      {shown.map((c) => {
        const emp = c.employees || {};
        const name = emp.display_name || emp.full_name || '';
        return (
          <span
            key={c.id || c.employee_id}
            className="tv2-crew__dot"
            style={{ background: emp.color || 'var(--text-tertiary)' }}
            title={name}
          >
            {initials(name)}
          </span>
        );
      })}
      {extra > 0 && <span className="tv2-crew__dot tv2-crew__dot--more">{`+${extra}`}</span>}
    </span>
  );
}
