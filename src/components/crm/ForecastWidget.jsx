/**
 * ════════════════════════════════════════════════
 * FILE: ForecastWidget.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small Overview card that will show the weighted pipeline forecast — the
 *   expected dollar value of open leads, each discounted by how likely its
 *   stage is to close. Phase F ships it as an empty placeholder slot; Phase 9
 *   fills it with the real forecast math.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none yet (Phase 9 wires stageWeight / win_probability)
 *   Data:      reads → none yet · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 9 (.claude/rules/crm-wave-ownership.md). Foundation stub —
 *     renders nothing visible so the Overview layout is unaffected until Phase 9.
 * ════════════════════════════════════════════════
 */
export default function ForecastWidget() {
  // Phase 9 fills this with the weighted pipeline forecast.
  return null;
}
