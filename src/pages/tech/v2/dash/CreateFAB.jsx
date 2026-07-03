/**
 * ════════════════════════════════════════════════
 * FILE: CreateFAB.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The floating "+" button in the bottom-right of the dashboard. Tapping it
 *   opens two choices — start a New Job or a New Customer — and tapping either
 *   takes the tech to that create screen. Tapping the dimmed backdrop closes it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (floating control)
 *   Rendered by:  src/pages/tech/v2/TechDashV2.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  index.css (.tv2-fab*)
 *   Data:      none
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function CreateFAB() {
  const { t } = useTranslation('dash');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div
          className="tv2-fab-backdrop"
          onClick={() => setOpen(false)}
          onTouchMove={(e) => e.preventDefault()}
        />
      )}
      <div className="tv2-fab-stack">
        {open && (
          <>
            <button type="button" className="tv2-fab-pill tv2-fab-pill--job" onClick={() => { setOpen(false); navigate('/tech/new-job'); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="12" x2="12" y2="18" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
              {t('fab.newJob')}
            </button>
            <button type="button" className="tv2-fab-pill tv2-fab-pill--customer" onClick={() => { setOpen(false); navigate('/tech/new-customer'); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              {t('fab.newCustomer')}
            </button>
          </>
        )}
        <button type="button" className="tv2-fab" data-open={open ? 'true' : undefined} onClick={() => setOpen((v) => !v)} aria-label={t('createNewAria')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
  );
}
