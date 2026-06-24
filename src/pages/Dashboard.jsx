/**
 * ════════════════════════════════════════════════
 * FILE: Dashboard.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The owner's home screen ("Overview"). It's a grid of cards that summarize
 *   the business at a glance — money coming in, jobs drying out, who's clocked
 *   in, what needs attention. Right now every number is a realistic placeholder
 *   so we can see and approve the design; the real database numbers get wired
 *   in afterward. The header has a date, a color key for the four divisions, a
 *   time-period switch (MTD / Last 30 / QTD / YTD), and an "Edit layout" button.
 *
 * WHERE IT LIVES:
 *   Route:        /  (office/admin/PM/supervisor landing — field techs go to /tech)
 *   Rendered by:  src/App.jsx inside the Layout shell (sidebar + bottom bar)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/overview/Widgets (the 10 cards), @/components/overview/tokens
 *   Data:      reads → none yet (Phase 1 is placeholder data). Live wiring is
 *                      tracked as Phase 2. · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This replaced the old stat-cards + job-tables dashboard wholesale per the
 *     Claude-design "Overview Dashboard" handoff.
 *   - Phase 2 (in progress): the Employee status board is LIVE (get_tech_status_board,
 *     30s poll); the other 9 widgets still render placeholder data.
 *   - Phase 1 = visual only: a STATIC responsive 12-col grid (collapses to 2-col
 *     then 1-col). The ⠿ drag handles are present but inert; drag/resize/reorder
 *     with per-user saved layouts is Phase 3. The period switch updates the card
 *     suffix only — it does not re-query yet (Phase 2).
 *   - Palette is dashboard-scoped (see tokens.js); it intentionally differs from
 *     the app-wide DIVISION_COLORS and introduces "Remodeling" only here.
 * ════════════════════════════════════════════════
 */

import { useState } from 'react';
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

export default function Dashboard() {
  // ─── SECTION: State & hooks ──────────────
  const [period, setPeriod] = useState(PERIODS[0]);
  const showHandles = true; // Phase 1: always shown (decorative until Phase 3 drag lands)
  const periodLabel = `· ${period}`;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // Phase 2 live-data hooks (one per widget). Jobs completed stays placeholder
  // (no completion signal in the data yet). Open estimates / Active drying are
  // wired but currently empty (estimates + Hydro not in use).
  const emp = useEmployeeStatus();
  const coll = useCollections();
  const claims = useNewClaims(period);
  const rev = useRevenue(period);
  const avg = useAvgTicket(period);
  const est = useOpenEstimates();
  const pipeline = usePipeline();
  const drying = useActiveDrying();
  const actions = useActionItems();

  // ─── SECTION: Event handlers ──────────────
  const handleEditLayout = () => {
    window.dispatchEvent(new CustomEvent('upr:toast', {
      detail: {
        message: 'Drag, resize & reorder is coming soon — your layout will save per user.',
        type: 'success',
      },
    }));
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

          <button type="button" className="ovw-editbtn" onClick={handleEditLayout}>
            <span style={{ color: '#98a2b3', fontSize: 14, lineHeight: 1 }} aria-hidden="true">⠿</span>
            Edit layout
          </button>
        </div>
      </header>

      <main className="ovw-grid">
        <RevenueRecognized periodLabel={periodLabel} showHandle={showHandles} data={rev.data ?? undefined} />
        <AvgTicket periodLabel={periodLabel} showHandle={showHandles} data={avg.data ?? undefined} />
        <OpenEstimates showHandle={showHandles} data={est.data ?? undefined} />
        <NewClaimsBooked periodLabel={periodLabel} showHandle={showHandles} data={claims.data ?? undefined} />
        <JobsCompleted periodLabel={periodLabel} showHandle={showHandles} />
        <ActiveDrying showHandle={showHandles} data={drying.data ?? undefined} />
        <Collections showHandle={showHandles} data={coll.data ?? undefined} />
        <ActionRequired showHandle={showHandles} data={actions.data?.items ?? undefined} summary={actions.data?.summary ?? undefined} />
        <EmployeeStatus data={emp.data ?? undefined} summary={emp.summary ?? undefined} showHandle={showHandles} />
        <ProductionPipeline showHandle={showHandles} data={pipeline.data ?? undefined} />
      </main>

      <div style={{ marginTop: 20, fontSize: 11.5, color: '#a4abb6', textAlign: 'center', lineHeight: 1.6 }}>
        Placeholder data — realistic mock values for a ~$1.2M/yr shop. Live Supabase / QBO data wires in next;
        cards will become drag-, resize- &amp; reorderable with per-user saved layouts.
      </div>
    </div>
  );
}
