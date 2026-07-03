/**
 * ════════════════════════════════════════════════
 * FILE: MiniTimeline.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A slim horizontal strip showing every one of today's visits in order as
 *   little color-coded chips — blue for scheduled, amber for on-my-way, green for
 *   working, red for paused, gray for done. It's the "whole day at a glance" so a
 *   tech can see how many stops are left and swipe sideways through them. Tapping
 *   a chip opens that visit.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (section of the dashboard)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/tech/v2/nav (apptHref)
 *   Data:      none (appointments arrive as a prop)
 *
 * NOTES / GOTCHAS:
 *   - Status owns the color channel (tech-mobile-ux) — the chip tint comes from
 *     the --status-* tokens, never the appointment's division color.
 * ════════════════════════════════════════════════
 */
import { useNavigate } from 'react-router-dom';
import { apptHref } from '@/components/tech/v2/nav.js';

// status → the --status-<tone>-* token set.
const TONE = {
  scheduled: 'scheduled', confirmed: 'scheduled',
  en_route: 'enroute', in_progress: 'working', paused: 'paused', completed: 'completed',
};

function fmtClock(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = Number(h);
  return `${hour % 12 || 12}:${m}${hour >= 12 ? 'p' : 'a'}`;
}

/**
 * @param {{ appointments: object[] }} props - today's visits (already mine, cancelled excluded).
 */
export default function MiniTimeline({ appointments }) {
  const navigate = useNavigate();
  const list = (appointments || []).filter((a) => a.status !== 'cancelled');
  if (list.length < 2) return null; // the hero already covers a single visit

  return (
    <div className="tv2-dash-timeline" role="list" aria-label="Today's visits">
      {list.map((a) => {
        const tone = TONE[a.status] || 'scheduled';
        return (
          <button
            key={a.id}
            type="button"
            role="listitem"
            className="tv2-dash-timeline__chip"
            style={{ '--chip-bg': `var(--status-${tone}-bg)`, '--chip-fg': `var(--status-${tone}-color)` }}
            onClick={() => navigate(apptHref(a.id, a.job_id))}
          >
            <span className="tv2-dash-timeline__time">{fmtClock(a.time_start) || '—'}</span>
            <span className="tv2-dash-timeline__label">{a.jobs?.insured_name || a.title || 'Visit'}</span>
          </button>
        );
      })}
    </div>
  );
}
