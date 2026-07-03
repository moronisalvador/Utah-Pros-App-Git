/**
 * ════════════════════════════════════════════════
 * FILE: ComingUp.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "coming up" list — the tech's own visits over the next seven days,
 *   grouped by day so they can prep the night before. Each day gets a heading
 *   (like "Friday, Jul 4") and its visits below it as tappable rows.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (section of the dashboard)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/tech/v2 (ApptListRow)
 *   Data:      none (upcoming visits arrive as a prop from get_tech_dashboard)
 *
 * NOTES / GOTCHAS:
 *   - The feed already scopes `upcoming` to ME and excludes cancelled, so no
 *     extra filtering is needed here (unlike the v1 dashboard, which pulled
 *     all-crew upcoming and showed crew names).
 * ════════════════════════════════════════════════
 */
import { ApptListRow } from '@/components/tech/v2';

function dayHeading(ds) {
  const d = new Date(ds + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * @param {{ upcoming: object[] }} props - my next 7 days (already scoped + sorted).
 */
export default function ComingUp({ upcoming }) {
  if (!upcoming || upcoming.length === 0) return null;

  const byDay = new Map();
  upcoming.forEach((a) => {
    if (!byDay.has(a.date)) byDay.set(a.date, []);
    byDay.get(a.date).push(a);
  });
  const days = [...byDay.keys()].sort();

  return (
    <div className="tv2-dash-comingup">
      <div className="tv2-dash-section-title">Coming up</div>
      {days.map((ds) => (
        <div key={ds} className="tv2-dash-comingup__day">
          <div className="tv2-dash-comingup__dayhead">{dayHeading(ds)}</div>
          <div className="tv2-dash-comingup__rows">
            {byDay.get(ds).map((a) => <ApptListRow key={a.id} appt={a} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
