/**
 * ════════════════════════════════════════════════
 * FILE: attributionParts.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared on-screen building blocks the three Phase 3 CRM dashboard
 *   screens (Overview, Attribution, Reports) are made of — the little metric
 *   cards, the funnel bars, the per-channel table, and the date-range buttons.
 *   Keeping them in one place means every screen looks and behaves the same.
 *   The non-visual helpers (channel labels, date math, number coercion) live
 *   next door in attributionData.js.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared components)
 *   Rendered by:  CrmOverview.jsx, CrmAttribution.jsx, CrmReports.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/attribution (formatters), ./attributionData (CHANNEL_LABELS,
 *              RANGES)
 *   Data:      none directly — renders rows the pages pass in.
 *
 * NOTES / GOTCHAS:
 *   - The "— not 0" rule is enforced by the fmt* formatters in attribution.js:
 *     a null metric (zero-spend / divide-by-zero) renders "—"; a real 0 renders
 *     "$0" / "0.0×" / "0%".
 * ════════════════════════════════════════════════
 */
import { fmtMoney, fmtRatio, fmtPct } from '@/lib/attribution';
import { CHANNEL_LABELS, RANGES } from './attributionData';

export function RangePicker({ value, onChange }) {
  return (
    <div className="crm-range" role="group" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          className={`crm-range-btn${value === r.key ? ' active' : ''}`}
          onClick={() => onChange(r.key)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function MetricCard({ label, value, sub }) {
  return (
    <div className="crm-metric">
      <div className="crm-metric-label">{label}</div>
      <div className="crm-metric-value">{value}</div>
      {sub != null && <div className="crm-metric-sub">{sub}</div>}
    </div>
  );
}

/**
 * The Leads → Estimates → Won funnel. Bar width is each stage's share of the
 * top stage; the caption shows step-over-previous conversion.
 */
export function Funnel({ stages }) {
  return (
    <div className="crm-funnel">
      {stages.map((s) => {
        const width = s.rate_from_top == null ? 0 : Math.max(4, s.rate_from_top * 100);
        return (
          <div key={s.key} className="crm-funnel-stage">
            <div className="crm-funnel-head">
              <span className="crm-funnel-label">{s.label}</span>
              <span className="crm-funnel-count">{s.count.toLocaleString('en-US')}</span>
            </div>
            <div className="crm-funnel-track">
              <div className="crm-funnel-bar" style={{ width: `${width}%` }} />
            </div>
            <div className="crm-funnel-rate">
              {s.rate_from_prev == null ? 'Top of funnel' : `${fmtPct(s.rate_from_prev)} of previous`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The per-channel attribution table. Zero-spend channels render "—" for the
 * cost/return columns (via the fmt* null handling) — never "0".
 */
export function ChannelTable({ rows }) {
  return (
    <div className="crm-table-wrap">
      <table className="crm-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">Spend</th>
            <th className="num">Leads</th>
            <th className="num">Cost / lead</th>
            <th className="num">Estimates</th>
            <th className="num">Won jobs</th>
            <th className="num">Cost / job</th>
            <th className="num">Revenue</th>
            <th className="num">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel}>
              <td>
                <span className={`crm-channel-dot crm-channel-${r.channel}`} />
                {CHANNEL_LABELS[r.channel] || r.channel}
              </td>
              <td className="num">{fmtMoney(r.spend)}</td>
              <td className="num">{r.leads.toLocaleString('en-US')}</td>
              <td className="num">{fmtMoney(r.cost_per_lead)}</td>
              <td className="num">{r.estimates.toLocaleString('en-US')}</td>
              <td className="num">{r.won_jobs.toLocaleString('en-US')}</td>
              <td className="num">{fmtMoney(r.cost_per_job)}</td>
              <td className="num">{fmtMoney(r.revenue)}</td>
              <td className="num">{fmtRatio(r.roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
