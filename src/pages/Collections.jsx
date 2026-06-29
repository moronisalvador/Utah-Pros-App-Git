/**
 * ════════════════════════════════════════════════
 * FILE: Collections.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "My Money" page — the office's accounts-receivable workspace. It's one
 *   screen with four tabs: A/R · Outstanding (what customers still owe + aging),
 *   Invoices (every invoice), Estimates (pre-sale quotes), and Payments (cash
 *   that has come in). The top has the page title, a "Payment settings" link and
 *   a "+ New invoice / estimate" button, the four tabs, and — on the A/R and
 *   Invoices tabs — a time-period switch (All / MTD / Last 30 / QTD / YTD).
 *
 * WHERE IT LIVES:
 *   Route:        /collections  (the "My Money" nav item; feature-flagged page:collections)
 *   Rendered by:  src/App.jsx inside the Layout shell
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/collections/{collKit, ARDashboard, InvoicesList,
 *              EstimatesList, PaymentsLedger}, NewInvoiceModal, NewEstimateModal,
 *              @/lib/claimUtils (canEditBilling), @/contexts/AuthContext
 *   Data:      reads → none directly (each tab fetches its own RPC)
 *              writes → none (the New-invoice / New-estimate modals create)
 *
 * NOTES / GOTCHAS:
 *   - Visual language is the UPR design system, scoped via `.coll-*` classes in
 *     index.css + the collKit palette. It is intentionally separate from the
 *     app-wide tokens (same approach as the Overview dashboard).
 *   - Period state lives here so the switch can sit in the tab row, but it is
 *     handed down only to the two period-aware tabs. A/R defaults to MTD,
 *     Invoices to All (matching the design); Estimates/Payments have no period.
 *   - "+ New invoice" requires canEditBilling AND the feature:billing flag (same
 *     gate as before); "+ New estimate" requires canEditBilling.
 * ════════════════════════════════════════════════
 */

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { canEditBilling } from '@/lib/claimUtils';
import { PERIODS } from '@/components/collections/collTokens';
import { SegControl, GhostButton, PrimaryButton } from '@/components/collections/collKit';
import ARDashboard from '@/components/collections/ARDashboard';
import InvoicesList from '@/components/collections/InvoicesList';
import EstimatesList from '@/components/collections/EstimatesList';
import PaymentsLedger from '@/components/collections/PaymentsLedger';
import NewInvoiceModal from '@/components/NewInvoiceModal';
import NewEstimateModal from '@/components/NewEstimateModal';
import usePageTransition from '@/hooks/usePageTransition';

const TABS = [
  { value: 'ar', label: 'A/R · Outstanding' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'estimates', label: 'Estimates' },
  { value: 'payments', label: 'Payments' },
];

export default function Collections() {
  // ─── SECTION: State & hooks ──────────────
  const { db, employee, isFeatureEnabled } = useAuth();
  const navigate = useNavigate();
  const slide = usePageTransition();
  // Initial tab can be deep-linked via ?tab= (e.g. the dashboard "Open estimates"
  // widget → /collections?tab=estimates); falls back to A/R. Tab clicks sync back to
  // ?tab= (replace) so the browser Back button returns you to the tab you were on.
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const t = params.get('tab');
    return TABS.some((o) => o.value === t) ? t : 'ar';
  });
  const changeTab = (t) => {
    setTab(t);
    setParams((prev) => { const p = new URLSearchParams(prev); p.set('tab', t); return p; }, { replace: true });
  };
  const [arPeriod, setArPeriod] = useState('All');
  const [invPeriod, setInvPeriod] = useState('All');
  const [estPeriod, setEstPeriod] = useState('All');
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [showNewEstimate, setShowNewEstimate] = useState(false);

  const canEdit = canEditBilling(employee?.role);
  const billingOn = isFeatureEnabled('feature:billing');
  const onEstimates = tab === 'estimates';

  // Warm the detail-page chunks on idle so the first row click slides straight in instead
  // of flashing the lazy-chunk loader. Same specifiers App.jsx lazy-loads, so the browser
  // cache is shared; the per-page skeleton then covers the remaining data fetch.
  useEffect(() => {
    const warm = () => {
      import('@/pages/InvoiceEditor');
      import('@/pages/EstimateEditor');
      import('@/pages/ClaimCollectionPage');
    };
    const ric = window.requestIdleCallback;
    const id = ric ? ric(warm) : window.setTimeout(warm, 400);
    return () => { if (ric) window.cancelIdleCallback(id); else window.clearTimeout(id); };
  }, []);

  // ─── SECTION: Render ──────────────
  return (
    <div className={`coll-page ${slide}`}>
      <header className="coll-header">
        <div>
          <h1 className="coll-title">Collections</h1>
          <div className="coll-subtitle">Accounts receivable · Utah Pros Restoration</div>
        </div>
        <div className="coll-actions">
          {canEdit && (
            <GhostButton leftIcon={<span style={{ color: '#98a2b3' }} aria-hidden="true">⚙</span>} onClick={() => navigate('/payments/settings')}>
              Payment settings
            </GhostButton>
          )}
          {canEdit && onEstimates && (
            <PrimaryButton onClick={() => setShowNewEstimate(true)}>+ New estimate</PrimaryButton>
          )}
          {canEdit && !onEstimates && billingOn && (
            <PrimaryButton onClick={() => setShowNewInvoice(true)}>+ New invoice</PrimaryButton>
          )}
        </div>
      </header>

      <div className="coll-tabrow">
        <SegControl options={TABS} value={tab} onChange={changeTab} size="lg" ariaLabel="Collections section" />
        {tab === 'ar' && (
          <SegControl options={PERIODS} value={arPeriod} onChange={setArPeriod} size="sm" ariaLabel="Time period" />
        )}
        {tab === 'invoices' && (
          <SegControl options={PERIODS} value={invPeriod} onChange={setInvPeriod} size="sm" ariaLabel="Time period" />
        )}
        {tab === 'estimates' && (
          <SegControl options={PERIODS} value={estPeriod} onChange={setEstPeriod} size="sm" ariaLabel="Time period" />
        )}
      </div>

      {tab === 'ar'        && <ARDashboard db={db} navigate={navigate} period={arPeriod} modalOpen={showNewInvoice || showNewEstimate} />}
      {tab === 'invoices'  && <InvoicesList db={db} navigate={navigate} period={invPeriod} />}
      {tab === 'estimates' && <EstimatesList db={db} navigate={navigate} period={estPeriod} />}
      {tab === 'payments'  && <PaymentsLedger db={db} navigate={navigate} />}

      {showNewInvoice && <NewInvoiceModal db={db} onClose={() => setShowNewInvoice(false)} />}
      {showNewEstimate && <NewEstimateModal db={db} onClose={() => setShowNewEstimate(false)} />}
    </div>
  );
}
