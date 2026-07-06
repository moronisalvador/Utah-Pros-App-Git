/**
 * ════════════════════════════════════════════════
 * FILE: settingsNav.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Settings-hub gating and plumbing shipped by Foundation behave as
 *   designed: who can see which settings pages (any-visible-child, GC3/GC8),
 *   that the five retired URLs map to the right new pages, and that the templates
 *   editor merges saved overrides over the built-in defaults correctly.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  @/lib/navItems (isSettingsItemVisible, anySettingsChildVisible,
 *              isItemVisible, SETTINGS_GROUPS), @/lib/settingsRedirects,
 *              @/pages/settings/templates/templateData (buildTemplateSections)
 *
 * NOTES / GOTCHAS:
 *   - Pure unit tests: canAccess is a fixture function per role. The
 *     "override-only supervisor" is the audit's real case — a supervisor who is
 *     NOT admin and whose only grant is a per-employee override for
 *     demo_sheet_builder — and must keep a live path into the hub.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  isSettingsItemVisible, anySettingsChildVisible, isItemVisible, SETTINGS_GROUPS,
} from '@/lib/navItems';
import { SETTINGS_REDIRECTS } from '@/lib/settingsRedirects';
import { buildTemplateSections } from '@/pages/settings/templates/templateData';

// canAccess factory: grants only the keys in the set (admin passthrough handled
// by the real AuthContext, mirrored here by granting 'settings' etc.).
const grants = (...keys) => (k) => keys.includes(k);
const NONE = () => false;

const admin      = { role: 'admin', email: 'a@utahpros.com' };
const office     = { role: 'office', email: 'o@utahpros.com' };
const supervisor = { role: 'supervisor', email: 's@utahpros.com' };
const fieldTech  = { role: 'field_tech', email: 't@utahpros.com' };
const crmPartner = { role: 'crm_partner', email: 'p@partner.com' };

describe('isSettingsItemVisible — per-item gates', () => {
  const item = (group, key) => SETTINGS_GROUPS.find(g => g.group === group).items.find(i => i.key === key);

  it('admin sees admin-only Team + Connections', () => {
    const ctx = { canAccess: grants('settings'), employee: admin, isMoroni: false };
    expect(isSettingsItemVisible(item('Team', 'team'), ctx)).toBe(true);
    expect(isSettingsItemVisible(item('Connections', 'integrations'), ctx)).toBe(true);
  });

  it('non-admin office cannot see admin-only Team', () => {
    const ctx = { canAccess: grants('settings'), employee: office, isMoroni: false };
    expect(isSettingsItemVisible(item('Team', 'team'), ctx)).toBe(false);
  });

  it('Payments (GC6) is visible to a canEditBilling role (admin) but not office/field_tech', () => {
    const payments = item('Workspace', 'payments');
    // BILLING_EDIT_ROLES = ['admin','manager']; only admin is a live enum value.
    expect(isSettingsItemVisible(payments, { canAccess: NONE, employee: admin, isMoroni: false })).toBe(true);
    expect(isSettingsItemVisible(payments, { canAccess: NONE, employee: office, isMoroni: false })).toBe(false);
    expect(isSettingsItemVisible(payments, { canAccess: NONE, employee: fieldTech, isMoroni: false })).toBe(false);
  });

  it('Personal group (GC8) is visible to EVERY employee', () => {
    const myAccount = item('Personal', 'my_account');
    for (const emp of [admin, office, supervisor, fieldTech, crmPartner]) {
      expect(isSettingsItemVisible(myAccount, { canAccess: NONE, employee: emp, isMoroni: false })).toBe(true);
    }
  });

  it('Owner group is Moroni-only', () => {
    const devTools = item('Owner', 'dev_tools');
    expect(isSettingsItemVisible(devTools, { canAccess: NONE, employee: admin, isMoroni: false })).toBe(false);
    expect(isSettingsItemVisible(devTools, { canAccess: NONE, employee: admin, isMoroni: true })).toBe(true);
  });

  it('override-only supervisor (demo_sheet_builder grant) sees Scope Sheets', () => {
    const scope = item('Workspace', 'scope_sheets');
    const ctx = { canAccess: grants('demo_sheet_builder'), employee: supervisor, isMoroni: false };
    expect(isSettingsItemVisible(scope, ctx)).toBe(true);
  });
});

describe('anySettingsChildVisible — GC3 index gate', () => {
  it('every employee has at least one visible child (via Personal group, GC8)', () => {
    for (const emp of [admin, office, supervisor, fieldTech]) {
      expect(anySettingsChildVisible({ canAccess: NONE, employee: emp, isMoroni: false })).toBe(true);
    }
  });

  it('the override-only supervisor keeps a live path even with no role grants', () => {
    // Personal alone already qualifies; the demo_sheet_builder override is extra.
    expect(anySettingsChildVisible({ canAccess: grants('demo_sheet_builder'), employee: supervisor, isMoroni: false })).toBe(true);
  });

  it('a null employee has nothing', () => {
    expect(anySettingsChildVisible({ canAccess: NONE, employee: null, isMoroni: false })).toBe(false);
  });
});

describe('NAV_ITEMS settings entry — settingsHub visibility', () => {
  const settingsEntry = { key: 'settings', settingsHub: true, hideForRoles: ['crm_partner'] };
  const ctx = (emp) => ({ canAccess: NONE, isFeatureEnabled: () => true, employee: emp, isMoroni: false });

  it('shows for staff (any-visible-child via Personal)', () => {
    expect(isItemVisible(settingsEntry, ctx(office))).toBe(true);
    expect(isItemVisible(settingsEntry, ctx(fieldTech))).toBe(true);
  });

  it('is hidden for crm_partner (hideForRoles) even though Personal would qualify', () => {
    expect(isItemVisible(settingsEntry, ctx(crmPartner))).toBe(false);
  });
});

describe('SETTINGS_REDIRECTS — the 5 permanent retired-URL redirects', () => {
  it('maps every retired route to its new IA target', () => {
    const map = Object.fromEntries(SETTINGS_REDIRECTS.map(r => [r.from, r.to]));
    expect(map).toEqual({
      'admin': '/settings/team',
      'admin/integrations': '/settings/integrations',
      'admin/demo-sheet-builder': '/settings/scope-sheets',
      'tech-feedback': '/settings/feedback',
      'payments/settings': '/settings/payments',
    });
    expect(SETTINGS_REDIRECTS).toHaveLength(5);
  });
});

describe('buildTemplateSections — templates editor mount-fetch merge', () => {
  it('falls back to the built-in default when no override row exists', () => {
    const sections = buildTemplateSections([], 'work_auth');
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toContain('Work Authorization');
    expect(sections[0].division).toBeNull();
  });

  it('merges a saved override over the default', () => {
    const rows = [{ doc_type: 'work_auth', division: null, heading: 'Custom Heading', body: 'Custom body', sort_order: 1 }];
    const sections = buildTemplateSections(rows, 'work_auth');
    expect(sections[0].heading).toBe('Custom Heading');
    expect(sections[0].body).toBe('Custom body');
  });

  it('keeps all six CoC division sections in default order', () => {
    const sections = buildTemplateSections([], 'coc');
    expect(sections).toHaveLength(6);
    expect(sections.map(s => s.division)).toEqual(['water', 'mold', 'reconstruction', 'fire', 'contents', 'remodeling']);
  });
});
