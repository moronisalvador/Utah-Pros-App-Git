/**
 * ════════════════════════════════════════════════
 * FILE: FinancialCards.jsx  (admin-mobile Dashboard — the money cards)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The four "money" cards on the mobile admin dashboard: Revenue recognized,
 *   Payments received, Average ticket, and Collections (accounts receivable). Each
 *   loads its own numbers from the database, draws a small chart made of plain
 *   coloured bars / a donut (no chart library), and links through to the mobile
 *   Collections screen for the full detail. These cards are only ever shown — and
 *   only ever fetch — for an admin who is allowed to see financial data; a
 *   non-privileged admin never mounts them at all (finding F-2, enforced upstream
 *   in dashPlan.js).
 *
 * WHERE IT LIVES:
 *   Route:        rendered inside /tech/admin/dash
 *   Rendered by:  src/pages/tech/admin/AdminDash.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./useDashWidget, ./DashCard, ./dashFormat, ../href (adminCollectionsHref)
 *   Data:      reads → get_revenue_by_division, get_payments_received, get_avg_ticket,
 *              get_ar_invoices · writes → none
 *
 * NOTES / GOTCHAS:
 *   - FINANCIAL (finding F-2): these components only mount when the parent's
 *     visibleDashWidgets(canFin) includes them, so for a non-privileged admin they
 *     are neither rendered nor fetched. Do not add a fallback that renders one of
 *     these outside that gate.
 *   - The period-scoped cards (Revenue / Payments / Avg ticket) refetch when the
 *     period changes because their loader is keyed on `period`.
 *   - Chart colours are the data-viz division palette from dashFormat, applied as
 *     inline fill styles exactly like the desktop Widgets.jsx.
 * ════════════════════════════════════════════════
 */
import { useCallback } from 'react';
import { useDashWidget } from './useDashWidget';
import { DashCard, DeltaPill, DashFootLink, DashEmpty } from './DashCard';
import {
  periodBoundsISO, periodLabel,
  shapeMoneySplit, shapeAvgTicket, shapeCollections,
} from './dashFormat';
import { adminCollectionsHref } from '../href';

// ─── SECTION: Revenue + Payments (shared money-split card) ──────────────
// Both are: headline total, vs-prior delta, a per-division stacked bar + legend.
function MoneySplitCard({ title, rpc, period, note }) {
  const loader = useCallback(
    (db) => db.rpc(rpc, periodBoundsISO(period)).then(shapeMoneySplit),
    [rpc, period],
  );
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard
      title={title}
      suffix={`· ${periodLabel(period)}`}
      right={data?.delta ? <DeltaPill {...data.delta} /> : null}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={<DashFootLink to={adminCollectionsHref()}>View collections</DashFootLink>}
    >
      {data && (
        <>
          <div className="am-dash-metric">{data.totalLabel}</div>
          <div className="am-dash-splitbar" role="img" aria-label={`${title} by division`}>
            {data.segments.map((s) => (
              s.pct > 0 ? <span key={s.key} style={{ width: `${s.pct}%`, background: s.color }} /> : null
            ))}
          </div>
          {data.legend.length > 0 ? (
            <ul className="am-dash-legend">
              {data.legend.map((s) => (
                <li key={s.key}>
                  <span className="am-dash-dot" style={{ background: s.color }} aria-hidden="true" />
                  <span className="am-dash-legend-label">{s.label}</span>
                  <span className="am-dash-legend-val">{s.valueLabel}</span>
                </li>
              ))}
            </ul>
          ) : (
            <DashEmpty>Nothing {periodLabel(period)}.</DashEmpty>
          )}
          <div className="am-dash-note">{note}</div>
        </>
      )}
    </DashCard>
  );
}

export function RevenueCard({ period }) {
  return <MoneySplitCard title="Revenue recognized" rpc="get_revenue_by_division" period={period} note="Insurance pays divisions separately" />;
}

export function PaymentsCard({ period }) {
  return <MoneySplitCard title="Payments received" rpc="get_payments_received" period={period} note="Cash collected · QBO + Stripe" />;
}

// ─── SECTION: Avg ticket ──────────────
export function AvgTicketCard({ period }) {
  const loader = useCallback(
    (db) => db.rpc('get_avg_ticket', periodBoundsISO(period)).then(shapeAvgTicket),
    [period],
  );
  const { data, loading, error, reload } = useDashWidget(loader);
  return (
    <DashCard title="Avg ticket" suffix={`· ${periodLabel(period)}`} loading={loading} error={error} onRetry={reload}>
      {data && (
        data.hasData ? (
          <>
            <div className="am-dash-bars">
              {data.bars.map((b) => (
                <div key={b.key} className="am-dash-bar-row">
                  <span className="am-dash-bar-label">{b.label}</span>
                  <span className="am-dash-bar-track">
                    <span className="am-dash-bar-fill" style={{ width: `${b.pct}%`, background: b.color }} />
                  </span>
                  <span className="am-dash-bar-val">{b.valueLabel}</span>
                </div>
              ))}
            </div>
            <div className="am-dash-avgclaim">
              <div>
                <div className="am-dash-avgclaim-label">Avg claim <span>· all jobs / loss</span></div>
                <div className="am-dash-avgclaim-sub">Miti + recon + mold combined</div>
              </div>
              <span className="am-dash-avgclaim-val">{data.avgClaim}</span>
            </div>
          </>
        ) : (
          <DashEmpty>No invoiced jobs {periodLabel(period)}.</DashEmpty>
        )
      )}
    </DashCard>
  );
}

// ─── SECTION: Collections / A/R ──────────────
const COLL_BAR_MAX = 80; // % of the plot height the tallest bar reaches (label room)

export function CollectionsCard() {
  const loader = useCallback((db) => db.rpc('get_ar_invoices').then(shapeCollections), []);
  const { data, loading, error, reload } = useDashWidget(loader);
  const max = data ? Math.max(...data.bars.map((b) => b.value), 1) : 1;
  return (
    <DashCard
      title="Collections"
      suffix="· my money"
      loading={loading}
      error={error}
      onRetry={reload}
      footer={<DashFootLink to={adminCollectionsHref()}>View collections</DashFootLink>}
    >
      {data && (
        <>
          <div className="am-dash-collbars">
            {data.bars.map((b) => {
              const h = b.value > 0 ? Math.max(4, (b.value / max) * COLL_BAR_MAX) : 0;
              return (
                <div key={b.key} className="am-dash-collbar">
                  <span className={`am-dash-collbar-val am-dash-collbar-val--${b.kind}`}>{b.valueLabel}</span>
                  <span className={`am-dash-collbar-fill am-dash-collbar-fill--${b.kind}`} style={{ height: `${h}%` }} />
                  <span className="am-dash-collbar-label">{b.label}</span>
                </div>
              );
            })}
          </div>
          <div className="am-dash-note am-dash-note--dso">
            DSO <b>{data.dso}</b> days · average time to collect
          </div>
        </>
      )}
    </DashCard>
  );
}
