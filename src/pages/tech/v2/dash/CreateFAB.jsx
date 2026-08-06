/**
 * ════════════════════════════════════════════════
 * FILE: CreateFAB.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The floating "+" button in the bottom-right of the dashboard. Tapping it
 *   opens create choices — New Job, New Customer, and (for billing roles with
 *   the receive-payment feature on) New Payment — and tapping one takes you to
 *   that screen. Tapping the dimmed backdrop closes it. The choices rise out
 *   of the button when it opens and settle back into it when it closes.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (floating control)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  index.css (.tv2-fab*), contexts/AuthContext, lib/claimUtils
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Menu motion is WAAPI (element.animate) in the component, not CSS:
 *     index.css sits ~89 bytes under its CI-blocking 600,000-byte ceiling, so
 *     new keyframes cannot fit there. Reduced-motion collapses to instant.
 * ════════════════════════════════════════════════
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { canEditBilling } from '@/lib/claimUtils';

// Inline instead of a .tv2-fab-pill--payment class (same byte-ceiling reason).
// Solid violet-600 (no app-wide violet token exists): distinct from the blue
// job and green customer pills, 6:1 contrast with the white pill text.
const PAYMENT_PILL_STYLE = {
  background: '#7c3aed',
  boxShadow: '0 4px 14px rgba(124, 58, 237, 0.35)',
};

// Mirrors --motion-duration-fast / --motion-ease-standard + decelerate.
const ENTER = [
  { opacity: 0, transform: 'translateY(10px) scale(0.96)' },
  { opacity: 1, transform: 'none' },
];
const EXIT = [
  { opacity: 1, transform: 'none' },
  { opacity: 0, transform: 'translateY(10px) scale(0.96)' },
];
const reducedMotion = () => typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function CreateFAB() {
  const { t } = useTranslation('dash');
  const navigate = useNavigate();
  const { employee, isFeatureEnabled } = useAuth();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const stackRef = useRef(null);
  const showPayment = canEditBilling(employee?.role)
    && isFeatureEnabled('feature:qbo_receive_payment');
  const shown = open || closing;

  // Pills rise out of the + button, nearest first, when the menu opens.
  useEffect(() => {
    if (!open || reducedMotion()) return;
    const pills = [...(stackRef.current?.querySelectorAll('.tv2-fab-pill') || [])];
    // A reopen mid-close must drop the forwards-filled exit, or it re-hides
    // the pills the moment the new enter finishes.
    pills.forEach((pill) => pill.getAnimations().forEach((animation) => animation.cancel()));
    pills.forEach((pill, index) => pill.animate(ENTER, {
      duration: 120,
      easing: 'cubic-bezier(0, 0, 0, 1)',
      delay: (pills.length - 1 - index) * 24,
      fill: 'backwards',
    }));
  }, [open]);

  const close = () => {
    if (!open) return;
    setOpen(false);
    if (reducedMotion() || !stackRef.current) return;
    setClosing(true);
    const pills = [...stackRef.current.querySelectorAll('.tv2-fab-pill')];
    const animations = pills.map((pill, index) => pill.animate(EXIT, {
      duration: 90,
      easing: 'cubic-bezier(0.3, 0, 1, 1)',
      delay: index * 16,
      fill: 'forwards',
    }));
    Promise.allSettled(animations.map((animation) => animation.finished))
      .then(() => setClosing(false));
  };
  // Navigation swaps the whole route; the menu just goes with it.
  const go = (path) => { setOpen(false); setClosing(false); navigate(path); };

  return (
    <>
      {shown && (
        <div
          className="tv2-fab-backdrop"
          style={closing && !open ? { pointerEvents: 'none', opacity: 0, transition: 'opacity 90ms ease' } : undefined}
          onClick={close}
          onTouchMove={(e) => e.preventDefault()}
        />
      )}
      <div className="tv2-fab-stack" ref={stackRef}>
        {shown && (
          <>
            {showPayment && (
              <button type="button" className="tv2-fab-pill" style={PAYMENT_PILL_STYLE} onClick={() => go('/collections/receive-payment')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="2" x2="12" y2="22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                {t('fab.newPayment')}
              </button>
            )}
            <button type="button" className="tv2-fab-pill tv2-fab-pill--job" onClick={() => go('/tech/new-job')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="12" x2="12" y2="18" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
              {t('fab.newJob')}
            </button>
            <button type="button" className="tv2-fab-pill tv2-fab-pill--customer" onClick={() => go('/tech/new-customer')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              {t('fab.newCustomer')}
            </button>
          </>
        )}
        <button type="button" className="tv2-fab" data-open={open ? 'true' : undefined} aria-expanded={open} onClick={() => (open ? close() : setOpen(true))} aria-label={t('createNewAria')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
  );
}
