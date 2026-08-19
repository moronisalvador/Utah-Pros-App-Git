/**
 * ════════════════════════════════════════════════
 * FILE: HubMoreSheet.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The list that slides up from the bottom when a tech taps "More" on the Job
 *   Hub. It holds the things a tech DOES while standing in the house — start a
 *   scope sheet, price an out-of-pocket job, take a moisture reading. Anything
 *   that isn't offered for this job or this person simply isn't listed.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (opens over /tech/job/:jobId)
 *   Rendered by:  src/pages/tech/v2/TechJobHub.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom, react-i18next
 *   Internal:  @/contexts/AuthContext, @/lib/useDialogLifecycle,
 *              @/lib/useNativeKeyboardInset, @/lib/oopPricingAccess,
 *              ./hubHelpers (showsDryingTools)
 *   Data:      none (everything arrives as props or from the auth context)
 *
 * NOTES / GOTCHAS:
 *   - DOCS ARE NOT HERE. More holds VERBS (things you do on site); Docs is the
 *     noun list, and every customer-facing document is generated from the Docs
 *     page's own "+" button. Splitting document generation across two menus
 *     would teach two mental models for one task.
 *   - Work authorization is not here either, for the same reason — it is one of
 *     six documents, and it already has the red banner when it is missing.
 *   - "Take a reading" scrolls to the moisture section rather than opening the
 *     entry sheet directly: that sheet's state lives inside HubTools, and the
 *     Notes button already established scroll-to-section as this page's idiom.
 *     Lifting that state is worth doing when the daily-log work lands.
 *   - The gates are COPIED FROM HubTools deliberately, not re-invented: a row
 *     that appears here and not there (or vice versa) is the bug to avoid.
 *     Since H2-b that includes the DIVISION gate: a reconstruction job has no
 *     Dry Logs row, so it must not be offered a reading to take.
 * ════════════════════════════════════════════════
 */
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useDialogLifecycle } from '@/lib/useDialogLifecycle';
import useNativeKeyboardInset from '@/lib/useNativeKeyboardInset';
import { canUseOopPricing } from '@/lib/oopPricingAccess';
import { showsDryingTools } from './hubHelpers.js';

/**
 * @param {{
 *   open: boolean, onClose: () => void,
 *   job?: object|null, jobId: string, address?: string,
 *   onTakeReading?: () => void,
 * }} props
 */
export default function HubMoreSheet({
  open, onClose, job, jobId, address, onTakeReading,
}) {
  const { t } = useTranslation('hub');
  const { employee, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const kbInset = useNativeKeyboardInset();
  const panelRef = useRef(null);
  const dialogProps = useDialogLifecycle({ open, onClose, panelRef });

  if (!open) return null;

  // Same predicates HubTools uses — see the header note.
  const oopPricingEnabled = canUseOopPricing(employee?.role)
    && isFeatureEnabled('tool:oop_pricing');
  // The flag AND the division. showsDryingTools is the SAME helper the Dry Logs
  // row reads, which is the whole point: a take-a-reading row offered here that
  // scrolls to a section this job does not have is precisely the bug the shared
  // helper prevents.
  const moistureEnabled = isFeatureEnabled('page:tech_moisture')
    && showsDryingTools(job?.division);

  const go = (fn) => () => { onClose?.(); fn(); };

  const openScopeSheet = () => {
    const params = new URLSearchParams();
    if (job?.id) params.set('jobId', job.id);
    if (job?.job_number) params.set('jobNumber', job.job_number);
    if (address) params.set('address', address);
    if (job?.insured_name) params.set('insuredName', job.insured_name);
    if (job?.encircle_claim_id) params.set('claimId', job.encircle_claim_id);
    const qs = params.toString();
    navigate(`/tech/tools/demo-sheet${qs ? '?' + qs : ''}`);
  };

  const rows = [
    {
      key: 'scope',
      icon: '📋',
      title: t('stage.scopeSheet'),
      sub: t('stage.scopeSheetDesc'),
      onClick: go(openScopeSheet),
    },
    oopPricingEnabled && jobId && {
      key: 'oop',
      icon: '🧮',
      title: t('stage.oopEstimate'),
      sub: t('stage.oopEstimateDesc'),
      onClick: go(() => navigate(`/tech/tools/oop-pricing?jobId=${encodeURIComponent(jobId)}`)),
    },
    moistureEnabled && onTakeReading && {
      key: 'reading',
      icon: '💧',
      title: t('more.takeReading'),
      sub: t('more.takeReadingDesc'),
      onClick: go(onTakeReading),
    },
  ].filter(Boolean);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        paddingBottom: kbInset || undefined,
        animation: 'tech-fade-in 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        ref={panelRef}
        {...dialogProps}
        aria-label={t('more.title')}
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--bg-primary)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
          maxHeight: kbInset > 0 ? '100%' : '80dvh',
          display: 'flex', flexDirection: 'column',
          paddingBottom: kbInset > 0 ? 12 : 'max(12px, env(safe-area-inset-bottom, 12px))',
          animation: 'tech-slide-up 0.22s ease-out',
        }}
      >
        <div className="tv2-hub-moresheet__grip" aria-hidden="true" />
        <div className="tv2-hub-moresheet__title">{t('more.title')}</div>

        <div style={{ overflowY: 'auto' }}>
          {rows.map((r) => (
            <button key={r.key} type="button" className="tv2-hub-tool-row" onClick={r.onClick}>
              <div className="tv2-hub-tool-row__icon">{r.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tv2-hub-tool-row__title">{r.title}</div>
                <div className="tv2-hub-tool-row__sub">{r.sub}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
