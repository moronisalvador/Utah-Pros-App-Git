/**
 * ════════════════════════════════════════════════
 * FILE: CrmAttribution.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "where did our business come from, and what did each source cost"
 *   screen. For every marketing channel it lines up how much was spent, how
 *   many leads and won jobs it produced, the real revenue, and the derived
 *   efficiency numbers — cost per lead, cost per job, and return on ad spend.
 *   Paid Google Ads is also broken out by campaign (i.e. by agency). Sources
 *   we don't buy ads for (Referral, Organic, Insurance) show "—" for the cost
 *   columns, never a misleading $0.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/attribution
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/lib/attribution (rollupTotals, formatters),
 *              ./attributionParts (RangePicker, MetricCard, ChannelTable, …)
 *   Data:      reads  → get_attribution_rollup + get_attribution_by_campaign
 *                       RPCs · writes → none
 *
 * NOTES / GOTCHAS:
 *   - CallRail leads + won jobs are the single source of truth for counts;
 *     the ad platforms supply only spend dollars (see
 *     docs/crm-phase3-attribution-model.md). Do not add platform "conversions"
 *     to these efficiency numbers.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { rollupTotals, costPerLead, fmtMoney, fmtRatio } from '@/lib/attribution';
import { RangePicker, MetricCard, ChannelTable } from './attributionParts';
import { deriveRows, rangeToDates, toNumberRow } from './attributionData';

export default function CrmAttribution() {
  const { db } = useAuth();
  const [range, setRange] = useState('all');
  const [raw, setRaw] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = rangeToDates(range);
      const params = { p_start_date: start, p_end_date: end };
      const [rows, camps] = await Promise.all([
        db.rpc('get_attribution_rollup', params),
        db.rpc('get_attribution_by_campaign', params),
      ]);
      setRaw(rows || []);
      setCampaigns(camps || []);
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load attribution', type: 'error' } }));
      setRaw([]);
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [db, range]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => deriveRows(raw), [raw]);
  const totals = useMemo(() => rollupTotals(rows), [rows]);
  const camps = useMemo(
    () => (campaigns || []).map(toNumberRow).sort((a, b) => b.spend - a.spend),
    [campaigns],
  );

  return (
    <div className="crm-page">
      <div className="crm-page-header crm-page-header-row">
        <div>
          <h1 className="crm-page-title">Attribution</h1>
          <p className="crm-page-subtitle">What each source cost and what it returned. CallRail + won jobs are the truth; ad platforms supply spend only.</p>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="crm-loading">Loading…</div>
      ) : (
        <>
          <div className="crm-metric-grid">
            <MetricCard label="Paid spend" value={fmtMoney(totals.paid_spend)} sub="Google + Meta" />
            <MetricCard label="Paid ROAS" value={fmtRatio(totals.roas)} sub="revenue ÷ spend" />
            <MetricCard label="Cost / lead" value={fmtMoney(totals.cost_per_lead)} sub="paid channels" />
            <MetricCard label="Revenue" value={fmtMoney(totals.revenue)} sub="all channels" />
            <MetricCard label="Won jobs" value={totals.won_jobs.toLocaleString('en-US')} sub="all channels" />
          </div>

          <div className="crm-card">
            <h2 className="crm-section-title">By channel</h2>
            <ChannelTable rows={rows} />
            <p className="crm-note">Referral, Organic and Insurance carry no ad spend, so their cost-per-lead, cost-per-job and ROAS show “—”, not “0”.</p>
          </div>

          <div className="crm-card">
            <h2 className="crm-section-title">Google Ads by campaign <span className="crm-section-hint">(split by agency)</span></h2>
            {camps.length === 0 ? (
              <p className="crm-note">No ad spend recorded for this window yet. Campaigns appear here once the Google/Meta sync has run (Integrations).</p>
            ) : (
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Platform</th>
                      <th className="num">Spend</th>
                      <th className="num">Leads</th>
                      <th className="num">Cost / lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {camps.map((c) => (
                      <tr key={`${c.platform}:${c.campaign_id}`}>
                        <td>{c.campaign_name || c.campaign_id}</td>
                        <td>{c.platform === 'google' ? 'Google' : c.platform === 'meta' ? 'Meta' : c.platform}</td>
                        <td className="num">{fmtMoney(c.spend)}</td>
                        <td className="num">{c.leads.toLocaleString('en-US')}</td>
                        <td className="num">{fmtMoney(costPerLead(c.spend, c.leads))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
