/**
 * ════════════════════════════════════════════════
 * FILE: StageClock.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The big running timer at the top of the Job Hub's Stage while a tech is on a
 *   visit. It shows one large elapsed time (counting from "On My Way"), tinted by
 *   status — amber on the way, green working, red paused — with a small "Your
 *   clock" label so it's never mistaken for the appointment's overall status. If
 *   the clock has been running more than ten hours it adds an amber "did you
 *   forget to clock out?" hint. It only DISPLAYS — every button lives in the
 *   TimeTracker beneath it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (part of /tech/job/:jobId — the Stage, Z2)
 *   Rendered by:  src/pages/tech/v2/hub/HubStage.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-i18next
 *   Internal:  index.css (.tv2-hub-* + --status-* and --tech-text-timer tokens)
 *   Data:      none (the clock object is computed by useVisitClock and passed in)
 *
 * NOTES / GOTCHAS:
 *   - Purely presentational: give it the derived `clock` from useVisitClock. The
 *     live ticking happens inside that hook, not here.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

// h:mm:ss once past an hour, else m:ss — a glanceable field timer.
function fmtClock(msTotal) {
  const total = Math.max(0, Math.floor(msTotal / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// status → the --status-<token> trio to tint with.
const TOKEN = { omw: 'enroute', on_site: 'working', paused: 'paused' };

/**
 * @param {{ clock: ReturnType<import('./useVisitClock.js').deriveVisitClock> }} props
 */
export default function StageClock({ clock }) {
  const { t } = useTranslation('hub');
  const token = TOKEN[clock.status] || 'working';

  return (
    <div
      className="tv2-hub-stageclock"
      style={{ background: `var(--status-${token}-bg)`, borderColor: `var(--status-${token}-border)` }}
    >
      <div className="tv2-hub-stageclock__label" style={{ color: `var(--status-${token}-color)` }}>
        {t('stage.yourClock')} · {t(`clockStatus.${clock.status}`)}
        {clock.visitNumber ? ` · ${t('stage.visitBadge', { n: clock.visitNumber })}` : ''}
      </div>
      <div
        className="tv2-hub-stageclock__time"
        style={{ color: `var(--status-${token}-color)` }}
        aria-live="off"
      >
        {fmtClock(clock.elapsedMs)}
      </div>
      {clock.isStale && (
        <div className="tv2-hub-stageclock__stale">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{t('stage.staleHint')}</span>
        </div>
      )}
    </div>
  );
}
