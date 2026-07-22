/**
 * ════════════════════════════════════════════════
 * FILE: attributionParts.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The shared on-screen building blocks the three Phase 3 CRM dashboard
 *   screens (Overview, Attribution, Reports) are made of — the little metric
 *   cards, the funnel bars, the per-channel table, and the date-range picker
 *   (preset tabs + a calendar icon that opens a custom From/To range, same
 *   pattern as the Leads board's own date filter). Keeping them in one place
 *   means every screen looks and behaves the same. The non-visual helpers
 *   (channel labels, date math, number coercion) live next door in
 *   attributionData.js.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared components)
 *   Rendered by:  CrmOverview.jsx, CrmAttribution.jsx, CrmReports.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/attribution (formatters), @/components/ui (IconButton),
 *              ./attributionData (CHANNEL_LABELS, RANGES)
 *   Data:      none directly — renders rows the pages pass in.
 *
 * NOTES / GOTCHAS:
 *   - The "— not 0" rule is enforced by the fmt* formatters in attribution.js:
 *     a null metric (zero-spend / divide-by-zero) renders "—"; a real 0 renders
 *     "$0" / "0.0×" / "0%".
 *   - RangePicker's custom-range popover reuses the SAME CSS classes as
 *     CrmLeads.jsx's date filter (crm-board-period*, crm-leads-popover*,
 *     crm-leads-datepicker, crm-leads-popover-field) — no new CSS was needed.
 *     `onCustomRange` is optional; omitting it hides the calendar icon
 *     entirely (falls back to preset-tabs-only).
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import { fmtMoney, fmtRatio, fmtPct } from '@/lib/attribution';
import { IconButton } from '@/components/ui';
import { CHANNEL_LABELS, RANGES } from './attributionData';

// Tiny inline icon, same shape/convention as CrmLeads.jsx's own local
// IconCalendar — kept local to this file rather than a shared icon module,
// matching the codebase's existing per-file small-icon pattern.
function IconCalendar(p) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

const CALENDAR_ICON_STYLE = { width: 14, height: 14, strokeWidth: 1.75 };

/**
 * The preset range tabs (7 days / 30 days / 90 days / 12 months / All time) plus a
 * calendar icon that opens a From/To custom-range popover — the same pattern
 * as the Leads board's own date filter (CrmLeads.jsx's DATE_PERIODS +
 * crm-leads-datepicker popover), reused here via the same shared CSS classes
 * so both pickers look and behave identically. `value === 'custom'` lights up
 * the calendar icon instead of a preset tab. `onCustomRange` is called with
 * the applied (start, end) strings ("" for an open-ended side) — the CALLER
 * owns turning that into RPC params via rangeToDates('custom', {start, end}).
 */
export function RangePicker({ value, onChange, onCustomRange }) {
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState({ start: '', end: '' });

  return (
    <div className="crm-board-period" role="tablist" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r.key}
          type="button"
          role="tab"
          aria-selected={value === r.key}
          className={`crm-board-period-btn${value === r.key ? ' active' : ''}`}
          onClick={() => { onChange(r.key); setShowPicker(false); }}
        >
          {r.label}
        </button>
      ))}
      {onCustomRange && (
        <>
          <div className="crm-board-period-divider" />
          <IconButton
            label="Custom date range"
            size="sm"
            className={`crm-board-period-calendar${value === 'custom' ? ' active' : ''}`}
            onClick={() => setShowPicker((v) => !v)}
          >
            <IconCalendar style={CALENDAR_ICON_STYLE} />
          </IconButton>
          {showPicker && (
            <>
              <div className="crm-leads-popover-backdrop" onClick={() => setShowPicker(false)} />
              <div className="crm-leads-popover crm-leads-datepicker">
                <label className="crm-leads-popover-field">
                  <span>From</span>
                  <input
                    type="date"
                    className="crm-input"
                    value={draft.start}
                    onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                  />
                </label>
                <label className="crm-leads-popover-field">
                  <span>To</span>
                  <input
                    type="date"
                    className="crm-input"
                    value={draft.end}
                    onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="crm-btn crm-btn-primary crm-btn-sm"
                  disabled={!draft.start && !draft.end}
                  onClick={() => {
                    onCustomRange(draft.start, draft.end);
                    onChange('custom');
                    setShowPicker(false);
                  }}
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </>
      )}
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
 * The Leads → Estimates → Won funnel. Bar width is each stage's count relative
 * to the largest stage (so bars stay meaningful even before CallRail leads
 * accumulate, when the top stage can be 0); the caption shows step-over-previous
 * conversion from the tested funnelStages math.
 */
export function Funnel({ stages }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="crm-funnel">
      {stages.map((s) => {
        const width = s.count > 0 ? Math.max(4, (s.count / max) * 100) : 0;
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
