/**
 * ════════════════════════════════════════════════
 * FILE: Dashboard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The owner's home screen ("Overview"). It's a grid of cards summarizing the
 *   business — money in, jobs drying, who's clocked in, what needs attention.
 *   Each card pulls live data from the database, shows a shimmer while it loads,
 *   and a "Retry" if it fails. Many rows are tappable and jump to that job. The
 *   header has the date, a division color key, a time-period switch (MTD / Last
 *   30 / QTD / YTD), and an "Edit layout" button. In edit mode the owner can drag
 *   cards by their ⠿ handle, resize from the corner, and reorder — saved per user.
 *   Money cards (revenue, avg ticket, collections) only show to billing-privileged
 *   roles; everyone else sees a "Restricted" placeholder in that slot.
 *
 * WHERE IT LIVES:
 *   Route:        /  (office/admin/PM/supervisor landing — field techs go to /tech)
 *   Rendered by:  src/App.jsx inside the Layout shell (sidebar + bottom bar)
 *
 * DEPENDS ON:
 *   Packages:  react, react-grid-layout
 *   Internal:  @/components/overview/Widgets (the 10 cards) + its hooks + tokens,
 *              @/components/overview/WidgetBoundary (per-card crash isolation),
 *              @/contexts/AuthContext (role + feature flag), @/lib/claimUtils
 *   Data:      reads → per-widget RPCs (see each hook) + get_dashboard_layout
 *              writes → save_dashboard_layout (the user's card arrangement)
 *
 * NOTES / GOTCHAS:
 *   - Layout is react-grid-layout (responsive: 12-col ≥996px, 1-col below). The
 *     default layout below is the seed; a saved per-user layout overrides it.
 *   - Cards have fixed heights in the grid (rowHeight × h). Defaults are tuned to
 *     fit content; the owner resizes to taste. Charts/lists fill their card.
 *   - ⠿ drag handles + the resize corner only appear in edit mode. Row deep-links
 *     are disabled in edit mode so clicking to navigate can't fight dragging.
 *   - The `page:overview` flag is a kill-switch handled as CONTENT here (a
 *     placeholder), NOT a FeatureRoute redirect — the dashboard IS the home route,
 *     so redirecting to "/" would infinite-loop. isFeatureEnabled returns true
 *     when the flag is missing/enabled, so this only hides on an explicit disable.
 *   - Financial widgets are gated by canEditBilling AND their hooks are passed
 *     enabled=false for non-privileged roles, so those RPCs aren't even fetched.
 * ════════════════════════════════════════════════
 */

import { useState } from 'react';
// v2 ships the classic v1-compatible API (WidthProvider/Responsive + draggableHandle) under /legacy
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { useAuth } from '@/contexts/AuthContext';
import { canEditBilling } from '@/lib/claimUtils';
import { DIVISIONS, PERIODS } from '@/components/overview/tokens';
import {
  RevenueRecognized, AvgTicket, OpenEstimates,
  NewClaimsBooked, JobsCompleted,
  ActiveDrying, Collections,
  ActionRequired, EmployeeStatus,
  ProductionPipeline, RestrictedCard,
} from '@/components/overview/Widgets';
import { WidgetBoundary } from '@/components/overview/WidgetBoundary';
import { useEmployeeStatus } from '@/components/overview/hooks/useEmployeeStatus';
import { useCollections } from '@/components/overview/hooks/useCollections';
import { useNewClaims } from '@/components/overview/hooks/useNewClaims';
import { useRevenue } from '@/components/overview/hooks/useRevenue';
import { useAvgTicket } from '@/components/overview/hooks/useAvgTicket';
import { useOpenEstimates } from '@/components/overview/hooks/useOpenEstimates';
import { usePipeline } from '@/components/overview/hooks/usePipeline';
import { useActiveDrying } from '@/components/overview/hooks/useActiveDrying';
import { useActionItems } from '@/components/overview/hooks/useActionItems';
import { useJobsCompleted } from '@/components/overview/hooks/useJobsCompleted';
import { useDashboardLayout } from '@/components/overview/hooks/useDashboardLayout';

const ResponsiveGridLayout = WidthProvider(Responsive);

// ─── SECTION: Default layout (seed; per-user saved layout overrides it) ──────────────
// [x, y, w, h] on the 12-col large grid. h × rowHeight(70) + gaps = card height.
const ORDER = ['revenue', 'avgTicket', 'openEstimates', 'newClaims', 'jobsCompleted',
  'activeDrying', 'collections', 'actionRequired', 'employeeStatus', 'pipeline'];
const LG = {
  revenue: [0, 0, 4, 3], avgTicket: [4, 0, 4, 3], openEstimates: [8, 0, 4, 3],
  newClaims: [0, 3, 6, 2], jobsCompleted: [6, 3, 6, 2],
  activeDrying: [0, 5, 7, 4], collections: [7, 5, 5, 4],
  actionRequired: [0, 9, 6, 5], employeeStatus: [6, 9, 6, 4],
  pipeline: [0, 14, 12, 4],
};
const lgLayout = ORDER.map(i => ({ i, x: LG[i][0], y: LG[i][1], w: LG[i][2], h: LG[i][3], minW: 3, minH: 2 }));
const xsLayout = (() => {
  let y = 0;
  return ORDER.map(i => { const h = LG[i][3]; const it = { i, x: 0, y, w: 1, h, minW: 1, minH: 2 }; y += h; return it; });
})();
const DEFAULT_LAYOUTS = { lg: lgLayout, xs: xsLayout };

export default function Dashboard() {
  // ─── SECTION: State & hooks ──────────────
  const { employee, isFeatureEnabled } = useAuth();
  const canFin = canEditBilling(employee?.role); // who may see company money (admin/manager)
  const overviewOn = isFeatureEnabled('page:overview'); // kill-switch (content-gated below)

  const [period, setPeriod] = useState(PERIODS[0]);
  const [editing, setEditing] = useState(false);
  const periodLabel = `· ${period}`;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // Financial hooks take `canFin` as their `enabled` flag — non-privileged roles
  // never even fetch revenue/collections (not just hidden in the UI).
  const emp = useEmployeeStatus();
  const coll = useCollections(canFin);
  const claims = useNewClaims(period);
  const rev = useRevenue(period, canFin);
  const avg = useAvgTicket(period, canFin);
  const est = useOpenEstimates();
  const pipeline = usePipeline();
  const drying = useActiveDrying();
  const actions = useActionItems();
  const jobs = useJobsCompleted(period);
  const { layouts, persist, reset } = useDashboardLayout(DEFAULT_LAYOUTS);

  // ─── SECTION: Kill-switch (content-gated — see header note on the home-route loop) ──────────────
  if (!overviewOn) {
    return (
      <div className="ovw-page">
        <header className="ovw-header">
          <div>
            <h1 className="ovw-title">Overview</h1>
            <div className="ovw-subtitle">Utah Pros Restoration · {today}</div>
          </div>
        </header>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', gap: 10, textAlign: 'center', color: '#98a2b3' }}>
          <span style={{ fontSize: 26 }} aria-hidden="true">🛠️</span>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#475467' }}>Overview is temporarily turned off</div>
          <div style={{ fontSize: 13 }}>The dashboard is being updated. Use the sidebar to get where you need to go.</div>
        </div>
      </div>
    );
  }

  // ─── SECTION: Widgets (keyed by layout id) ──────────────
  const widgets = {
    revenue: canFin
      ? <RevenueRecognized periodLabel={periodLabel} showHandle={editing} data={rev.data ?? undefined} loading={rev.loading} error={rev.error} onRetry={rev.reload} />
      : <RestrictedCard spanClass="ovw-span-4" title="Revenue recognized" showHandle={editing} />,
    avgTicket: canFin
      ? <AvgTicket periodLabel={periodLabel} showHandle={editing} data={avg.data ?? undefined} loading={avg.loading} error={avg.error} onRetry={avg.reload} />
      : <RestrictedCard spanClass="ovw-span-4" title="Avg ticket" showHandle={editing} />,
    openEstimates:  <OpenEstimates showHandle={editing} data={est.data ?? undefined} loading={est.loading} error={est.error} onRetry={est.reload} />,
    newClaims:      <NewClaimsBooked periodLabel={periodLabel} showHandle={editing} data={claims.data ?? undefined} loading={claims.loading} error={claims.error} onRetry={claims.reload} />,
    jobsCompleted:  <JobsCompleted periodLabel={periodLabel} showHandle={editing} data={jobs.data ?? undefined} loading={jobs.loading} error={jobs.error} onRetry={jobs.reload} />,
    activeDrying:   <ActiveDrying showHandle={editing} data={drying.data ?? undefined} loading={drying.loading} error={drying.error} onRetry={drying.reload} />,
    collections: canFin
      ? <Collections showHandle={editing} data={coll.data ?? undefined} loading={coll.loading} error={coll.error} onRetry={coll.reload} />
      : <RestrictedCard spanClass="ovw-span-5" title="Collections" showHandle={editing} />,
    actionRequired: <ActionRequired showHandle={editing} data={actions.data?.items ?? undefined} summary={actions.data?.summary ?? undefined} loading={actions.loading} error={actions.error} onRetry={actions.reload} />,
    employeeStatus: <EmployeeStatus showHandle={editing} data={emp.data ?? undefined} summary={emp.summary ?? undefined} loading={emp.loading} error={emp.error} onRetry={emp.reload} />,
    pipeline:       <ProductionPipeline showHandle={editing} data={pipeline.data ?? undefined} loading={pipeline.loading} error={pipeline.error} onRetry={pipeline.reload} />,
  };

  // ─── SECTION: Render ──────────────
  return (
    <div className="ovw-page">
      <header className="ovw-header">
        <div>
          <h1 className="ovw-title">Overview</h1>
          <div className="ovw-subtitle">Utah Pros Restoration · {today}</div>
        </div>

        <div className="ovw-header-right">
          <div className="ovw-legend">
            {DIVISIONS.map(d => (
              <span key={d.key} className="ovw-legend-item">
                <span className="ovw-legend-sw" style={{ background: d.color }} />
                {d.label}
              </span>
            ))}
          </div>

          <div className="ovw-seg" role="tablist" aria-label="Time period">
            {PERIODS.map(p => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                className={`ovw-seg-btn${period === p ? ' active' : ''}`}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {editing && (
            <button type="button" className="ovw-editbtn" onClick={reset}>Reset</button>
          )}
          <button type="button" className="ovw-editbtn" onClick={() => setEditing(e => !e)}>
            <span style={{ color: '#98a2b3', fontSize: 14, lineHeight: 1 }} aria-hidden="true">⠿</span>
            {editing ? 'Done' : 'Edit layout'}
          </button>
        </div>
      </header>

      <ResponsiveGridLayout
        className={`ovw-grid-rgl${editing ? ' ovw-editing' : ''}`}
        layouts={layouts}
        breakpoints={{ lg: 996, xs: 0 }}
        cols={{ lg: 12, xs: 1 }}
        rowHeight={70}
        margin={[16, 16]}
        containerPadding={[0, 0]}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".ovw-handle"
        resizeHandles={['se']}
        onLayoutChange={(_, all) => { if (editing) persist(all); }}
      >
        {ORDER.map(id => (
          <div key={id} className="ovw-rgl-item">
            <WidgetBoundary>{widgets[id]}</WidgetBoundary>
          </div>
        ))}
      </ResponsiveGridLayout>

      <div style={{ marginTop: 20, fontSize: 11.5, color: '#a4abb6', textAlign: 'center', lineHeight: 1.6 }}>
        {editing
          ? 'Drag a card by its ⠿ handle, resize from the bottom-right corner, then hit Done. Your layout saves automatically.'
          : 'Live data from Supabase / QuickBooks. Tap "Edit layout" to rearrange — your layout is saved just for you.'}
      </div>
    </div>
  );
}
