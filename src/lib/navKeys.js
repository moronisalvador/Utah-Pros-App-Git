/**
 * ════════════════════════════════════════════════
 * FILE: navKeys.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single master list of the "keys" the permission system uses — every page
 *   the Roles matrix and per-employee Page Access screens can grant or restrict,
 *   plus the list of employee roles and their friendly labels. These lists used
 *   to be duplicated inside Admin.jsx; centralizing them here stops the two
 *   copies from drifting apart.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a plain data module, not a screen)
 *   Rendered by:  n/a — imported by the Team & Access settings pages
 *                 (Roles / PageAccess) and any consumer that needs role labels
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - NAV_KEYS backs the Roles × page matrix (nav_permissions). PAGE_ACCESS_KEYS
 *     backs the per-employee override grid (employee_page_access). They overlap
 *     but are intentionally separate lists (different sets of grantable pages).
 *   - Keep these in sync with the real nav_key values used by canAccess() and
 *     the CRM per-screen access keys (crm_<screen>) defined in CrmLayout.
 * ════════════════════════════════════════════════
 */

// Roles × nav-key matrix (Roles & Permissions tab). Backs nav_permissions.
export const NAV_KEYS = [
  { key: 'dashboard', label: 'Dashboard', section: 'Main' },
  { key: 'overview_financials', label: 'Financial Cards (Overview)', section: 'Main' },
  { key: 'conversations', label: 'Conversations', section: 'Main' },
  { key: 'jobs', label: 'Jobs', section: 'Main' },
  { key: 'leads', label: 'Leads', section: 'Main' },
  { key: 'customers', label: 'Customers', section: 'Main' },
  { key: 'production', label: 'Production', section: 'Operations' },
  { key: 'schedule', label: 'Schedule', section: 'Operations' },
  { key: 'time_tracking', label: 'Time Tracking', section: 'Operations' },
  { key: 'marketing', label: 'Marketing', section: 'Growth' },
  // CRM per-screen roles (Phase 6b). Keys match CrmLayout's crm_<screen> access
  // keys and the feature:crm_<screen> sub-flags — defined here BEFORE page:crm
  // opens to staff so every screen has a role decision on day one.
  { key: 'crm_leads', label: 'CRM · Leads', section: 'CRM' },
  { key: 'crm_contacts', label: 'CRM · Contacts', section: 'CRM' },
  { key: 'crm_conversations', label: 'CRM · Conversations', section: 'CRM' },
  { key: 'crm_call_log', label: 'CRM · Call Log', section: 'CRM' },
  { key: 'crm_tasks', label: 'CRM · Tasks', section: 'CRM' },
  { key: 'crm_sequences', label: 'CRM · Sequences', section: 'CRM' },
  { key: 'crm_forms', label: 'CRM · Forms', section: 'CRM' },
  { key: 'crm_attribution', label: 'CRM · Attribution', section: 'CRM' },
  { key: 'crm_reports', label: 'CRM · Reports', section: 'CRM' },
  { key: 'crm_campaigns', label: 'CRM · Campaigns', section: 'CRM' },
  { key: 'crm_integrations', label: 'CRM · Integrations', section: 'CRM' },
  { key: 'crm_settings', label: 'CRM · Settings', section: 'CRM' },
  { key: 'admin_panel', label: 'Admin', section: 'System' },
  { key: 'settings', label: 'Settings', section: 'System' },
];

// Per-employee override grid (Page Access tab). Backs employee_page_access.
export const PAGE_ACCESS_KEYS = [
  { key: 'dashboard',           label: 'Dashboard',           section: 'Main' },
  { key: 'overview_financials', label: 'Financial Cards (Overview)', section: 'Main' },
  { key: 'conversations',       label: 'Conversations',       section: 'Main' },
  { key: 'claims',             label: 'Claims',             section: 'Main' },
  { key: 'jobs',               label: 'Jobs',               section: 'Main' },
  { key: 'production',         label: 'Production',         section: 'Main' },
  { key: 'customers',          label: 'Customers',          section: 'Main' },
  { key: 'schedule',           label: 'Schedule',           section: 'Operations' },
  { key: 'schedule_templates', label: 'Schedule Templates', section: 'Operations' },
  { key: 'time_tracking',      label: 'Time Tracking',      section: 'Operations' },
  { key: 'collections',        label: 'Collections',        section: 'Operations' },
  { key: 'leads',              label: 'Leads',              section: 'Operations' },
  { key: 'marketing',          label: 'Marketing',          section: 'Growth' },
  // CRM per-screen overrides (Phase 6b) — grant/revoke an individual employee
  // access to a single CRM screen. Backs canAccess('crm_<screen>') in CrmLayout.
  { key: 'crm_leads',          label: 'CRM · Leads',          section: 'CRM' },
  { key: 'crm_contacts',       label: 'CRM · Contacts',       section: 'CRM' },
  { key: 'crm_conversations',  label: 'CRM · Conversations',  section: 'CRM' },
  { key: 'crm_call_log',       label: 'CRM · Call Log',       section: 'CRM' },
  { key: 'crm_tasks',          label: 'CRM · Tasks',          section: 'CRM' },
  { key: 'crm_sequences',      label: 'CRM · Sequences',      section: 'CRM' },
  { key: 'crm_forms',          label: 'CRM · Forms',          section: 'CRM' },
  { key: 'crm_attribution',    label: 'CRM · Attribution',    section: 'CRM' },
  { key: 'crm_reports',        label: 'CRM · Reports',        section: 'CRM' },
  { key: 'crm_campaigns',      label: 'CRM · Campaigns',      section: 'CRM' },
  { key: 'crm_integrations',   label: 'CRM · Integrations',   section: 'CRM' },
  { key: 'crm_settings',       label: 'CRM · Settings',       section: 'CRM' },
];

export const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'office', label: 'Office' },
  { key: 'project_manager', label: 'Project Manager' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'field_tech', label: 'Field Tech' },
  { key: 'crm_partner', label: 'CRM Partner (external)' },
];

const ROLE_MAP = Object.fromEntries(ROLES.map(r => [r.key, r.label]));

/** Friendly label for a role key (falls back to the raw key). */
export function roleLabel(role) {
  return ROLE_MAP[role] || role;
}
