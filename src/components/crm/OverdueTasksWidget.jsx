/**
 * ════════════════════════════════════════════════
 * FILE: OverdueTasksWidget.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small Overview card that will list the tasks that are past due so staff
 *   see what needs catching up the moment they open the CRM. Phase F ships it
 *   as an empty placeholder slot; Phase 7 fills it with real overdue-task data.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component
 *   Rendered by:  src/pages/crm/CrmOverview.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none yet (Phase 7 wires get_overdue_tasks)
 *   Data:      reads → none yet · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 7 (.claude/rules/crm-wave-ownership.md). Foundation stub —
 *     renders nothing visible so the Overview layout is unaffected until Phase 7.
 * ════════════════════════════════════════════════
 */
export default function OverdueTasksWidget() {
  // Phase 7 fills this with the overdue-tasks list (get_overdue_tasks).
  return null;
}
