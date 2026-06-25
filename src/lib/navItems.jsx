/**
 * ════════════════════════════════════════════════
 * FILE: navItems.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   This is the one master list of every link in the office app's navigation —
 *   Dashboard, Claims, Customers, Settings and so on. Both the old dark side
 *   menu (still used on phones and iPads) and the new desktop top bar read from
 *   this same list, so the two can never drift apart and show different links.
 *   It also holds the single rule that decides whether a given person is allowed
 *   to see each link (based on their role and which features are turned on).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data + helper module, not a screen)
 *   Rendered by:  n/a — imported by Sidebar.jsx, TopNav.jsx, OverflowDrawer.jsx,
 *                 and SettingsLayout.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (icon components are JSX)
 *   Internal:  @/components/Icons (shared SVG icons)
 *   Data:      reads  → none (visibility is computed from AuthContext helpers
 *                       passed in by the caller)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - NAV_ITEMS is the EXACT legacy list the mobile/iPad Sidebar renders — keep
 *     its contents and order identical so that experience never changes.
 *   - The desktop groupings (PRIMARY_ITEMS / OVERFLOW_ITEMS / SYSTEM_ITEMS) are
 *     a re-slicing of the SAME pages for the ≥1280px top-nav shell, plus
 *     Marketing (which is intentionally NOT in NAV_ITEMS so the mobile sidebar
 *     is unchanged).
 *   - isItemVisible() mirrors the legacy Sidebar gating exactly: adminOnly →
 *     role check; moroniOnly → email check; `always` skips canAccess (Help);
 *     otherwise canAccess(key); then the optional feature-flag check.
 *   - Renames in PRIMARY_ITEMS (Home/Inbox/My Money/Time) are LABELS ONLY — the
 *     paths and nav_keys stay the same so routing and permissions are untouched.
 * ════════════════════════════════════════════════
 */
import {
  IconDashboard, IconConversations, IconJobs,
  IconCustomers, IconSchedule, IconTimeTracking,
  IconAdmin, IconSettings,
} from '@/components/Icons';

// ─── SECTION: Nav-only icon components (moved out of Sidebar.jsx, unchanged) ───
export function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
export function IconTemplates(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 14v7"/></svg>);}
export function IconProduction(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="4" height="18" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="5" width="4" height="16" rx="1"/></svg>);}
export function IconCollections(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/><path d="M9 3.5C10 3.2 11 3 12 3"/><path d="M3.5 9C3.2 10 3 11 3 12"/></svg>);}
export function IconClaim(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>);}
export function IconDevTools(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>);}
export function IconImport(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>);}
export function IconFeedback(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>);}
export function IconCalculator(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="8" y1="14" x2="8" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="8" y1="18" x2="12" y2="18"/><line x1="16" y1="18" x2="16" y2="18.01"/></svg>);}
export function IconHelp(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>);}
export function IconMarketing(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>);}
export function IconEstimate(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 17.5V11"/><path d="M13.8 12.3a2 2 0 0 0-3.6 1.1c0 1.7 3.6.9 3.6 2.7a2 2 0 0 1-3.6 1.1"/></svg>);}

// ─── SECTION: Legacy sidebar list (mobile + ≤1279px desktop — keep identical) ───
// featureFlag: if set, this nav item is hidden when that flag is disabled.
// No featureFlag = always show (existing pages are unrestricted).
export const NAV_ITEMS = [
  { section: 'Main' },
  { key: 'dashboard',    label: 'Dashboard',    path: '/',             icon: IconDashboard },
  { key: 'conversations',label: 'Conversations',path: '/conversations', icon: IconConversations, badge: true },
  { key: 'claims',       label: 'Claims',       path: '/claims',       icon: IconClaim },
  { key: 'jobs',         label: 'Jobs',         path: '/jobs',         icon: IconJobs },
  { key: 'production',   label: 'Production',   path: '/production',   icon: IconProduction },
  { key: 'customers',    label: 'Customers',    path: '/customers',    icon: IconCustomers },

  { section: 'Operations' },
  { key: 'schedule',           label: 'Schedule',           path: '/schedule',           icon: IconSchedule },
  { key: 'schedule_templates', label: 'Schedule Templates', path: '/schedule/templates', icon: IconTemplates },
  { key: 'time_tracking',      label: 'Time Tracking',      path: '/time-tracking',      icon: IconTimeTracking, featureFlag: 'page:time_tracking' },
  { key: 'collections',        label: 'Collections',        path: '/collections',        icon: IconCollections,  featureFlag: 'page:collections' },
  { key: 'estimates',          label: 'Estimates',          path: '/estimates',          icon: IconEstimate,     featureFlag: 'page:estimates' },
  { key: 'leads',              label: 'Leads',              path: '/leads',              icon: IconJobs,         featureFlag: 'page:leads' },
  { key: 'encircle_import',    label: 'Encircle Import',    path: '/import/encircle',    icon: IconImport },

  { section: 'Tools' },
  { key: 'oop_pricing',        label: 'OOP Pricing',        path: '/tools/oop-pricing',  icon: IconCalculator,   featureFlag: 'tool:oop_pricing' },

  { section: 'System' },
  { key: 'admin_panel',          label: 'Admin',              path: '/admin',                       icon: IconAdmin },
  { key: 'demo_sheet_builder',   label: 'Scope Sheet Builder', path: '/admin/demo-sheet-builder',    icon: IconAdmin, adminOnly: true },
  { key: 'tech_feedback',        label: 'Tech Feedback',      path: '/tech-feedback',               icon: IconFeedback },
  { key: 'settings',             label: 'Settings',           path: '/settings',                    icon: IconSettings },
];

// ─── SECTION: Desktop top-nav groupings (≥1280px) ───
// PRIMARY: the always-visible top bar. Labels are renamed per owner request
// (Home/Inbox/My Money/Time) but paths + nav_keys are unchanged.
export const PRIMARY_ITEMS = [
  { key: 'dashboard',     label: 'Home',      path: '/',              icon: IconDashboard,     end: true },
  { key: 'conversations', label: 'Inbox',     path: '/conversations', icon: IconConversations, badge: true },
  { key: 'schedule',      label: 'Schedule',  path: '/schedule',      icon: IconSchedule },
  { key: 'claims',        label: 'Claims',    path: '/claims',        icon: IconClaim },
  { key: 'customers',     label: 'Customers', path: '/customers',     icon: IconCustomers },
  { key: 'collections',   label: 'My Money',  path: '/collections',   icon: IconCollections,   featureFlag: 'page:collections' },
  { key: 'estimates',     label: 'Estimates', path: '/estimates',     icon: IconEstimate,      featureFlag: 'page:estimates' },
  { key: 'time_tracking', label: 'Time',      path: '/time-tracking', icon: IconTimeTracking,  featureFlag: 'page:time_tracking' },
];

// OVERFLOW: secondary items behind the collapsible "menu" drawer.
export const OVERFLOW_ITEMS = [
  { key: 'jobs',               label: 'Jobs',               path: '/jobs',               icon: IconJobs },
  { key: 'production',         label: 'Production',         path: '/production',         icon: IconProduction },
  { key: 'schedule_templates', label: 'Schedule Templates', path: '/schedule/templates', icon: IconTemplates },
  { key: 'encircle_import',    label: 'Encircle Import',    path: '/import/encircle',    icon: IconImport },
  { key: 'oop_pricing',        label: 'OOP Pricing',        path: '/tools/oop-pricing',  icon: IconCalculator, featureFlag: 'tool:oop_pricing' },
  { key: 'leads',              label: 'Leads',              path: '/leads',              icon: IconJobs,       featureFlag: 'page:leads' },
  { key: 'marketing',          label: 'Marketing',          path: '/marketing',          icon: IconMarketing,  featureFlag: 'page:marketing' },
];

// SYSTEM: the Settings hub left rail. admin_panel uses canAccess (matches legacy
// sidebar — the route itself is AdminRoute-gated); help is always visible;
// dev_tools is Moroni-only.
export const SYSTEM_ITEMS = [
  { key: 'settings',           label: 'Settings',            path: '/settings',                 icon: IconSettings },
  { key: 'admin_panel',        label: 'Admin',               path: '/admin',                    icon: IconAdmin,    end: true },
  { key: 'demo_sheet_builder', label: 'Scope Sheet Builder', path: '/admin/demo-sheet-builder', icon: IconAdmin,    adminOnly: true },
  { key: 'tech_feedback',      label: 'Tech Feedback',       path: '/tech-feedback',            icon: IconFeedback },
  { key: 'help',               label: 'Help & Guides',       path: '/help',                     icon: IconHelp,     always: true },
  { key: 'dev_tools',          label: 'Dev Tools',           path: '/dev-tools',                icon: IconDevTools, moroniOnly: true },
];

// ─── SECTION: Visibility gate (mirrors legacy Sidebar logic exactly) ───
/**
 * Decide whether a nav item should be shown for the current user.
 * @param item one of the item objects above
 * @param ctx  { canAccess, isFeatureEnabled, employee, isMoroni } from AuthContext
 */
export function isItemVisible(item, { canAccess, isFeatureEnabled, employee, isMoroni }) {
  if (!employee) return false;
  if (item.always) {
    // Help & Guides — visible to every logged-in user, not role-gated.
  } else if (item.moroniOnly) {
    if (!isMoroni) return false;
  } else if (item.adminOnly) {
    if (employee.role !== 'admin') return false;
  } else if (!canAccess(item.key)) {
    return false;
  }
  if (item.featureFlag && !isFeatureEnabled(item.featureFlag)) return false;
  return true;
}
