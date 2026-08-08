/**
 * ════════════════════════════════════════════════
 * FILE: HubActionBar.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The row of four buttons just under the colored band at the top of the Job
 *   Hub: text the customer, open the job's documents, jump to the job's notes, or
 *   open "More" for the things a tech does on site. Buttons the job can't support
 *   are greyed out rather than hidden, so the row never changes shape between
 *   jobs.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (sits under the hero on /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/lib/openInAppThread (openJobThread)
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
 * ════════════════════════════════════════════════
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { openJobThread } from '@/lib/openInAppThread';

/**
 * @param {{ jobId: string, phone?: string|null, noteCount?: number,
 *           onNotes?: () => void, onMore?: () => void }} props
 */
export default function HubActionBar({ jobId, phone, noteCount = 0, onNotes, onMore }) {
  const { t } = useTranslation(['hub', 'tech']);
  const { db } = useAuth();
  const navigate = useNavigate();
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
