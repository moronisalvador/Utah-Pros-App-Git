/**
 * ════════════════════════════════════════════════
 * FILE: ForecastWidget.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   An Overview card showing the "weighted pipeline forecast" — the expected
 *   dollar value of all the open leads on the board. Instead of pretending every
 *   open lead will close for its full value, each lead's dollar figure is
 *   discounted by how likely its current stage is to win: a lead sitting in
 *   "Qualified" counts for more than one still in "New". The card shows that one
 *   headline number plus a short per-stage breakdown so you can see where the
 *   expected money is sitting.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/lib/crmPipeline (sortStages, weightedPipelineValue, stageWeight),
 *              @/lib/attribution (fmtMoney, fmtPct)
 *   Data:      reads → get_pipeline_stages RPC, inbound_leads (open, non-spam),
 *              lead_pipeline_stage (current stage per lead) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - The per-stage weight prefers each stage's admin-set win_probability
 *     (pipeline_stages.win_probability, 0..1) and falls back to a positional
 *     ramp when it is null — the exact same tested math the Leads board uses
 *     (crmPipeline.stageWeight). Won/lost stages are excluded from the open
 *     forecast (a won lead is realized, not forecast; a lost one is $0).
 *   - Owned by Phase 9 (.claude/rules/crm-wave-ownership.md).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sortStages, weightedPipelineValue, stageWeight } from '@/lib/crmPipeline';
import { fmtMoney, fmtPct } from '@/lib/attribution';

export default function ForecastWidget() {
  const { db } = useAuth();
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [positions, setPositions] = useState({});
  const [loading, setLoading] = useState(true);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stageRows, leadRows, positionRows] = await Promise.all([
        db.rpc('get_pipeline_stages', {}),
        db.select('inbound_leads', 'spam_flag=eq.false&select=id,value&order=occurred_at.desc&limit=500'),
        db.select('lead_pipeline_stage', 'select=lead_id,stage_id'),
      ]);
      setStages(stageRows || []);
      setLeads(leadRows || []);
      const pos = {};
      for (const row of positionRows || []) pos[row.lead_id] = { stage_id: row.stage_id };
      setPositions(pos);
    } catch {
      // A forecast is non-critical — fail quiet rather than toast over Overview.
      setStages([]);
      setLeads([]);
      setPositions({});
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Derived (tested) math ──────────────
  const sortedStages = useMemo(() => sortStages(stages), [stages]);
  const { total, byStage } = useMemo(
    () => weightedPipelineValue(leads, stages, positions),
    [leads, stages, positions],
  );

  // Only the open stages carry a forecast; skip empty/zero rows to keep it tight.
  const openRows = useMemo(
    () => sortedStages
      .filter(s => !s.is_won && !s.is_lost && (byStage[s.id] || 0) > 0)
      .map(s => ({ id: s.id, name: s.name, value: byStage[s.id] || 0, weight: stageWeight(s, sortedStages) })),
    [sortedStages, byStage],
  );

  // ─── SECTION: Render ──────────────
  if (loading) return null; // stay invisible until ready, like the Foundation stub
  if (!leads.length || !stages.length) return null;

  return (
    <div className="crm-card crm-forecast">
      <div className="crm-forecast-head">
        <h2 className="crm-section-title">Weighted pipeline forecast</h2>
        <div className="crm-forecast-total">{fmtMoney(total)}</div>
      </div>
      <p className="crm-note">
        Expected value of open leads, each discounted by its stage&apos;s win probability.
      </p>

      {openRows.length === 0 ? (
        <p className="crm-note">No open pipeline value to forecast yet.</p>
      ) : (
        <div className="crm-forecast-stages">
          {openRows.map(row => (
            <div key={row.id} className="crm-forecast-row">
              <span className="crm-forecast-stage-name">{row.name}</span>
              <span className="crm-forecast-weight">{fmtPct(row.weight)} win</span>
              <span className="crm-forecast-stage-value">{fmtMoney(row.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
