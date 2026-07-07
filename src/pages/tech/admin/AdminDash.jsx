/**
 * ════════════════════════════════════════════════
 * FILE: AdminDash.jsx  (Admin Mobile — Dashboard)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The admin dashboard screen inside the field-tech app — the office "Overview"
 *   page, rebuilt as one tall, single-column, phone-friendly stack of cards.
 *   It shows the business at a glance: money in (revenue, payments, average ticket,
 *   accounts receivable), work sold and finished, open estimates, jobs drying,
 *   paperwork that needs attention, who is clocked in, and the production pipeline.
 *   A time-period switch at the top (This month / Last 30 / This quarter / This
 *   year) re-scopes the money and sales cards. The money cards only appear for an
 *   admin who is allowed to see financial data.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/dash  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (canAccess), @/components/admin-mobile
 *              (AdminMobilePage, PeriodSwitch), ./dash/dashPlan (the F-2 gate),
 *              ./dash card components
 *   Data:      reads → the 11 Overview widget RPCs, each card fetching its own
 *              (see dashPlan.js) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - FINANCIAL GATE (finding F-2, the binding P1 risk): the four money cards'
 *     RPCs are NOT server-gated. `visibleDashWidgets(canFin)` from dashPlan.js is
 *     the single source that drops those cards when canAccess('overview_financials')
 *     is false — a dropped card is never mounted, so it is neither rendered NOR
 *     fetched (mirrors the desktop `enabled=false` pattern). The committed test
 *     (dash/dashPlan.test.js) pins this both ways.
 *   - Fixed card order, no drag/resize on mobile (order lives in dashPlan.js).
 *   - Deep-links go through Foundation's frozen href helper (via the cards); job
 *     rows have no admin-mobile destination this wave and stay read-only.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AdminMobilePage, PeriodSwitch } from '@/components/admin-mobile';
import { visibleDashWidgets } from '@/components/admin-mobile/dash/dashPlan';
import {
  RevenueCard, PaymentsCard, AvgTicketCard, CollectionsCard,
} from '@/components/admin-mobile/dash/FinancialCards';
import {
  JobsClosedCard, JobsCompletedCard, OpenEstimatesCard,
} from '@/components/admin-mobile/dash/WorkCards';
import {
  ActiveDryingCard, ActionRequiredCard, EmployeeStatusCard, PipelineCard,
} from '@/components/admin-mobile/dash/OpsCards';

// Card key → component. Period-scoped cards take the `period`; the rest ignore it.
const CARD = {
  revenue:        (p) => <RevenueCard period={p} />,
  payments:       (p) => <PaymentsCard period={p} />,
  avgTicket:      (p) => <AvgTicketCard period={p} />,
  collections:    () => <CollectionsCard />,
  jobsClosed:     (p) => <JobsClosedCard period={p} />,
  jobsCompleted:  (p) => <JobsCompletedCard period={p} />,
  openEstimates:  () => <OpenEstimatesCard />,
  activeDrying:   () => <ActiveDryingCard />,
  actionRequired: () => <ActionRequiredCard />,
  employeeStatus: () => <EmployeeStatusCard />,
  pipeline:       () => <PipelineCard />,
};

export default function AdminDash() {
  const { canAccess } = useAuth();
  // Money-card visibility is its own permission (mirrors the desktop Dashboard).
  // Non-privileged admins never mount the financial cards → no render, no fetch.
  const canFin = canAccess('overview_financials');
  const [period, setPeriod] = useState('mtd');

  const widgets = visibleDashWidgets(canFin);

  return (
    <AdminMobilePage title="Admin Dashboard" subtitle="Field admin overview">
      <div className="am-dash-controls">
        <PeriodSwitch value={period} onChange={setPeriod} />
      </div>

      <div className="am-dash-grid">
        {widgets.map((w) => (
          <div key={w.key} className="am-dash-slot">
            {CARD[w.key](period)}
          </div>
        ))}
      </div>
    </AdminMobilePage>
  );
}
