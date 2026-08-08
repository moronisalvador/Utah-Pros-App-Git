/**
 * ════════════════════════════════════════════════
 * FILE: JobStage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   What the Job Hub shows when nobody is on the clock and you opened the job
 *   itself — from Claims, say, rather than by tapping a visit on your schedule.
 *   Instead of a timer you get the state of the job: what phase it's in, a few
 *   counts worth knowing, and a row that takes you into the next scheduled
 *   visit. The field tools (scope sheet, moisture, equipment) are here too,
 *   because those belong to the job, not to any one visit.
 *
 *   The important part is what is NOT here: no clock, and no Finish button for
 *   a visit nobody started.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (the body of /tech/job/:jobId in job mode)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  ./HubTools
 *   Data:      reads → nothing directly (counts are derived from the
 *              appointments the page already loaded; HubTools owns its own
 *              queries). writes → none.
 *
 * NOTES / GOTCHAS:
 *   - Every count here comes from data the page ALREADY has. The spec's
 *     "Materials dry" and "Photos" tiles are deliberately absent until the Dry
 *     Logs module and the rooms grid land — a tile that has to invent its number
 *     is worse than a tile that isn't there.
 *   - The Rooms tile only appears when the rooms feature is on; otherwise the
 *     row renders two cells rather than a cell reading zero.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import HubTools from './HubTools.jsx';

const DONE = ['completed', 'cancelled'];

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

/** Open tasks across every visit that hasn't been closed out. */
function openTaskCount(appointments) {
  return appointments.reduce((sum, a) => {
    if (DONE.includes(a.status)) return sum;
    const total = a.task_total || 0;
    const done = a.task_completed || 0;
    return sum + Math.max(0, total - done);
  }, 0);
}

/**
 * @param {{ job: object, jobId: string, address?: string,
 *           appointments?: Array, nextVisit?: object|null,
 *           rooms: Array|null, roomsEnabled?: boolean,
 *           onCreateRoom: Function, onSelectVisit?: (id:string)=>void,
 *           onMutation?: (kind:string)=>void }} props
 */
export default function JobStage({
  job, jobId, address, appointments = [], nextVisit,
  rooms, roomsEnabled, onCreateRoom, onSelectVisit, onMutation, toolsRef,
}) {
  const { t } = useTranslation('hub');

  const openTasks = openTaskCount(appointments);
  const visitCount = appointments.length;
  const roomCount = Array.isArray(rooms) ? rooms.length : 0;

  return (
    <div className="tv2-hub-stage tv2-hub-stage--job">
      <section className="tv2-hub-section">
        {/* The job's phase is already the hero's status pill — not repeated here. */}
        <div className="tv2-hub-section__head">
          <span className="tv2-hub-section__title">{t('job.sectionTitle')}</span>
        </div>

        <div className="tv2-hub-jobstat">
          <div className="tv2-hub-jobstat__cell">
            <div className="tv2-hub-jobstat__n">{openTasks}</div>
            <div className="tv2-hub-jobstat__l">{t('job.openTasks')}</div>
          </div>
          <div className="tv2-hub-jobstat__cell">
            <div className="tv2-hub-jobstat__n">{visitCount}</div>
            <div className="tv2-hub-jobstat__l">{t('job.visits')}</div>
          </div>
          {roomsEnabled && (
            <div className="tv2-hub-jobstat__cell">
              <div className="tv2-hub-jobstat__n">{roomCount}</div>
              <div className="tv2-hub-jobstat__l">{t('job.rooms')}</div>
            </div>
          )}
        </div>

        {nextVisit ? (
          <button type="button" className="tv2-hub-jobnext" onClick={() => onSelectVisit?.(nextVisit.id)}>
            <span className="tv2-hub-jobnext__ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" />
              </svg>
            </span>
            <span className="tv2-hub-jobnext__body">
              <span className="tv2-hub-jobnext__t">
                {t('job.nextVisit')} · {nextVisit.date}
                {nextVisit.time_start ? ` ${nextVisit.time_start.slice(0, 5)}` : ''}
              </span>
              <span className="tv2-hub-jobnext__m">
                {nextVisit.title || titleCase(nextVisit.type) || t('job.aVisit')}
              </span>
            </span>
            <svg className="tv2-hub-jobnext__chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <div className="tv2-hub-jobnone">{t('job.noUpcoming')}</div>
        )}
      </section>

      {/* Field tools are JOB-scoped, so they belong in both hero modes. The ref
          is the More sheet's "Take a reading" scroll target. */}
      <div ref={toolsRef}>
        <HubTools
          job={job}
          jobId={jobId}
          address={address}
          rooms={rooms}
          onCreateRoom={onCreateRoom}
          onMutation={onMutation}
        />
      </div>
    </div>
  );
}
