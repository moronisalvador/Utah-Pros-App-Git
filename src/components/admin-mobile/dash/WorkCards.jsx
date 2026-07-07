/**
 * ════════════════════════════════════════════════
 * FILE: WorkCards.jsx  (admin-mobile Dashboard — sales & estimate cards)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Three non-money cards on the mobile admin dashboard: New jobs closed (how many
 *   jobs were actually sold this period, with a 30-day trend line), Jobs completed
 *   (how many finished this period vs last month), and Open estimates (a donut of
 *   quotes still awaiting a decision, split by division). Each loads its own data
 *   from the database and draws its own simple SVG / CSS chart — no chart library.
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/admin/dash
 *   Rendered by:  src/pages/tech/admin/AdminDash.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./useDashWidget, ./DashCard, ./dashFormat, ../href (adminCollectionsHref)
 *   Data:      reads → get_jobs_closed, get_jobs_completed, get_open_estimates_summary
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These cards are visible to any admin (not financial) — see dashPlan.js.
 *   - New jobs closed / Jobs completed are period-scoped (their loader is keyed on
 *     `period`); Open estimates is a live snapshot with no period.
 *   - "Sold" counts real jobs only (jobs.is_real_job) dated by the claim's created
 *     date — that rule lives in the get_jobs_closed RPC; we only count its rows.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useDashWidget } from './useDashWidget';
import { DashCard, DeltaPill, DashFootLink, DashEmpty } from './DashCard';
import {
  periodBoundsISO, periodLabel,
  shapeJobsClosed, jobsClosedFloorISO, shapeOpenEstimates, donutGradient,
} from './dashFormat';
import { adminCollectionsHref } from '../href';

// ─── SECTION: New jobs closed (period count + 30-day sparkline) ──────────────
export function JobsClosedCard({ period }) {
  const loader = useCallback(
    (db) => db.rpc('get_jobs_closed', { p_floor: jobsClosedFloorISO() }).then((rows) => shapeJobsClosed(rows, period)),
    [period],
  );
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard
      title="New jobs closed"
      suffix={`· ${periodLabel(period)}`}
      right={data?.delta ? <DeltaPill {...data.delta} /> : null}
      loading={loading}
      error={error}
      onRetry={reload}
    >
      {data && (
        <div className="am-dash-jobsclosed">
          <div className="am-dash-jobsclosed-num">
            <div className="am-dash-metric">{data.count}</div>
            <div className="am-dash-note">jobs sold {periodLabel(period)}</div>
          </div>
          <div className="am-dash-spark">
            <div className="am-dash-spark-cap">Trailing 30 days</div>
            <svg viewBox="0 0 240 58" preserveAspectRatio="none" className="am-dash-spark-svg" aria-hidden="true">
              <polygon points={data.area} className="am-dash-spark-area" />
              <polyline points={data.line} className="am-dash-spark-line" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        </div>
      )}
    </DashCard>
  );
}

// ─── SECTION: Jobs completed ──────────────
export function JobsCompletedCard({ period }) {
  const loader = useCallback(
    (db) => db.rpc('get_jobs_completed', periodBoundsISO(period)).then((r) => ({
      count: Number(r?.count) || 0,
      lastMonth: Number(r?.last_month) || 0,
    })),
    [period],
  );
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard title="Jobs completed" suffix={`· ${periodLabel(period)}`} loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="am-dash-jobsdone">
          <div>
            <div className="am-dash-metric">{data.count}</div>
            <div className="am-dash-note">jobs completed</div>
          </div>
          <div className="am-dash-jobsdone-note">
            Restoration jobs run days to weeks — a low monthly count is expected.
            <span> {data.lastMonth} completed last month.</span>
          </div>
        </div>
      )}
    </DashCard>
  );
}

// ─── SECTION: Open estimates (donut) ──────────────
export function OpenEstimatesCard() {
  const loader = useCallback((db) => db.rpc('get_open_estimates_summary').then(shapeOpenEstimates), []);
  const { data, loading, error, reload } = useDashWidget(loader);
  const gradient = data ? donutGradient(data.slices) : null;
  return (
    <DashCard
      title="Open estimates"
      loading={loading}
      error={error}
      onRetry={reload}
      footer={<DashFootLink to={adminCollectionsHref()}>View estimates</DashFootLink>}
    >
      {data && (
        <div className="am-dash-donut-row">
          <div className="am-dash-donut" style={gradient ? { background: gradient } : undefined}>
            <div className="am-dash-donut-hole">
              <span className="am-dash-donut-num">{data.total}</span>
              <span className="am-dash-donut-cap">OPEN</span>
            </div>
          </div>
          <div className="am-dash-donut-legend">
            {data.slices.length > 0 ? (
              data.slices.map((s) => (
                <div key={s.key} className="am-dash-donut-item">
                  <span className="am-dash-dot" style={{ background: s.color }} aria-hidden="true" />
                  <div className="am-dash-donut-item-txt">
                    <div className="am-dash-donut-item-label">{s.label} · {s.count}</div>
                    <div className="am-dash-donut-item-sub">{s.sub}</div>
                  </div>
                  <span className="am-dash-donut-item-val">{s.valueLabel}</span>
                </div>
              ))
            ) : (
              <DashEmpty>No open estimates right now.</DashEmpty>
            )}
            {data.total > 0 && (
              <div className="am-dash-donut-total">{data.total} open · <b>{data.totalValue}</b></div>
            )}
          </div>
        </div>
      )}
    </DashCard>
  );
}
