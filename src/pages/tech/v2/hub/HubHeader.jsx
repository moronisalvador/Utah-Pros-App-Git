/**
 * ════════════════════════════════════════════════
 * FILE: HubHeader.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The compact bar pinned to the top of the Job Hub. It never scrolls away. It
 *   shows a Back button (back to the claim if this job has one), the job number
 *   with a colored status chip for the visit you're looking at, the customer's
 *   name, and a tappable address that opens Maps. On the right it always shows a
 *   small work-authorization pill — quiet gray "Signed" or a red "Get signature"
 *   that jumps straight into signing — plus a lock badge on a private visit, a
 *   help button, and (for admins) a "⋯" menu.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (Z1 of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/components/tech/v2 (StatusChip), @/components/tech/TechHelpButton,
 *              @/lib/techDateUtils (openMap)
 *   Data:      none (all data arrives as props)
 *
 * NOTES / GOTCHAS:
 *   - The status chip is the SELECTED VISIT's appointment status; it can differ
 *     from the Stage's "Your clock" (that's the viewer's own entry) — by design.
 *   - Work-auth pill predicate is showWorkAuthBanner(hub) (shared with the legacy
 *     pages); it links into /documents with state {startEsign:'work_auth'}.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/tech/v2';
import TechHelpButton from '@/components/tech/TechHelpButton';
import { openMap } from '@/lib/techDateUtils';

/**
 * @param {{
 *   jobId: string, jobNumber?: string, title: string, address?: string,
 *   status?: string, claim?: {id:string}|null, isPrivate?: boolean,
 *   workAuthSigned?: boolean, isAdmin?: boolean, onMenu?: () => void,
 * }} props
 */
export default function HubHeader({
  jobId, jobNumber, title, address, status, claim, isPrivate,
  workAuthSigned, isAdmin, onMenu,
}) {
  const { t } = useTranslation('hub');
  const navigate = useNavigate();

  const goBack = () => (claim ? navigate(`/tech/claims/${claim.id}`) : navigate(-1));
  const goSign = () =>
    navigate(`/tech/jobs/${jobId}/documents`, { state: { startEsign: 'work_auth' } });

  return (
    <header className="tv2-hub-header">
      <div className="tv2-hub-header__row">
        <button type="button" className="tv2-hub-header__back" onClick={goBack} aria-label={claim ? t('header.backToClaim') : t('header.back')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="tv2-hub-header__id">
          <div className="tv2-hub-header__idtop">
            {jobNumber && <span className="tv2-hub-header__num">{jobNumber}</span>}
            {status && <StatusChip status={status} />}
            {isPrivate && (
              <span className="tv2-hub-header__lock" title={t('header.private')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                {t('header.private')}
              </span>
            )}
          </div>
          <div className="tv2-hub-header__name">{title}</div>
          {address && (
            <button type="button" className="tv2-hub-header__addr" onClick={() => openMap(address)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              <span>{address}</span>
            </button>
          )}
        </div>

        <div className="tv2-hub-header__actions">
          <TechHelpButton topicKey="timer" style={{ width: 36, height: 36 }} />
          {isAdmin && (
            <button type="button" className="tv2-hub-header__kebab" onClick={onMenu} aria-label={t('header.menu')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
            </button>
          )}
        </div>
      </div>

      {/* Work-auth pill — always visible; the one persistent job-level warning. */}
      <button
        type="button"
        className={`tv2-hub-wa-pill${workAuthSigned ? ' is-signed' : ' is-unsigned'}`}
        onClick={workAuthSigned ? undefined : goSign}
        disabled={workAuthSigned}
      >
        {workAuthSigned ? (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            {t('header.signed')}
          </>
        ) : (
          <>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            {t('header.getSignature')}
          </>
        )}
      </button>
    </header>
  );
}
