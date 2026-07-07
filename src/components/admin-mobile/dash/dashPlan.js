/**
 * ════════════════════════════════════════════════
 * FILE: dashPlan.js  (admin-mobile Dashboard — widget order + financial gate)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one place that decides WHICH cards the mobile admin dashboard shows, in
 *   WHAT order, and — most importantly — which cards are "money" cards that a
 *   non-privileged admin is not allowed to see. When a viewer lacks financial
 *   access, the money cards are dropped from this list entirely, so they are
 *   never drawn on screen AND their database calls never run (the card only
 *   fetches once it is on screen). Keeping that decision here, as plain data,
 *   means it can be tested without a browser.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data + decision module)
 *   Rendered by:  n/a — imported by AdminDash.jsx and the F-2 gate test
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - FINANCIAL GATE (finding F-2, the binding P1 risk): the financial widget
 *     RPCs are NOT gated on the server. `visibleDashWidgets(canFin)` is the single
 *     source of truth that skips both the RENDER and the FETCH for a non-privileged
 *     admin — a widget only fetches from inside its own component, and a widget
 *     that isn't in this list is never mounted. `plannedRpcs(false)` therefore
 *     contains NONE of the financial RPCs, which the committed test asserts.
 *   - `canFin` must be STRICTLY true to unlock the money cards (mirrors the
 *     desktop `canAccess('overview_financials')` boolean; any other value denies).
 *   - Order is FIXED (finding: no drag/resize on mobile). Money cards lead, then
 *     the operational cards, matching the office Overview's reading order.
 * ════════════════════════════════════════════════
 */

// The dashboard's fixed card order. `fin: true` marks a financial (gated) card
// whose RPC is not server-protected. `rpcs` lists every RPC that card fetches —
// used by plannedRpcs() so the fetch set provably tracks the gate.
export const DASH_WIDGETS = [
  { key: 'revenue',        fin: true,  title: 'Revenue recognized', rpcs: ['get_revenue_by_division'] },
  { key: 'payments',       fin: true,  title: 'Payments received',  rpcs: ['get_payments_received'] },
  { key: 'avgTicket',      fin: true,  title: 'Avg ticket',         rpcs: ['get_avg_ticket'] },
  { key: 'collections',    fin: true,  title: 'Collections',        rpcs: ['get_ar_invoices'] },
  { key: 'jobsClosed',     fin: false, title: 'New jobs closed',    rpcs: ['get_jobs_closed'] },
  { key: 'jobsCompleted',  fin: false, title: 'Jobs completed',     rpcs: ['get_jobs_completed'] },
  { key: 'openEstimates',  fin: false, title: 'Open estimates',     rpcs: ['get_open_estimates_summary'] },
  { key: 'activeDrying',   fin: false, title: 'Active drying',      rpcs: ['get_active_drying_jobs'] },
  { key: 'actionRequired', fin: false, title: 'Action required',    rpcs: ['get_dashboard_action_items'] },
  { key: 'employeeStatus', fin: false, title: 'Employee status',    rpcs: ['get_tech_status_board'] },
  { key: 'pipeline',       fin: false, title: 'Production pipeline', rpcs: ['get_pipeline_summary'] },
];

// Every RPC behind a financial card — the exact set that must NOT be fetched for a
// non-privileged admin (finding F-2). Derived from DASH_WIDGETS so the two agree.
export const FINANCIAL_RPCS = DASH_WIDGETS.filter((w) => w.fin).flatMap((w) => w.rpcs);

// The single source of the render+fetch decision. Financial cards are dropped
// unless the viewer has financial access (strictly true).
export function visibleDashWidgets(canFin) {
  return DASH_WIDGETS.filter((w) => canFin === true || !w.fin);
}

// The RPCs the dashboard will actually call for a given gate — the union of the
// visible cards' RPCs. `plannedRpcs(false)` proves no financial RPC is fetched.
export function plannedRpcs(canFin) {
  return visibleDashWidgets(canFin).flatMap((w) => w.rpcs);
}
