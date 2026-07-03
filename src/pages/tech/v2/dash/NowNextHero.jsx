/**
 * ════════════════════════════════════════════════
 * FILE: NowNextHero.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The big top tile on the v2 tech dashboard — the single most relevant thing
 *   right now. If the tech is on a job, it shows that job with the live clock
 *   controls (On my way / Start / Finish / Pause) as the one dominant action,
 *   plus a photo button. If a visit is scheduled for today but not started, it
 *   shows a countdown to it with the same clock controls. If nothing is left
 *   today, it previews the next upcoming visit. If there's truly nothing, it
 *   shows a friendly empty state pointing at the schedule.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (top section of the dashboard)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/tech/TimeTracker, ./PhotoCaptureButton, ./dashHelpers
 *   Data:      none directly (TimeTracker/PhotoCaptureButton own their writes)
 *
 * NOTES / GOTCHAS:
 *   - The clock controls are ONE composed TimeTracker — the mandated single
 *     primary action per screen. We never re-implement OMW/Start/Finish here.
 *   - The countdown ticker only runs while this pane is `active` (visibilitychange
 *     does not fire on a hidden pane).
 *   - Navigation uses apptHref() so the M2 hub cutover is a one-line flip.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import TimeTracker from '@/components/tech/TimeTracker';
import { apptHref, jobHref } from '@/components/tech/v2/nav.js';
import PhotoCaptureButton from './PhotoCaptureButton.jsx';
import { fmtHours } from './dashHelpers.js';

// ─── SECTION: Helpers ──────────────

// 'HH:MM:SS' → '8:30 AM'. '' for null/all-day.
function fmtClock(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = Number(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${m} ${ampm}`;
}

// Countdown label from now to a same-day HH:MM:SS start. null when no time.
function countdownLabel(timeStart) {
  if (!timeStart) return null;
  const [h, m] = timeStart.split(':').map(Number);
  const start = new Date();
  start.setHours(h, m || 0, 0, 0);
  const diffMin = Math.round((start.getTime() - Date.now()) / 60000);
  if (diffMin > 1) return `Starts in ${fmtHours(diffMin / 60)}`;
  if (diffMin >= -1) return 'Starting now';
  return `Was due ${fmtHours(Math.abs(diffMin) / 60)} ago`;
}

function ctxHeader(ctxType, appt) {
  if (ctxType === 'now_active') {
    if (appt.status === 'en_route') return { label: 'ON MY WAY', tone: 'enroute' };
    if (appt.status === 'in_progress') return { label: 'WORKING', tone: 'working' };
    return { label: 'PAUSED', tone: 'paused' };
  }
  if (ctxType === 'today') return { label: 'UP NEXT TODAY', tone: 'scheduled' };
  return { label: 'NEXT VISIT', tone: 'neutral' };
}

// ─── SECTION: Render ──────────────

/**
 * @param {{ hero: {ctxType:string, appt:object}|null, employee: object, db: object,
 *           active?: boolean, onClock?: () => void, onPhoto?: () => void }} props
 */
export default function NowNextHero({ hero, employee, db, active = true, onClock, onPhoto }) {
  const navigate = useNavigate();
  const [, forceTick] = useState(0);

  // Tick once a minute so the countdown stays fresh — only while visible.
  useEffect(() => {
    if (!active || !hero || hero.ctxType !== 'today') return undefined;
    const id = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, [active, hero]);

  if (!hero) {
    return (
      <div className="tv2-dash-hero tv2-dash-hero--empty">
        <div className="tv2-dash-hero__empty-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            <polyline points="9 16 11 18 15 14" strokeWidth="2" />
          </svg>
        </div>
        <div className="tv2-dash-hero__empty-title">Nothing on right now</div>
        <button type="button" className="tv2-dash-hero__empty-link" onClick={() => navigate('/tech/schedule')}>
          Check your schedule →
        </button>
      </div>
    );
  }

  const { ctxType, appt } = hero;
  const head = ctxHeader(ctxType, appt);
  const job = appt.jobs;
  const clientName = job?.insured_name || appt.title || 'Appointment';
  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
  const time = fmtClock(appt.time_start);
  const showTracker = ctxType === 'now_active' || ctxType === 'today';

  const openMap = (e) => {
    e.stopPropagation();
    if (!address) return;
    const encoded = encodeURIComponent(address);
    window.open(/iPhone|iPad/.test(navigator.userAgent) ? `maps://?q=${encoded}` : `https://maps.google.com/?q=${encoded}`);
  };

  const openDetail = () => navigate(apptHref(appt.id, appt.job_id));

  return (
    <div className={`tv2-dash-hero tv2-dash-hero--${head.tone}`}>
      <div className="tv2-dash-hero__eyebrow">
        <span className={`tv2-dash-hero__badge tv2-dash-hero__badge--${head.tone}`}>{head.label}</span>
        {ctxType === 'today' && <span className="tv2-dash-hero__countdown">{countdownLabel(appt.time_start)}</span>}
        {ctxType === 'next' && (
          <span className="tv2-dash-hero__countdown">{[appt.date && new Date(appt.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), time].filter(Boolean).join(' · ')}</span>
        )}
        {(ctxType === 'now_active') && time && <span className="tv2-dash-hero__countdown">{time}</span>}
      </div>

      <button type="button" className="tv2-dash-hero__identity" onClick={openDetail}>
        <span className="tv2-dash-hero__client">{clientName}</span>
        <span className="tv2-dash-hero__sub">
          {[appt.title, job?.job_number ? `#${job.job_number}` : null].filter(Boolean).join(' · ') || 'Appointment'}
        </span>
      </button>

      {address && (
        <button type="button" className="tv2-dash-hero__addr" onClick={openMap}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
          {address}
        </button>
      )}

      {showTracker && (
        <div className="tv2-dash-hero__tracker">
          <TimeTracker appt={appt} employee={employee} db={db} onUpdate={onClock} />
        </div>
      )}

      <div className="tv2-dash-hero__actions">
        {job && showTracker && (
          <PhotoCaptureButton job={job} appointmentId={appt.id} employee={employee} db={db} onUploaded={onPhoto} />
        )}
        <button type="button" className="tv2-dash-secondary-btn" onClick={openDetail}>📝 Notes</button>
        {ctxType === 'next' && job && (
          <button type="button" className="tv2-dash-secondary-btn" onClick={() => navigate(jobHref(appt.job_id))}>Open job</button>
        )}
      </div>
    </div>
  );
}
