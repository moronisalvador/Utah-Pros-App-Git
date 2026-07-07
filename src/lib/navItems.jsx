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
 *   - The desktop groupings (PRIMARY_ITEMS / OVERFLOW_ITEMS) are
 *     a re-slicing of the SAME pages for the ≥1024px top-nav shell, plus
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
import { canEditBilling } from '@/lib/claimUtils';

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
export function IconHomebuilding(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/></svg>);}
export function IconCrm(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 4v5"/><path d="M8 13h3"/></svg>);}
export function IconRoadmap(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 20l-5.4 1.8a1 1 0 0 1-1.3-1V6.2a1 1 0 0 1 .7-1L9 3m0 17 6-2m-6 2V3m6 15 5.4 1.8a1 1 0 0 0 1.3-1V4.4a1 1 0 0 0-.7-1L15 1.5m0 16.5V1.5m0 0L9 3"/></svg>);}

// ─── SECTION: Settings-hub icons (grouped index + rail; F pre-adds all) ───
export function IconShield(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);}
export function IconUsers(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);}
export function IconFileText(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>);}
export function IconPercent(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>);}
export function IconCard(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>);}
export function IconClipboard(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>);}
export function IconKey(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>);}
export function IconBell(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>);}
export function IconPlug(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5"/></svg>);}
export function IconDrive(p){return(<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M7.71 3.5 1.15 15l3.43 5.94 6.56-11.37L7.71 3.5zM22.85 15 16.29 3.5H9.43l6.56 11.5h6.86zM4.93 16.06 8.36 22h11.49l-3.43-5.94H4.93z"/></svg>);}
export function IconListValues(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>);}

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

  { section: 'CRM' },
  { key: 'crm',                label: 'CRM',                path: '/crm/overview',       icon: IconCrm,          featureFlag: 'page:crm' },

  { section: 'Tools' },
  { key: 'oop_pricing',        label: 'OOP Pricing',        path: '/tools/oop-pricing',  icon: IconCalculator,   featureFlag: 'tool:oop_pricing' },

  { section: 'System' },
  // Settings Overhaul Phase F: the System section is now a SINGLE Settings entry
  // (GC5). It leads to the grouped hub (SettingsHome), so the individual
  // Admin / Scope Sheet Builder / Tech Feedback links moved inside there (their
  // old paths permanently redirect). Visibility = any-visible-child (GC3/GC8) so
  // every staff member sees it (at minimum their Personal group); crm_partner is
  // excluded (Layout's choke point locks that role to /crm/* + /help).
  { key: 'settings', label: 'Settings', path: '/settings', icon: IconSettings, settingsHub: true, hideForRoles: ['crm_partner'] },
];

// ─── SECTION: Desktop top-nav groupings (≥1024px) ───
// PRIMARY: the always-visible top bar. Labels are renamed per owner request
// (Home/Inbox/My Money/Time) but paths + nav_keys are unchanged.
export const PRIMARY_ITEMS = [
  { key: 'dashboard',     label: 'Home',      path: '/',              icon: IconDashboard,     end: true },
  { key: 'conversations', label: 'Inbox',     path: '/conversations', icon: IconConversations, badge: true },
  { key: 'schedule',      label: 'Schedule',  path: '/schedule',      icon: IconSchedule },
  { key: 'claims',        label: 'Claims',    path: '/claims',        icon: IconClaim },
  { key: 'customers',     label: 'Customers', path: '/customers',     icon: IconCustomers },
  { key: 'collections',   label: 'My Money',  path: '/collections',   icon: IconCollections,   featureFlag: 'page:collections' },
  { key: 'time_tracking', label: 'Time',      path: '/time-tracking', icon: IconTimeTracking,  featureFlag: 'page:time_tracking' },
  // Behind page:crm (dev_only_user_id = Moroni) — invisible in the always-on
  // top bar for every other employee; see CLAUDE.md "CRM Phase Workflow".
  { key: 'crm',           label: 'CRM',       path: '/crm/overview',  icon: IconCrm,           featureFlag: 'page:crm' },
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
  { key: 'homebuilding',       label: 'Homebuilding',       path: '/homebuilding',       icon: IconHomebuilding, moroniOnly: true },
  // always: true — like Help, visible to every logged-in user. Without it,
  // isItemVisible falls through to canAccess('feedback'), which no role has,
  // hiding the item from everyone (verified trap — Feedback Media Phase F).
  // hideForRoles: Layout's crm_partner choke point locks that role to
  // /crm/* + /help, so /feedback would be a dead-end link that bounces them
  // to /crm/leads.
  { key: 'feedback',           label: 'Send Feedback',      path: '/feedback',           icon: IconFeedback,   always: true, hideForRoles: ['crm_partner'] },
  // always: true — a read-only "what are we building" board every logged-in
  // employee may see (no permission key). Public no-login mirror: /roadmap/public.
  { key: 'roadmap',            label: 'Roadmap',            path: '/roadmap',            icon: IconRoadmap,    always: true, hideForRoles: ['crm_partner'] },
];

// SYSTEM_ITEMS removed by Settings Overhaul Phase F: the settings hub rail no
// longer renders a flat SYSTEM list — SettingsLayout + SettingsHome read the
// grouped SETTINGS_GROUPS above, and the old individual paths (/admin,
// /admin/integrations, /tech-feedback, /admin/demo-sheet-builder) are retired +
// permanently redirected (src/lib/settingsRedirects.js). GC4/GC5 are realized by
// the single settingsHub NAV_ITEMS entry + the adminOnly gates in SETTINGS_GROUPS.

// ─── SECTION: Settings hub — grouped index (SettingsHome + SettingsLayout rail) ───
// The Settings area's information architecture: tappable groups → routed
// sub-pages. Both SettingsHome (the /settings index) and SettingsLayout's rail
// render from this same list, so they can never drift. Each item's gate:
//   access:'settings'|'demo_sheet_builder'  → canAccess(key)
//   adminOnly:true                          → role === 'admin' (AdminRoute pages)
//   billing:true                            → canEditBilling(role) (GC6 — nav
//                                              visibility only; the page self-guards)
//   personal:true                           → every logged-in employee (GC8)
//   owner:true                              → Moroni only (Dev Tools)
export const SETTINGS_GROUPS = [
  { group: 'Workspace', description: 'Company data and documents', items: [
    { key: 'lists',        label: 'Lists & Values',     path: '/settings/lists',        description: 'Insurance carriers, referral sources, and other option-lists.', icon: IconListValues, access: 'settings' },
    { key: 'templates',    label: 'Document Templates', path: '/settings/templates',    description: 'Work auth, direction to pay, and completion docs.',  icon: IconFileText,  access: 'settings' },
    { key: 'commissions',  label: 'Commissions',        path: '/settings/commissions',  description: 'Each salesperson’s commission rate.',                icon: IconPercent,   access: 'settings' },
    { key: 'payments',     label: 'Payments',           path: '/settings/payments',     description: 'Billing, Stripe, and payout settings.',              icon: IconCard,      billing: true },
    { key: 'scope_sheets', label: 'Scope Sheets',       path: '/settings/scope-sheets', description: 'Build and publish the field Scope Sheet.',            icon: IconClipboard, access: 'demo_sheet_builder' },
  ]},
  { group: 'Team', description: 'People, roles, and access', items: [
    { key: 'team',                  label: 'Team',                 path: '/settings/team',                  description: 'Staff directory, roles, and login access.', icon: IconUsers,    adminOnly: true },
    { key: 'roles',                 label: 'Roles & Permissions',  path: '/settings/roles',                 description: 'What each role can see and edit.',           icon: IconShield,   adminOnly: true },
    { key: 'page_access',           label: 'Page Access',          path: '/settings/page-access',           description: 'Per-employee page overrides.',               icon: IconKey,      adminOnly: true },
    { key: 'notification_defaults', label: 'Notification Defaults',path: '/settings/notification-defaults', description: 'Company-wide default channels.',             icon: IconBell,     adminOnly: true },
    { key: 'feedback_inbox',        label: 'Feedback Inbox',       path: '/settings/feedback',              description: 'Bug reports and suggestions from the team.', icon: IconFeedback, adminOnly: true },
  ]},
  { group: 'Connections', description: 'Outside services', items: [
    { key: 'integrations', label: 'Integrations', path: '/settings/integrations', description: 'GitHub, QuickBooks, and API keys.', icon: IconPlug, adminOnly: true },
  ]},
  { group: 'Personal', description: 'Just for you', items: [
    { key: 'my_account',    label: 'My Account',    path: '/settings/my-account',    description: 'Your Google Drive & Calendar connection.', icon: IconDrive, personal: true },
    { key: 'notifications', label: 'Notifications', path: '/settings/notifications', description: 'How you hear about each notification.',     icon: IconBell,  personal: true },
  ]},
  { group: 'Owner', description: 'Developer tools', items: [
    { key: 'dev_tools', label: 'Dev Tools', path: '/dev-tools', description: 'Feature flags and developer utilities.', icon: IconDevTools, owner: true },
  ]},
];

/**
 * Decide whether a Settings-hub item is visible to the current user.
 * @param item one of the SETTINGS_GROUPS items
 * @param ctx  { canAccess, employee, isMoroni }
 */
export function isSettingsItemVisible(item, { canAccess, employee, isMoroni }) {
  if (!employee) return false;
  if (item.owner)     return isMoroni;
  if (item.personal)  return true;              // GC8 — every employee
  if (item.adminOnly) return employee.role === 'admin';
  if (item.billing)   return canEditBilling(employee.role); // GC6 — nav visibility
  if (item.access)    return canAccess(item.access);
  return false;
}

/** GC3 — the /settings index is reachable when ANY child item is visible. */
export function anySettingsChildVisible(ctx) {
  return SETTINGS_GROUPS.some(g => g.items.some(it => isSettingsItemVisible(it, ctx)));
}

// ─── SECTION: Visibility gate (mirrors legacy Sidebar logic exactly) ───
/**
 * Decide whether a nav item should be shown for the current user.
 * @param item one of the item objects above
 * @param ctx  { canAccess, isFeatureEnabled, employee, isMoroni } from AuthContext
 */
export function isItemVisible(item, { canAccess, isFeatureEnabled, employee, isMoroni }) {
  if (!employee) return false;
  // Role exclusion — wins over `always`. Used for links a role can SEE but
  // never REACH (e.g. crm_partner is redirected off any non-/crm, non-/help
  // path by Layout's choke point, so an always-on link would dead-end).
  if (item.hideForRoles?.includes(employee.role)) return false;
  // Settings hub — reachable when ANY child settings page is visible (GC3/GC8).
  if (item.settingsHub) {
    if (!anySettingsChildVisible({ canAccess, employee, isMoroni })) return false;
  } else if (item.always) {
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
