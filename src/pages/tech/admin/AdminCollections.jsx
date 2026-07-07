/**
 * ════════════════════════════════════════════════
 * FILE: AdminCollections.jsx  (Admin Mobile — Collections / AR)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The collections / accounts-receivable screen inside the field-tech app. It has
 *   up to four tabs — AR aging, Invoices, Estimates, and the Payments ledger — each
 *   a mobile-friendly list drawn from the same data the office "My Money" page
 *   uses. A time-period switch (this month / last 30 / this quarter / this year)
 *   sits on the AR and Invoices tabs. Tapping any row opens that invoice or
 *   estimate's detail screen.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/collections  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (canAccess), @/components/admin-mobile
 *              (AdminMobilePage, AmTabs, PeriodSwitch), ./collections tab components
 *   Data:      reads → get_ar_invoices, get_estimates, get_payments_ledger,
 *              get_payments_received (each tab fetches its own) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - FINANCIAL GATE (finding F-2): the AR aging and Payments ledger tabs expose
 *     revenue/AR the desktop hides behind canAccess('overview_financials'); the
 *     underlying RPCs are NOT server-gated. So when that permission is absent those
 *     two tabs are removed from the tab bar entirely — they are never rendered and
 *     their RPCs are never fetched (the tab components only mount when active). The
 *     document-oriented Invoices and Estimates tabs stay available to any admin.
 *   - Deep-links go through Foundation's href helper (via the row-view builders),
 *     never hardcoded paths. Invoice/Estimate detail land once P3/P4a merge — until
 *     then rows resolve to F's stub pages (verification tail, disclosed in the PR).
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AdminMobilePage, AmTabs, PeriodSwitch } from '@/components/admin-mobile';
import { visibleCollectionsTabs, PERIOD_TABS } from '@/components/admin-mobile/collections/collFormat';
import ArAgingTab from '@/components/admin-mobile/collections/ArAgingTab';
import InvoicesTab from '@/components/admin-mobile/collections/InvoicesTab';
import EstimatesTab from '@/components/admin-mobile/collections/EstimatesTab';
import PaymentsTab from '@/components/admin-mobile/collections/PaymentsTab';

const PERIOD_TAB_SET = new Set(PERIOD_TABS);

export default function AdminCollections() {
  const { canAccess } = useAuth();
  const canFin = canAccess('overview_financials');

  // Drop the financial tabs entirely when the permission is absent — this is what
  // makes the gate skip both render AND fetch (a gated tab never mounts). The
  // decision is the pure, unit-tested visibleCollectionsTabs(canFin) (finding F-2).
  const tabs = visibleCollectionsTabs(canFin);
  const [tab, setTab] = useState(tabs[0].value);
  const [period, setPeriod] = useState('mtd');

  // Guard against a stale tab value (e.g. permission changed): fall back to the first.
  const active = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <AdminMobilePage title="Collections" subtitle="Accounts receivable">
      <div className="am-coll-controls">
        <AmTabs tabs={tabs} value={active} onChange={setTab} />
        {PERIOD_TAB_SET.has(active) && <PeriodSwitch value={period} onChange={setPeriod} />}
      </div>

      {active === 'ar' && canFin && <ArAgingTab period={period} />}
      {active === 'invoices' && <InvoicesTab period={period} />}
      {active === 'estimates' && <EstimatesTab />}
      {active === 'payments' && canFin && <PaymentsTab />}
    </AdminMobilePage>
  );
}
