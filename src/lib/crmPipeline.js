/**
 * ════════════════════════════════════════════════
 * FILE: crmPipeline.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The math behind the CRM's Leads pipeline board. Puts pipeline stages
 *   (New, Contacted, Qualified, ...) in the order the admin set in Settings,
 *   sorts leads into the right column, and works out a "weighted pipeline
 *   value" — how much of the open pipeline dollars is realistically likely
 *   to actually close, instead of just adding up every open lead's full
 *   value as if it were guaranteed.
 *
 * Exports:
 *   sortStages(stages) — stages sorted by sort_order (ascending).
 *   groupLeadsByStage(leads, stages, stagePositions) — { [stageId]: leads[] },
 *     a lead with no entry in stagePositions falls into the first stage.
 *   stageWeight(stage, sortedStages) — win-likelihood weight for one stage:
 *     1 for is_won, 0 for is_lost, else a value between 0 and 1 that rises
 *     with the stage's position among the open (non-won/non-lost) stages.
 *   weightedPipelineValue(leads, stages, stagePositions) — { total, byStage }.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      none — pure functions, no DB access
 * ════════════════════════════════════════════════
 */

export function sortStages(stages) {
  return [...stages].sort((a, b) => a.sort_order - b.sort_order);
}

export function groupLeadsByStage(leads, stages, stagePositions) {
  const sorted = sortStages(stages);
  const grouped = {};
  for (const stage of sorted) grouped[stage.id] = [];

  const fallbackStageId = sorted[0]?.id ?? null;
  for (const lead of leads) {
    const stageId = stagePositions?.[lead.id]?.stage_id ?? fallbackStageId;
    if (grouped[stageId]) grouped[stageId].push(lead);
  }
  return grouped;
}

export function stageWeight(stage, sortedStages) {
  if (stage.is_won) return 1;
  if (stage.is_lost) return 0;

  const openStages = sortedStages.filter(s => !s.is_won && !s.is_lost);
  const position = openStages.findIndex(s => s.id === stage.id);
  if (position === -1) return 0;

  return (position + 1) / (openStages.length + 1);
}

export function weightedPipelineValue(leads, stages, stagePositions) {
  const sorted = sortStages(stages);
  const grouped = groupLeadsByStage(leads, stages, stagePositions);

  const byStage = {};
  let total = 0;
  for (const stage of sorted) {
    const weight = stageWeight(stage, sorted);
    const stageLeads = grouped[stage.id] || [];
    const sum = stageLeads.reduce((acc, lead) => acc + (Number(lead.value) || 0) * weight, 0);
    byStage[stage.id] = sum;
    total += sum;
  }
  return { total, byStage };
}
