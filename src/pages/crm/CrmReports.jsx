/**
 * ════════════════════════════════════════════════
 * FILE: CrmReports.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A fixed set of reports built on the same source-of-truth numbers as the rest
 *   of the CRM. It covers: which marketing sources return the most for the money
 *   (Source ROI), won revenue by division, the plain funnel conversion rates, a
 *   month-by-month conversion trend, an estimator leaderboard, inbound call
 *   volume, how fast new leads get worked (speed-to-lead), how long estimates sit
 *   unanswered (aging), how leads are moving through the pipeline, and each
 *   customer's lifetime value. These are set views, not a drag-and-drop report
 *   builder — that is deliberately out of scope (see docs/crm-roadmap.md).
 *
 * WHERE IT LIVES:
 *   Route:        /crm/reports
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/lib/attribution (rollupTotals, deriveConversionTrend,
 *              deriveLeaderboard, speedToLeadSummary, ltvSummary, formatters),
 *              ./attributionParts (RangePicker, ChannelTable),
 *              ./attributionData (deriveRows, rangeToDates, toNumberRow)
 *   Data:      reads  → get_attribution_rollup, get_crm_revenue_by_division,
 *                       get_conversion_trend, get_estimator_leaderboard,
 *                       get_call_volume, get_speed_to_lead, get_estimate_aging,
 *                       get_pipeline_movement, get_contact_ltv RPCs
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - All money math (rates, ROAS, div-by-zero → "—") lives in the pure,
 *     unit-tested @/lib/attribution; the report RPCs return raw counts only.
 *   - Pipeline-movement and speed-to-lead are HISTORY-backed: the lead_stage_history
 *     log only accrues from CRM Phase F onward, so those two cards render an
 *     honest "Since <date>" caption rather than implying older history.
 *   - Revenue = QBO-synced jobs.invoiced_value on won (booked) jobs, not cash
 *     collected to date — same definition as everywhere else in Phase 3.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  rollupTotals, fmtMoney, fmtPct,
  deriveConversionTrend, deriveLeaderboard, speedToLeadSummary, ltvSummary,
} from '@/lib/attribution';
import { RangePicker, ChannelTable } from './attributionParts';
import { deriveRows, rangeToDates, toNumberRow } from './attributionData';

const DIVISION_LABELS = {
  water: 'Water', reconstruction: 'Reconstruction', mold: 'Mold',
  remodeling: 'Remodeling', contents: 'Contents', fire: 'Fire', general: 'General',
};

const n = (v) => Number(v ?? 0) || 0;

// A history-backed report's "Since <date>" caption (lead_stage_history accrues
// only from Phase F onward). null data_since → no history yet.
function sinceCaption(rows) {
  const since = rows?.find(r => r?.data_since)?.data_since;
  if (!since) return 'No pipeline history recorded yet.';
  return `Since ${new Date(since).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (when stage history began).`;
}

export default function CrmReports() {
  const { db } = useAuth();
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = rangeToDates(range);
      const dateParams = { p_start: start, p_end: end };
      const legacyParams = { p_start_date: start, p_end_date: end };
      const [
        rollup, divisions, trend, leaderboard, callVolume, speed, aging, movement, ltv,
      ] = await Promise.all([
        db.rpc('get_attribution_rollup', legacyParams),
        db.rpc('get_crm_revenue_by_division', legacyParams),
        db.rpc('get_conversion_trend', dateParams),
        db.rpc('get_estimator_leaderboard', dateParams),
        db.rpc('get_call_volume', dateParams),
        db.rpc('get_speed_to_lead', dateParams),
        db.rpc('get_estimate_aging', {}),
        db.rpc('get_pipeline_movement', dateParams),
        db.rpc('get_contact_ltv', {}),
      ]);
      setData({
        rollup: rollup || [], divisions: divisions || [], trend: trend || [],
        leaderboard: leaderboard || [], callVolume: callVolume || [], speed: speed || [],
        aging: aging || [], movement: movement || [], ltv: ltv || [],
      });
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load reports', type: 'error' } }));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [db, range]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Derived (tested) math ──────────────
  const rows = useMemo(() => deriveRows(data?.rollup), [data]);
  const totals = useMemo(() => rollupTotals(rows), [rows]);
  const divs = useMemo(
    () => (data?.divisions || []).map(toNumberRow).sort((a, b) => b.revenue - a.revenue),
    [data],
  );
  const divTotal = useMemo(() => divs.reduce((s, d) => s + d.revenue, 0), [divs]);

  const trend = useMemo(() => deriveConversionTrend(data?.trend), [data]);
  const leaderboard = useMemo(() => deriveLeaderboard(data?.leaderboard), [data]);
  const speedSummary = useMemo(() => speedToLeadSummary(data?.speed), [data]);
  const ltvStats = useMemo(() => ltvSummary(data?.ltv), [data]);
  const calls = useMemo(() => {
    const list = data?.callVolume || [];
    const total = list.reduce((s, r) => s + n(r.total), 0);
    const answered = list.reduce((s, r) => s + n(r.answered), 0);
    return { total, answered, missed: total - answered };
  }, [data]);
  const speedMax = useMemo(
    () => Math.max(1, ...(data?.speed || []).map(b => n(b.count))),
    [data],
  );

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page">
      <div className="crm-page-header crm-page-header-row">
        <div>
          <h1 className="crm-page-title">Reports</h1>
          <p className="crm-page-subtitle">A fixed set of reports on the same source-of-truth numbers.</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {/* ─── Source ROI ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Source ROI</h2>
        <ChannelTable rows={rows} />
      </div>

      {/* ─── Conversion trend (monthly) ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Conversion trend</h2>
        {trend.length === 0 ? (
          <p className="crm-note">No activity in this window.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Leads</th>
                  <th className="num">Estimates</th>
                  <th className="num">Won</th>
                  <th className="num">Lead → won</th>
                  <th className="num">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((r) => (
                  <tr key={r.period}>
                    <td>{r.period}</td>
                    <td className="num">{r.leads.toLocaleString('en-US')}</td>
                    <td className="num">{r.estimates.toLocaleString('en-US')}</td>
                    <td className="num">{r.won_jobs.toLocaleString('en-US')}</td>
                    <td className="num">{fmtPct(r.lead_to_won_rate)}</td>
                    <td className="num">{fmtMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Estimator leaderboard ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Estimator leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p className="crm-note">No jobs with an assigned estimator in this window.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Estimator</th>
                  <th className="num">Jobs</th>
                  <th className="num">Won</th>
                  <th className="num">Win rate</th>
                  <th className="num">Revenue</th>
                  <th className="num">Rev / won</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r) => (
                  <tr key={r.estimator}>
                    <td>{r.estimator}</td>
                    <td className="num">{r.total_jobs.toLocaleString('en-US')}</td>
                    <td className="num">{r.won_jobs.toLocaleString('en-US')}</td>
                    <td className="num">{fmtPct(r.win_rate)}</td>
                    <td className="num">{fmtMoney(r.revenue)}</td>
                    <td className="num">{fmtMoney(r.revenue_per_won)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Speed to lead (SLA) ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Speed to lead</h2>
        <p className="crm-note">{sinceCaption(data?.speed)}</p>
        <div className="crm-metric-grid">
          <div className="crm-metric">
            <div className="crm-metric-label">Worked within 5 min</div>
            <div className="crm-metric-value">{fmtPct(speedSummary.sla_rate)}</div>
            <div className="crm-metric-sub">{speedSummary.within_sla} of {speedSummary.total}</div>
          </div>
        </div>
        {speedSummary.total > 0 && (
          <div className="crm-report-bars">
            {(data?.speed || []).map((b) => (
              <div key={b.sort_order} className={`crm-report-bar-row${b.within_sla ? ' is-sla' : ''}`}>
                <span className="crm-report-bar-label">{b.bucket}</span>
                <span className="crm-report-bar-track">
                  <span className="crm-report-bar-fill" style={{ width: `${(n(b.count) / speedMax) * 100}%` }} />
                </span>
                <span className="crm-report-bar-val">{n(b.count).toLocaleString('en-US')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Call volume ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Call volume</h2>
        <div className="crm-metric-grid">
          <div className="crm-metric">
            <div className="crm-metric-label">Total calls</div>
            <div className="crm-metric-value">{calls.total.toLocaleString('en-US')}</div>
          </div>
          <div className="crm-metric">
            <div className="crm-metric-label">Answered</div>
            <div className="crm-metric-value">{calls.answered.toLocaleString('en-US')}</div>
          </div>
          <div className="crm-metric">
            <div className="crm-metric-label">Missed</div>
            <div className="crm-metric-value">{calls.missed.toLocaleString('en-US')}</div>
          </div>
          <div className="crm-metric">
            <div className="crm-metric-label">Answer rate</div>
            <div className="crm-metric-value">{fmtPct(calls.total > 0 ? calls.answered / calls.total : null)}</div>
          </div>
        </div>
      </div>

      {/* ─── Estimate aging ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Estimate aging</h2>
        <p className="crm-note">Open estimates (submitted, not yet converted) by age.</p>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Age</th>
                <th className="num">Estimates</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {(data?.aging || []).map((b) => (
                <tr key={b.sort_order}>
                  <td>{b.bucket}</td>
                  <td className="num">{n(b.count).toLocaleString('en-US')}</td>
                  <td className="num">{fmtMoney(n(b.total_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Pipeline movement ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Pipeline movement</h2>
        <p className="crm-note">{sinceCaption(data?.movement)}</p>
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Stage</th>
                <th className="num">Moved in</th>
                <th className="num">Moved out</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {(data?.movement || []).map((s) => (
                <tr key={s.stage_id}>
                  <td>{s.stage_name}</td>
                  <td className="num">{n(s.moved_in).toLocaleString('en-US')}</td>
                  <td className="num">{n(s.moved_out).toLocaleString('en-US')}</td>
                  <td className="num">{n(s.net) > 0 ? '+' : ''}{n(s.net).toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Contact lifetime value ─── */}
      {/* The RPC returns the top-25 customers by revenue, so these summary
          metrics describe that top set — not the entire customer book. Labelled
          accordingly so the average isn't misread as a portfolio-wide figure. */}
      <div className="crm-card">
        <h2 className="crm-section-title">Top customers by lifetime value</h2>
        <div className="crm-metric-grid">
          <div className="crm-metric">
            <div className="crm-metric-label">Avg. value (top customers)</div>
            <div className="crm-metric-value">{fmtMoney(ltvStats.avg_ltv)}</div>
            <div className="crm-metric-sub">across {ltvStats.contact_count} shown</div>
          </div>
          <div className="crm-metric">
            <div className="crm-metric-label">Repeat rate (top customers)</div>
            <div className="crm-metric-value">{fmtPct(ltvStats.repeat_rate)}</div>
            <div className="crm-metric-sub">{ltvStats.repeat_count} with repeat jobs</div>
          </div>
        </div>
        {(data?.ltv || []).length === 0 ? (
          <p className="crm-note">No won jobs to value yet.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th className="num">Jobs</th>
                  <th className="num">Revenue</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(data?.ltv || []).map((c) => (
                  <tr key={c.contact_id}>
                    <td>{c.contact_name || 'Unknown'}</td>
                    <td className="num">{n(c.jobs).toLocaleString('en-US')}</td>
                    <td className="num">{fmtMoney(n(c.revenue))}</td>
                    <td>{c.is_repeat && <span className="crm-badge crm-badge-won">Repeat</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Won revenue by division ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Won revenue by division</h2>
        {divs.length === 0 ? (
          <p className="crm-note">No won jobs in this window.</p>
        ) : (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Division</th>
                  <th className="num">Won jobs</th>
                  <th className="num">Revenue</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {divs.map((d) => (
                  <tr key={d.division}>
                    <td>{DIVISION_LABELS[d.division] || d.division}</td>
                    <td className="num">{d.won_jobs.toLocaleString('en-US')}</td>
                    <td className="num">{fmtMoney(d.revenue)}</td>
                    <td className="num">{divTotal > 0 ? fmtPct(d.revenue / divTotal) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Funnel conversion ─── */}
      <div className="crm-card">
        <h2 className="crm-section-title">Funnel conversion</h2>
        <div className="crm-metric-grid">
          <div className="crm-metric">
            <div className="crm-metric-label">Lead → estimate</div>
            <div className="crm-metric-value">{fmtPct(totals.lead_to_estimate_rate)}</div>
          </div>
          <div className="crm-metric">
            <div className="crm-metric-label">Estimate → won</div>
            <div className="crm-metric-value">{fmtPct(totals.estimate_to_won_rate)}</div>
          </div>
          <div className="crm-metric">
            <div className="crm-metric-label">Lead → won</div>
            <div className="crm-metric-value">{fmtPct(totals.lead_to_won_rate)}</div>
          </div>
          <div className="crm-metric">
            <div className="crm-metric-label">Revenue / won job</div>
            <div className="crm-metric-value">{totals.won_jobs > 0 ? fmtMoney(totals.revenue / totals.won_jobs) : '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
