/**
 * ════════════════════════════════════════════════
 * FILE: scheduleFormat.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Small display helpers for the v2 schedule: turning a 24-hour time like
 *   "14:30:00" into "2:30 PM", building a "8:00 – 9:30 AM" range, working out how
 *   many minutes into the day an appointment starts (for the day-timeline layout),
 *   and picking the right color name and short label for a status, a division, and
 *   an event-vs-job kind. Status owns the color a tech reads from three feet; the
 *   division is only a small pill.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (pure helper module)
 *   Rendered by:  n/a — imported by ScheduleRow + DayTimeline
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - STATUS_TOKEN maps DB status → the --status-<token>-* CSS custom-property set
 *     defined by Foundation on .tech-layout. It mirrors the shared StatusChip so a
 *     row's accent and a timeline block tint match the chip exactly.
 * ════════════════════════════════════════════════
 */
import { currentLocaleTag } from '@/lib/techDateUtils';

// status → the '--status-<token>-*' trio (matches StatusChip.jsx). Unknown/absent
// statuses fall back to 'scheduled'.
const STATUS_TOKEN = {
  scheduled: 'scheduled',
  confirmed: 'scheduled',
  en_route: 'enroute',
  in_progress: 'working',
  paused: 'paused',
  completed: 'completed',
  cancelled: 'completed',
};

/** The status token for a raw DB status. */
export function statusToken(status) {
  return STATUS_TOKEN[status] || 'scheduled';
}

/** `var(--status-<token>-<part>)` for a status. part ∈ 'bg' | 'color' | 'border'. */
export function statusVar(status, part) {
  return `var(--status-${statusToken(status)}-${part})`;
}

/** Minutes since midnight for a 'HH:MM[:SS]' string, or null. */
export function minutesOfDay(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 'HH:MM[:SS]' → '2:30 PM' (en) / '14:30' (pt/es). Empty for null/all-day. */
export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString(currentLocaleTag(), { hour: 'numeric', minute: '2-digit' });
}

/**
 * A compact time range: '8:00 – 9:30 AM' (shared meridiem when equal), or just the
 * start when there's no end, or 'All day' when there's no start.
 */
export function fmtTimeRange(start, end) {
  if (!start) return 'All day';
  if (!end) return fmtTime(start);
  const [sh] = start.split(':').map(Number);
  const [eh] = end.split(':').map(Number);
  const sAm = sh >= 12 ? 'PM' : 'AM';
  const eAm = eh >= 12 ? 'PM' : 'AM';
  if (sAm === eAm) {
    // Drop the meridiem from the start when both sides share it.
    const startNoMeridiem = fmtTime(start).replace(/ [AP]M$/, '');
    return `${startNoMeridiem} – ${fmtTime(end)}`;
  }
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

/** Whole-hour duration label ('1h 30m') from start/end, or '' when unknown. */
export function fmtDuration(start, end) {
  const s = minutesOfDay(start);
  const e = minutesOfDay(end);
  if (s == null || e == null) return '';
  const mins = e - s;
  if (mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const rm = mins % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

// Division → short pill label + token color pair (demoted UI — small pill only).
const DIVISION_META = {
  water: { label: 'Water', bg: '#dbeafe', color: '#1e40af' },
  mold: { label: 'Mold', bg: '#fce7f3', color: '#9d174d' },
  fire: { label: 'Fire', bg: '#fee2e2', color: '#b91c1c' },
  contents: { label: 'Contents', bg: '#d1fae5', color: '#065f46' },
  reconstruction: { label: 'Recon', bg: '#fef3c7', color: '#92400e' },
  remodeling: { label: 'Remodel', bg: '#fdece8', color: '#c0432a' },
};

/** Small division pill meta, or null when there's no known division. */
export function divisionMeta(division) {
  return DIVISION_META[division] || null;
}

/** True when an appointment is a personal event (no job), not job work. */
export function isEvent(appt) {
  return appt.kind === 'event' || !appt.job_id;
}
