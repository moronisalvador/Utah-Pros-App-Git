/**
 * ════════════════════════════════════════════════
 * FILE: CrmReports.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small set of fixed reports built on the same numbers as the rest of the
 *   CRM: which marketing sources return the most for the money (Source ROI),
 *   how much won revenue each division brought in, and the plain funnel
 *   conversion rates (leads → estimates → won). These are set views, not a
 *   drag-and-drop report builder — that is deliberately out of scope for now
 *   (see docs/crm-roadmap.md).
 *
 * WHERE IT LIVES:
 *   Route:        /crm/reports
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/lib/attribution (rollupTotals, formatters),
 *              ./attributionParts (RangePicker, ChannelTable, deriveRows, …)
 *   Data:      reads  → get_attribution_rollup + get_crm_revenue_by_division
 *                       RPCs · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Revenue = QBO-synced jobs.invoiced_value on won (booked) jobs, not cash
 *     collected to date — same definition as everywhere else in Phase 3.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { rollupTotals, fmtMoney, fmtPct } from '@/lib/attribution';
import { RangePicker, ChannelTable } from './attributionParts';
import { deriveRows, rangeToDates, toNumberRow } from './attributionData';

const DIVISION_LABELS = {
  water: 'Water', reconstruction: 'Reconstruction', mold: 'Mold',
  remodeling: 'Remodeling', contents: 'Contents', fire: 'Fire', general: 'General',
};

export default function CrmReports() {
  const { db } = useAuth();
  const [range, setRange] = useState('all');
  const [raw, setRaw] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = rangeToDates(range);
      const params = { p_start_date: start, p_end_date: end };
      const [rows, divs] = await Promise.all([
        db.rpc('get_attribution_rollup', params),
        db.rpc('get_crm_revenue_by_division', params),
      ]);
      setRaw(rows || []);
      setDivisions(divs || []);
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load reports', type: 'error' } }));
      setRaw([]);
      setDivisions([]);
    } finally {
      setLoading(false);
    }
  }, [db, range]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => deriveRows(raw), [raw]);
  const totals = useMemo(() => rollupTotals(rows), [rows]);
  const divs = useMemo(
    () => (divisions || []).map(toNumberRow).sort((a, b) => b.revenue - a.revenue),
    [divisions],
  );
  const divTotal = useMemo(() => divs.reduce((s, d) => s + d.revenue, 0), [divs]);

  return (
    <div className="crm-page">
      <div className="crm-page-header crm-page-header-row">
        <div>
          <h1 className="crm-page-title">Reports</h1>
          <p className="crm-page-subtitle">A fixed set of reports on the same source-of-truth numbers.</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="crm-loading">Loading…</div>
      ) : (
        <>
          <div className="crm-card">
            <h2 className="crm-section-title">Source ROI</h2>
            <ChannelTable rows={rows} />
          </div>

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
        </>
      )}
    </div>
  );
}
