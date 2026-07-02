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
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  IconOverview, IconLeads, IconContacts, IconConversations, IconCallLog, IconTasks,
  IconSequences, IconForms, IconAttribution, IconReports, IconCampaigns,
  IconIntegrations, IconCrmSettings,
} from '@/lib/crmIcons';

const SIDEBAR_ITEMS = [
  { key: 'overview',      label: 'Overview',      path: '/crm/overview',      icon: IconOverview },
  { key: 'leads',         label: 'Leads',         path: '/crm/leads',         icon: IconLeads },
  { key: 'contacts',      label: 'Contacts',      path: '/crm/contacts',      icon: IconContacts },
  { key: 'conversations', label: 'Conversations', path: '/crm/conversations', icon: IconConversations },
  { key: 'call-log',      label: 'Call Log',      path: '/crm/call-log',      icon: IconCallLog },
  { key: 'tasks',         label: 'Tasks',         path: '/crm/tasks',         icon: IconTasks },
  { key: 'sequences',     label: 'Sequences',     path: '/crm/sequences',     icon: IconSequences },
  { key: 'forms',         label: 'Forms',         path: '/crm/forms',         icon: IconForms },
  { key: 'attribution',   label: 'Attribution',   path: '/crm/attribution',   icon: IconAttribution },
  { key: 'reports',       label: 'Reports',       path: '/crm/reports',       icon: IconReports },
  { key: 'campaigns',     label: 'Campaigns',     path: '/crm/campaigns',     icon: IconCampaigns },
  { key: 'integrations',  label: 'Integrations',  path: '/crm/integrations',  icon: IconIntegrations },
  { key: 'settings',      label: 'Settings',      path: '/crm/settings',      icon: IconCrmSettings },
];

// Per-screen access key: nav key with hyphens → underscores, so 'call-log'
// gates on the `crm_call_log` nav-permission + `feature:crm_call_log` sub-flag.
const accessKeyFor = (navKey) => `crm_${String(navKey).replace(/-/g, '_')}`;

export default function CrmLayout() {
  const { employee, canAccess, isFeatureEnabled } = useAuth();
  const { pathname } = useLocation();
  const isPartner = employee?.role === 'crm_partner';

  // Per-screen staff gating (Phase 6b). A CRM screen is visible when BOTH the
  // rollout sub-flag allows it (feature:crm_<screen> — absent/enabled = open) AND
  // the employee has access (canAccess: per-employee override → admin → role
  // nav_permissions). Roles are defined per screen here BEFORE page:crm opens to
  // staff; until then only admins (who pass canAccess) and the dev-only preview
  // user reach /crm at all. crm_partner accounts are external and provisioned
  // deliberately — they keep the whole CRM except Integrations. Overview is the
  // CRM home and always reachable so no one lands on a locked page.
  const screenAccessible = (navKey) => {
    if (navKey === 'overview') return true;
    if (isPartner) return navKey !== 'integrations';
    if (!isFeatureEnabled(`feature:${accessKeyFor(navKey)}`)) return false;
    return canAccess(accessKeyFor(navKey));
  };

  const visibleItems = SIDEBAR_ITEMS.filter(item => screenAccessible(item.key));

  // Route guard: the layout wraps every /crm/* route, so enforce access on the
  // rendered screen too (direct-URL navigation can't bypass the hidden nav).
  const current = SIDEBAR_ITEMS.find(
    item => pathname === item.path || pathname.startsWith(`${item.path}/`)
  );
  const isRoadmap = pathname.startsWith('/crm/roadmap');
  const outletAllowed = isRoadmap ? !isPartner : (!current || screenAccessible(current.key));

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
        {outletAllowed ? (
          <Outlet />
        ) : (
          <div className="crm-page">
            <div className="crm-access-denied">
              <div className="crm-access-denied-title">No access to this screen</div>
              <p className="crm-access-denied-body">
                Your account doesn’t have access to this part of the CRM. Ask an
                administrator to grant it from Admin → Page Access.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
