/**
 * ════════════════════════════════════════════════
 * FILE: CrmStubPage.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A placeholder screen for CRM sidebar items that don't have real data
 *   behind them yet — it just says which phase will build the real page,
 *   so the sidebar feels complete without faking functionality that isn't
 *   there. Phase 1 only builds Call Log and Integrations for real
 *   (docs/crm-roadmap.md); everything else uses this until its own phase.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — rendered by CrmOverview/CrmLeads/CrmTasks/
 *                 CrmAttribution/CrmReports/CrmSettings
 *   Rendered by:  src/App.jsx routes, inside CrmLayout
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *   Data:      none
 * ════════════════════════════════════════════════
 */
export default function CrmStubPage({ title, phase }) {
  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">{title}</h1>
      </div>
      <div className="crm-stub">
        <p className="crm-stub-title">Coming in Phase {phase}</p>
        <p className="crm-stub-text">
          This screen is part of the CRM shell (Phase 1) but its data and
          functionality ship in a later phase — see docs/crm-roadmap.md or
          the <a href="/crm/roadmap">build roadmap</a> for status.
        </p>
      </div>
    </div>
  );
}
