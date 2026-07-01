/**
 * ════════════════════════════════════════════════
 * FILE: CrmLayout.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The real shell every CRM screen lives inside — a left menu (Overview,
 *   Leads, Call Log, Tasks, Attribution, Reports, Integrations, Settings)
 *   next to whichever CRM page is open, in the CRM's own look (a different
 *   font and color set than the rest of the app, on purpose — see NOTES).
 *
 * WHERE IT LIVES:
 *   Route:        wraps /crm/* (pathless layout route)
 *   Rendered by:  src/App.jsx (inside the main Layout's <Outlet/>)
 *
 * DEPENDS ON:
 *   Packages:  react-router-dom (NavLink, Outlet)
 *   Internal:  @/lib/crmIcons
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - docs/crm-roadmap.md "Design & shell decisions": the CRM deliberately
 *     keeps its own visual identity (Public Sans, --crm-* scoped tokens)
 *     instead of being re-skinned onto the rest of UPR's Inter-based look —
 *     everything is scoped under the .crm-shell wrapper class here so it
 *     never leaks into the rest of the app, mirroring how .tech-layout
 *     scopes --tech-* tokens for the field-tech app.
 *   - The whole /crm/* tree is gated by <FeatureRoute flag="page:crm"> in
 *     App.jsx, not by anything in this component.
 *   - /crm/roadmap (Phase 0's build-progress tracker) is not one of the
 *     sidebar items above — it's a separate build/ops page, still reachable
 *     directly at that URL, linked from the sidebar footer instead of taking
 *     a full nav slot.
 *   - Only Call Log and Integrations have real data behind them this phase
 *     (docs/crm-roadmap.md Phase 1) — the rest render a "coming in Phase N"
 *     placeholder until their own phase ships.
 *   - Campaigns (Phase 4c) was originally built into the pre-existing
 *     Marketing.jsx page (outside this shell) — moved into the CRM sidebar
 *     afterward per owner feedback (it was hard to discover there), so it
 *     lives at /crm/campaigns like every other CRM screen now.
 * ════════════════════════════════════════════════
 */
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  IconOverview, IconLeads, IconCallLog, IconTasks,
  IconAttribution, IconReports, IconCampaigns, IconIntegrations, IconCrmSettings,
} from '@/lib/crmIcons';

const SIDEBAR_ITEMS = [
  { key: 'overview',     label: 'Overview',     path: '/crm/overview',     icon: IconOverview },
  { key: 'leads',        label: 'Leads',        path: '/crm/leads',        icon: IconLeads },
  { key: 'call-log',     label: 'Call Log',     path: '/crm/call-log',     icon: IconCallLog },
  { key: 'tasks',        label: 'Tasks',        path: '/crm/tasks',        icon: IconTasks },
  { key: 'attribution',  label: 'Attribution',  path: '/crm/attribution',  icon: IconAttribution },
  { key: 'reports',      label: 'Reports',      path: '/crm/reports',      icon: IconReports },
  { key: 'campaigns',    label: 'Campaigns',    path: '/crm/campaigns',    icon: IconCampaigns },
  { key: 'integrations', label: 'Integrations', path: '/crm/integrations', icon: IconIntegrations },
  { key: 'settings',     label: 'Settings',     path: '/crm/settings',     icon: IconCrmSettings },
];

export default function CrmLayout() {
  const { employee } = useAuth();
  const isPartner = employee?.role === 'crm_partner';
  // A crm_partner sees the whole CRM — Settings included — except
  // Integrations (shared platform OAuth credentials) and the internal
  // build-roadmap tracker (an engineering artifact, not a CRM feature).
  const visibleItems = isPartner
    ? SIDEBAR_ITEMS.filter(item => item.key !== 'integrations')
    : SIDEBAR_ITEMS;

  return (
    <div className="crm-shell">
      <nav className="crm-sidebar">
        <div className="crm-sidebar-brand">CRM</div>
        <div className="crm-sidebar-links">
          {visibleItems.map(item => (
            <NavLink
              key={item.key}
              to={item.path}
              className={({ isActive }) => `crm-sidebar-link${isActive ? ' active' : ''}`}
            >
              <item.icon className="crm-sidebar-icon" />
              {item.label}
            </NavLink>
          ))}
        </div>
        {!isPartner && (
          <NavLink to="/crm/roadmap" className="crm-sidebar-footer-link">
            Build roadmap
          </NavLink>
        )}
      </nav>
      <div className="crm-content">
        <Outlet />
      </div>
    </div>
  );
}
