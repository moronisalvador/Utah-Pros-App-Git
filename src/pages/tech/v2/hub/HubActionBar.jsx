/**
 * ════════════════════════════════════════════════
 * FILE: HubActionBar.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The row of buttons just under the colored band at the top of the Job Hub:
 *   text the customer, open the job's documents, jump to the job's notes, open
 *   the drying screen, or open "More" for the things a tech does on site.
 *   Buttons the job can't support are greyed out rather than hidden, so the row
 *   never changes shape between jobs — with ONE deliberate exception, Dry logs,
 *   which is absent entirely on a job that has no drying phase.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (sits under the hero on /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/lib/openInAppThread (openJobThread),
 *              ./hubHelpers (showsDryingTools)
 *   Data:      reads → the conversation lookup inside openJobThread. writes → none.
 *
 * NOTES / GOTCHAS:
 *   - There is no Navigate button on purpose: the hero's address row IS the
 *     navigate affordance (spec §12.5). That is what frees a column for Notes.
 *   - Photo is not here either — it stays the emphasized member of the bottom
 *     dock until room-first capture ships, at which point capture moves inside a
 *     room and the dock retires (§12.5.2).
 *   - Message resolves the job's conversation on tap, so a second tap is blocked
 *     while the first lookup is still in flight (same guard as the dock).
 *   - Dry logs is the one member that can be ABSENT rather than disabled. A
 *     reconstruction job has no drying phase, so a greyed-out button would be
 *     lying about a capability that does not exist for that job at all. It reads
 *     the same showsDryingTools helper the old body section did.
 *   - FIVE columns at 390px is 78px each against a 56px min-height, so the tap
 *     target clears the 48px floor on tech surfaces. Measured, not assumed —
 *     and the bar was built for five before Navigate was removed.
 *   - THE LABELS ARE ONE WORD ON PURPOSE, in every locale. 78px at 10px holds
 *     roughly 13 characters and the rule has no ellipsis, so a long label
 *     overflows its column silently. Spanish and Portuguese say "Secado" /
 *     "Secagem" here while the SCREEN keeps the full "Registros de secado" —
 *     hub.json's actionBar.dryLogs and sections.dryLogs differ deliberately;
 *     do not "fix" them to match.
 * ════════════════════════════════════════════════
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { openJobThread } from '@/lib/openInAppThread';
import { showsDryingTools } from './hubHelpers.js';

/**
 * @param {{ jobId: string, phone?: string|null, division?: string|null,
 *           noteCount?: number, onNotes?: () => void, onMore?: () => void }} props
 */
export default function HubActionBar({ jobId, phone, division, noteCount = 0, onNotes, onMore }) {
  const { t } = useTranslation(['hub', 'tech']);
  const { db } = useAuth();
  const navigate = useNavigate();
  const showDrying = showsDryingTools(division);
  const [openingThread, setOpeningThread] = useState(false);
  // openJobThread navigates away on success, so the component can unmount while
  // the lookup is still in flight — don't set state on a dead component.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const openThread = useCallback(async () => {
    setOpeningThread(true);
    try { await openJobThread(navigate, jobId, db); }
    finally { if (alive.current) setOpeningThread(false); }
  }, [navigate, jobId, db]);

  return (
    <nav className="tv2-hub-actionbar" aria-label={t('actionBar.label')}>
      {/* No Call. There is no dialer in this app and there won't be for a while
          (owner, 2026-08-07), so the column was spending a quarter of the most
          valuable row on the screen to open the OS phone app. Message is how a
          tech reaches the customer; the number is still on the Job & Claim card
          for anyone who wants to dial it by hand. */}
      <button
        type="button"
        className="tv2-hub-actionbar__btn"
        onClick={phone ? openThread : undefined}
        disabled={!phone || openingThread}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="tv2-hub-actionbar__label">{t('tech:actionBar.message')}</span>
      </button>

      <button
        type="button"
        className="tv2-hub-actionbar__btn"
        onClick={() => navigate(`/tech/jobs/${jobId}/documents`)}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="tv2-hub-actionbar__label">{t('actionBar.docs')}</span>
      </button>

      <button type="button" className="tv2-hub-actionbar__btn" onClick={onNotes}>
        <span className="tv2-hub-actionbar__ic">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16v13l-4 4H4z" /><polyline points="20 17 16 17 16 21" />
            <line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="13" y2="13" />
          </svg>
          {noteCount > 0 && <span className="tv2-hub-actionbar__count">{noteCount}</span>}
        </span>
        <span className="tv2-hub-actionbar__label">{t('actionBar.notes')}</span>
      </button>

      {/* Dry logs is a DESTINATION, not a row (owner ruling 2026-08-19). It sat in
          the body as a collapsed accordion; chambers, monitoring points and
          readings-over-days is a workspace, which an accordion can summarise but
          cannot be. Gated on the SAME showsDryingTools helper the section used,
          so a reconstruction job still shows no drying affordance anywhere —
          a button in one place and not the other is the bug that gate prevents. */}
      {showDrying && (
        <button
          type="button"
          className="tv2-hub-actionbar__btn"
          onClick={() => navigate(`/tech/job/${jobId}/dry-logs`)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2.7s5.5 6 5.5 10.1a5.5 5.5 0 0 1-11 0C6.5 8.7 12 2.7 12 2.7z" />
          </svg>
          <span className="tv2-hub-actionbar__label">{t('actionBar.dryLogs')}</span>
        </button>
      )}

      {/* Docs are nouns, More is verbs — see HubMoreSheet's header for why
          document generation deliberately does NOT appear in here. */}
      <button type="button" className="tv2-hub-actionbar__btn" onClick={onMore}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
        </svg>
        <span className="tv2-hub-actionbar__label">{t('actionBar.more')}</span>
      </button>
    </nav>
  );
}
