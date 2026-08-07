/**
 * ════════════════════════════════════════════════
 * FILE: HubHeader.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The colored band across the top of the Job Hub — the same one every other
 *   tech screen uses, tinted by the kind of job (blue for water, red for fire,
 *   and so on). It shows a Back button, a help button, a status pill, the
 *   customer's name (tap it to open the customer), the job number and what this
 *   visit is for, the address (tap it for directions), and a "View claim"
 *   button when the job belongs to a claim.
 *
 *   It looks the same whether you arrived on a visit or opened the job itself —
 *   only the status pill and the sub-line change.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (the top band of /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/components/tech/TechHelpButton, @/lib/techDateUtils (openMap),
 *              @/lib/backNav, ../../techConstants (DIV_GRADIENTS, DIV_PILL_COLORS)
 *   Data:      none (all data arrives as props)
 *
 * NOTES / GOTCHAS:
 *   - The gradient and pill color come from the SAME techConstants maps the
 *     legacy appointment page uses, so the Hub cannot drift away from the rest
 *     of the tech app when a division color changes.
 *   - The status pill is the SELECTED VISIT's appointment status in visit mode,
 *     and the JOB's phase in job mode. It is never the viewer's own clock — that
 *     lives on the Stage and can legitimately differ.
 *   - There is no "View job" button on purpose: the Hub IS the job (spec §12.5).
 *     The work-auth warning is not here either — it is a banner in the body so
 *     it reads at full size, per §12.5's data rule.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import TechHelpButton from '@/components/tech/TechHelpButton';
import { openMap } from '@/lib/techDateUtils';
import { canGoBack, goBackOr } from '@/lib/backNav';
import { DIV_GRADIENTS, DIV_PILL_COLORS } from '../../techConstants';

/** Turn a snake_case status/phase into something a person reads. */
function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

// TechHelpButton is styled by prop, not class. Hoisted so it is not a new object
// on every render (it would defeat the button's own memoization).
const HELP_BTN_STYLE = {
  width: 36, height: 36,
  background: 'rgba(255,255,255,0.2)',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.35)',
};

/**
 * @param {{
 *   jobId: string, jobNumber?: string, title: string, address?: string,
 *   division?: string, status?: string, subtitle?: string,
 *   claim?: {id:string, claim_number?:string}|null,
 *   isPrivate?: boolean, isAdmin?: boolean, onMenu?: () => void,
 * }} props
 */
export default function HubHeader({
  jobNumber, title, address, division, status, subtitle,
  claim, isPrivate, isAdmin, onMenu,
}) {
  const { t } = useTranslation('hub');
  const navigate = useNavigate();

  const gradient = DIV_GRADIENTS[division] || DIV_GRADIENTS.water;
  const pillColor = (DIV_PILL_COLORS[division] || DIV_PILL_COLORS.water)?.color || '#1e40af';

  // Origin-aware Back: pop to wherever the tech came from (dashboard, schedule,
  // claim, messages); the claim page is only the fallback for a cold open with
  // no in-app history (deep link / saved URL).
  const goBack = () => goBackOr(navigate, claim ? `/tech/claims/${claim.id}` : '/tech');

  return (
    <header className="tv2-hub-hero" style={{ background: gradient }}>
      <div className="tv2-hub-hero__bar">
        <button
          type="button"
          className="tv2-hub-hero__back"
          onClick={goBack}
          aria-label={!canGoBack() && claim ? t('header.backToClaim') : t('header.back')}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="tv2-hub-hero__baractions">
          <TechHelpButton topicKey="timer" style={HELP_BTN_STYLE} />
          {isPrivate && (
            <span className="tv2-hub-hero__lock">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {t('header.private')}
            </span>
          )}
          {status && (
            <span className="tv2-hub-hero__status" style={{ color: pillColor }}>{titleCase(status)}</span>
          )}
          {isAdmin && (
            <button type="button" className="tv2-hub-hero__kebab" onClick={onMenu} aria-label={t('header.menu')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Identity. Spec §12.5 wants this tappable → Customer page, but the tech
          shell has no customer route yet, and a tap that goes nowhere is worse
          than plain text. It becomes a link when that page exists. */}
      <div className="tv2-hub-hero__name">{title}</div>

      <div className="tv2-hub-hero__sub">
        {jobNumber}
        {subtitle ? ` · ${subtitle}` : ''}
      </div>

      {address && (
        <button type="button" className="tv2-hub-hero__addr" onClick={() => openMap(address)}>
          {address}
        </button>
      )}

      {claim?.id && (
        <div className="tv2-hub-hero__pills">
          <button type="button" className="tv2-hub-hero__pill" onClick={() => navigate(`/tech/claims/${claim.id}`)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
            </svg>
            {claim.claim_number ? t('header.viewClaimNumbered', { number: claim.claim_number }) : t('header.viewClaim')}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}
