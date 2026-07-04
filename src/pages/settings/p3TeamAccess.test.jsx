/**
 * ════════════════════════════════════════════════
 * FILE: p3TeamAccess.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Unit tests for the small pure helpers that back the Settings › Team and
 *   Page Access screens (Settings Overhaul P3). It checks the two-click "arm
 *   then confirm" delete logic, the "have you changed anything?" dirty check on
 *   the employee editor, and the per-employee effective-access calculation.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  @/pages/settings/Team, @/pages/settings/PageAccess (helper exports)
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - vitest runs in plain node here (no jsdom). The page modules transitively
 *     import the Supabase realtime client, which validates its URL at import
 *     time, so we seed VITE_SUPABASE_* env before a dynamic import — same trick
 *     the pages would get from Vite's real env in the browser.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';

let Team, PageAccess;

beforeAll(async () => {
  import.meta.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
  import.meta.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
  Team = await import('@/pages/settings/Team.jsx');
  PageAccess = await import('@/pages/settings/PageAccess.jsx');
});

describe('Team — two-click delete arm/execute', () => {
  it('first click on an unarmed row arms it (no execute)', () => {
    expect(Team.nextDeleteConfirm(null, 'emp-1')).toEqual({ armed: 'emp-1', execute: false });
  });

  it('second click on the armed row executes and disarms', () => {
    expect(Team.nextDeleteConfirm('emp-1', 'emp-1')).toEqual({ armed: null, execute: true });
  });

  it('clicking a different row re-arms on that row instead of executing', () => {
    expect(Team.nextDeleteConfirm('emp-1', 'emp-2')).toEqual({ armed: 'emp-2', execute: false });
  });
});

describe('Team — employee editor dirty check', () => {
  const emp = {
    id: 'e1', full_name: 'Jane Doe', display_name: 'Jane', email: 'jane@utahpros.com',
    phone: '801-555-1212', role: 'office', hourly_rate: 25, overtime_rate: 37.5, is_external: false,
  };
  const formFrom = (e) => ({
    full_name: e?.full_name || '', display_name: e?.display_name || '', email: e?.email || '',
    phone: e?.phone || '', role: e?.role || 'field_tech', hourly_rate: e?.hourly_rate ?? '',
    overtime_rate: e?.overtime_rate ?? '', is_external: e?.is_external ?? false, password: '',
  });

  it('an unchanged edit form is not dirty', () => {
    expect(Team.employeeFormDirty(formFrom(emp), emp)).toBe(false);
  });

  it('changing a field marks it dirty', () => {
    expect(Team.employeeFormDirty({ ...formFrom(emp), phone: '801-555-0000' }, emp)).toBe(true);
  });

  it('typing a password marks it dirty even when nothing else changed', () => {
    expect(Team.employeeFormDirty({ ...formFrom(emp), password: 'newpass' }, emp)).toBe(true);
  });

  it('a fresh Add-employee form (no employee) is not dirty until touched', () => {
    expect(Team.employeeFormDirty(formFrom(null), null)).toBe(false);
    expect(Team.employeeFormDirty({ ...formFrom(null), full_name: 'New Hire' }, null)).toBe(true);
  });

  it('treats numeric and string rates equivalently (no false-dirty)', () => {
    expect(Team.employeeFormDirty({ ...formFrom(emp), hourly_rate: '25' }, emp)).toBe(false);
  });
});

describe('PageAccess — effective access computation', () => {
  it('with no override, effective = role default and source is role', () => {
    const r = PageAccess.computeAccess({}, { jobs: true }, 'jobs');
    expect(r).toMatchObject({ hasOverride: false, roleDefault: true, effective: true, source: 'role' });
  });

  it('an ON override wins over a false role default', () => {
    const r = PageAccess.computeAccess({ jobs: true }, { jobs: false }, 'jobs');
    expect(r).toMatchObject({ hasOverride: true, overrideVal: true, effective: true, source: 'override_on' });
  });

  it('an OFF override wins over a true role default', () => {
    const r = PageAccess.computeAccess({ jobs: false }, { jobs: true }, 'jobs');
    expect(r).toMatchObject({ hasOverride: true, overrideVal: false, effective: false, source: 'override_off' });
  });

  it('missing role permission is treated as no access', () => {
    const r = PageAccess.computeAccess({}, {}, 'jobs');
    expect(r).toMatchObject({ hasOverride: false, roleDefault: false, effective: false });
  });
});
