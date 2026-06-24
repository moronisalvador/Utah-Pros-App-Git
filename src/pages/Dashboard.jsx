/**
 * ════════════════════════════════════════════════
 * FILE: Dashboard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The owner's home screen ("Overview"). It's a grid of cards summarizing the
 *   business — money in, jobs drying, who's clocked in, what needs attention.
 *   Each card pulls live data from the database. The header has the date, a
 *   color key for the divisions, a time-period switch (MTD / Last 30 / QTD /
 *   YTD), and an "Edit layout" button. In edit mode the owner can drag cards by
 *   their ⠿ handle, resize them from the corner, and reorder them — and that
 *   arrangement is saved just for them.
 *
 * WHERE IT LIVES:
 *   Route:        /  (office/admin/PM/supervisor landing — field techs go to /tech)
 *   Rendered by:  src/App.jsx inside the Layout shell (sidebar + bottom bar)
 *
 * DEPENDS ON:
 *   Packages:  react, react-grid-layout
 *   Internal:  @/components/overview/Widgets (the 10 cards) + its hooks + tokens
 *   Data:      reads → per-widget RPCs (see each hook) + get_dashboard_layout
 *              writes → save_dashboard_layout (the user's card arrangement)
 *
 * NOTES / GOTCHAS:
 *   - Layout is react-grid-layout (responsive: 12-col ≥996px, 1-col below). The
 *     default layout below is the seed; a saved per-user layout overrides it.
 *   - Cards have fixed heights in the grid (rowHeight × h). Defaults are tuned to
 *     fit content; the owner resizes to taste. Charts/lists fill their card.
 *   - ⠿ drag handles + the resize corner only appear in edit mode.
 * ════════════════════════════════════════════════
 */

import { useState } from 'react';
// v2 ships the classic v1-compatible API (WidthProvider/Responsive + draggableHandle) under /legacy
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { DIVISIONS, PERIODS } from '@/components/overview/tokens';
import {
  RevenueRecognized, AvgTicket, OpenEstimates,
  NewClaimsBooked, JobsCompleted,
  ActiveDrying, Collections,
  ActionRequired, EmployeeStatus,
  ProductionPipeline,
} from '@/components/overview/Widgets';
import { useEmployeeStatus } from '@/components/overview/hooks/useEmployeeStatus';
import { useCollections } from '@/components/overview/hooks/useCollections';
import { useNewClaims } from '@/components/overview/hooks/useNewClaims';
import { useRevenue } from '@/components/overview/hooks/useRevenue';
import { useAvgTicket } from '@/components/overview/hooks/useAvgTicket';
import { useOpenEstimates } from '@/components/overview/hooks/useOpenEstimates';
import { usePipeline } from '@/components/overview/hooks/usePipeline';
import { useActiveDrying } from '@/components/overview/hooks/useActiveDrying';
import { useActionItems } from '@/components/overview/hooks/useActionItems';
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
  const [period, setPeriod] = useState(PERIODS[0]);
  const [editing, setEditing] = useState(false);
  const periodLabel = `· ${period}`;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const emp = useEmployeeStatus();
  const coll = useCollections();
  const claims = useNewClaims(period);
  const rev = useRevenue(period);
  const avg = useAvgTicket(period);
  const est = useOpenEstimates();
  const pipeline = usePipeline();
  const drying = useActiveDrying();
  const actions = useActionItems();
  const { layouts, persist, reset } = useDashboardLayout(DEFAULT_LAYOUTS);

  // ─── SECTION: Widgets (keyed by layout id) ──────────────
  const widgets = {
    revenue:        <RevenueRecognized periodLabel={periodLabel} showHandle={editing} data={rev.data ?? undefined} />,
    avgTicket:      <AvgTicket periodLabel={periodLabel} showHandle={editing} data={avg.data ?? undefined} />,
    openEstimates:  <OpenEstimates showHandle={editing} data={est.data ?? undefined} />,
    newClaims:      <NewClaimsBooked periodLabel={periodLabel} showHandle={editing} data={claims.data ?? undefined} />,
    jobsCompleted:  <JobsCompleted periodLabel={periodLabel} showHandle={editing} />,
    activeDrying:   <ActiveDrying showHandle={editing} data={drying.data ?? undefined} />,
    collections:    <Collections showHandle={editing} data={coll.data ?? undefined} />,
    actionRequired: <ActionRequired showHandle={editing} data={actions.data?.items ?? undefined} summary={actions.data?.summary ?? undefined} />,
    employeeStatus: <EmployeeStatus showHandle={editing} data={emp.data ?? undefined} summary={emp.summary ?? undefined} />,
    pipeline:       <ProductionPipeline showHandle={editing} data={pipeline.data ?? undefined} />,
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
          <div key={id} className="ovw-rgl-item">{widgets[id]}</div>
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
