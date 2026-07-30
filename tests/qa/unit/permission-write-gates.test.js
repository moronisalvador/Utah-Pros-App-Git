/**
 * ════════════════════════════════════════════════
 * FILE: permission-write-gates.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the permission-hardening migration as text and checks it still closes
 *   BOTH doors into the permission system — the helper functions and the tables
 *   themselves. Closing only one is the failure mode this guards against: if a
 *   later edit drops the table policies but keeps the function gates, any
 *   employee can write the tables directly again and the gate becomes theatre.
 *
 *   It also checks the one mistake that would break the app for everyone: the
 *   navigation menu reads nav_permissions, and that table has no authenticated
 *   read policy of its own, so replacing its always-true policy without adding
 *   one would blank the nav for every non-admin.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260726220000_permission_write_gates.sql
 *              supabase/rollbacks/20260726220000_permission_write_gates.rollback.sql
 *   Data:      reads  → migration + rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Proves INTENT, not EFFECT (close-out-standard.md step 2b).
 *   - Assertions read comment-stripped SQL: these headers quote live policy
 *     names in their evidence blocks, and a whole-file match would pass on prose.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIG = join(ROOT, 'supabase/migrations/20260726220000_permission_write_gates.sql');
const RB = join(ROOT, 'supabase/rollbacks/20260726220000_permission_write_gates.rollback.sql');

const code = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

const GATED_FUNCTIONS = [
  'upsert_permission',
  'upsert_employee_page_access',
  'delete_employee_page_access',
  'delete_feature_flag',
];

describe('permission write gates — both doors', () => {
  const sql = code(MIG);

  it('ships with a rollback', () => {
    expect(existsSync(MIG)).toBe(true);
    expect(existsSync(RB)).toBe(true);
  });

  it('defines the shared admin predicate as a STABLE definer with pinned search_path', () => {
    expect(sql).toContain('create or replace function public.is_active_internal_admin()');
    expect(sql).toContain('stable');
    expect(sql).toContain("set search_path to 'public'");
  });

  it('the predicate excludes inactive, external, and non-admin callers', () => {
    const fn = sql.slice(sql.indexOf('is_active_internal_admin()'));
    const body = fn.slice(0, fn.indexOf('$function$;'));
    expect(body).toContain('e.auth_user_id = auth.uid()');
    expect(body).toContain('e.is_active');
    expect(body).toContain('not e.is_external');
    expect(body).toContain("e.role::text = 'admin'");
  });

  it('DOOR 1 — replaces every always-true write policy', () => {
    for (const p of [
      'nav_permissions_auth_all',
      'auth_write_employee_page_access',
      'auth_write_flags',
    ]) {
      expect(sql).toContain(`drop policy if exists ${p}`);
    }
    for (const p of [
      'nav_permissions_admin_write',
      'employee_page_access_admin_write',
      'feature_flags_admin_write',
    ]) {
      expect(sql).toContain(`create policy ${p}`);
    }
    // Every new write policy must carry the predicate on BOTH sides.
    const writes = sql.split('create policy').filter((s) => s.includes('_admin_write'));
    expect(writes).toHaveLength(3);
    for (const w of writes) {
      expect(w).toContain('using (public.is_active_internal_admin())');
      expect(w).toContain('with check (public.is_active_internal_admin())');
    }
  });

  it('DOOR 2 — gates every function, including BOTH upsert_feature_flag overloads', () => {
    for (const fn of GATED_FUNCTIONS) {
      expect(sql).toContain(`create or replace function public.${fn}`);
    }
    // The two overloads differ only by the trailing p_force_disabled argument.
    const overloads = sql.split('create or replace function public.upsert_feature_flag').length - 1;
    expect(overloads).toBe(2);

    // One authorization check per gated body: 4 named + 2 overloads = 6.
    const guards = sql.split('not_authorized: admin only').length - 1;
    expect(guards).toBe(6);
  });

  it('lets service_role through so a Worker or seed path is not broken', () => {
    const bypasses = sql.split("auth.role() <> 'service_role'").length - 1;
    expect(bypasses).toBe(6);
  });

  it('stops trusting the caller-supplied actor id', () => {
    // p_updated_by is spoofable; the real employee is resolved from auth.uid().
    expect(sql).toContain('select e.id into v_actor from employees e where e.auth_user_id = auth.uid()');
    expect(sql).toContain('coalesce(v_actor, p_updated_by)');
  });

  it('⚠️ keeps nav_permissions readable by non-admins (or the nav menu breaks)', () => {
    // nav_permissions has NO authenticated SELECT policy of its own — reads were
    // served by the always-true policy being dropped. Without this, every
    // non-admin loses their navigation.
    expect(sql).toContain('create policy nav_permissions_auth_read');
    expect(sql).toContain('for select to authenticated using (true)');
  });

  it('does not touch the pre-login bootstrap read policies', () => {
    // database-standard.md §2: these serve the logged-out bootstrap.
    for (const p of ['anon_read_flags', 'anon_read_employee_page_access', 'nav_permissions_anon_read']) {
      expect(sql).not.toContain(`drop policy if exists ${p}`);
    }
  });

  it('0e — makes crm_partner read-only on exactly the two reviewed nav keys', () => {
    // Scoped deliberately. An unscoped data fix would do MORE than what was
    // signed off if a new crm_partner edit row appeared between evidence
    // capture and the apply window — on a shared production database that gap
    // is real, and a data change must perform exactly the reviewed change.
    expect(sql).toContain('update public.nav_permissions set can_edit = false');
    expect(sql).toContain("where role = 'crm_partner' and can_edit = true and nav_key in ('crm', 'settings')");
  });
});

describe('permission write gates — rollback', () => {
  const rb = code(RB);

  it('restores all three always-true write policies', () => {
    for (const p of ['nav_permissions_auth_all', 'auth_write_employee_page_access', 'auth_write_flags']) {
      expect(rb).toContain(`create policy ${p}`);
    }
  });

  it('restores ungated bodies and drops the helper last', () => {
    expect(rb).not.toContain('not_authorized: admin only');
    expect(rb).toContain('drop function if exists public.is_active_internal_admin()');
    // The policies reference the helper, so it must be dropped after them.
    expect(rb.indexOf('drop policy if exists nav_permissions_admin_write'))
      .toBeLessThan(rb.indexOf('drop function if exists public.is_active_internal_admin()'));
  });

  it('deliberately does NOT re-grant crm_partner edit access', () => {
    expect(rb).not.toContain("set can_edit = true");
  });
});
