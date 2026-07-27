/**
 * ════════════════════════════════════════════════
 * FILE: notification-control-gates.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the three notification-settings operations still require an
 *   admin.
 *
 *   These were found by review, not by us, and they matter because two other
 *   changes in the same batch make promises that are FALSE without them: one
 *   claims inbound-text email "cannot be switched back on later", and another
 *   routes system-health alerts to the owner. Both could be trivially undone by
 *   any logged-in employee through these three functions.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260726250000_notification_control_gates.sql
 *              + its rollback
 *   Data:      reads  → migration source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Proves INTENT, not EFFECT (close-out-standard.md step 2b).
 *   - Depends on is_active_internal_admin() from 20260726220000; a test asserts
 *     the dependency is documented, because applying this one alone would fail.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIG = join(ROOT, 'supabase/migrations/20260726250000_notification_control_gates.sql');
const RB = join(ROOT, 'supabase/rollbacks/20260726250000_notification_control_gates.rollback.sql');

const raw = (p) => readFileSync(p, 'utf8').toLowerCase();
const code = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

const GATED = [
  'set_notification_default',
  'set_employee_notification_override',
  'delete_employee_notification_override',
];

describe('notification control gates', () => {
  const sql = code(MIG);

  it('ships with a rollback', () => {
    expect(existsSync(MIG)).toBe(true);
    expect(existsSync(RB)).toBe(true);
  });

  it('gates all three functions', () => {
    for (const fn of GATED) {
      expect(sql).toContain(`create or replace function public.${fn}`);
    }
    expect(sql.split('not_authorized: admin only').length - 1).toBe(3);
    expect(sql.split("auth.role() <> 'service_role'").length - 1).toBe(3);
  });

  it('closes the door that would undo the inbound-text email change', () => {
    // 20260726211000 claims email "cannot be switched back on later". That claim
    // is only true while set_notification_default is gated.
    const fn = sql.slice(sql.indexOf('create or replace function public.set_notification_default'));
    expect(fn.slice(0, fn.indexOf('$function$;'))).toContain('not_authorized: admin only');
  });

  it('closes the door that would mute the owner\'s ops alerts', () => {
    // p_employee_id names ANOTHER person. Ungated, anyone could silence the very
    // recipient 20260726193000 routes system-health alerts to.
    for (const fn of ['set_employee_notification_override', 'delete_employee_notification_override']) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}`));
      expect(body.slice(0, body.indexOf('$function$;'))).toContain('not_authorized: admin only');
    }
  });

  it('stops trusting the caller-supplied actor id', () => {
    expect(sql).toContain('select e.id into v_actor from public.employees e where e.auth_user_id = auth.uid()');
    expect(sql).toContain('coalesce(v_actor, p_actor_id)');
  });

  it('revokes EXECUTE from PUBLIC/anon before granting, for all three', () => {
    for (const fn of GATED) {
      const revokeAt = sql.indexOf(`revoke execute on function public.${fn}`);
      const grantAt = sql.indexOf(`grant execute on function public.${fn}`);
      expect(revokeAt).toBeGreaterThan(-1);
      expect(grantAt).toBeGreaterThan(revokeAt);
    }
  });

  it('keeps every signature and pins search_path', () => {
    expect(sql).toContain('set_notification_default( p_role text, p_type_key text, p_channel text, p_enabled boolean, p_user_customizable boolean default null::boolean )');
    expect(sql).toContain('set_employee_notification_override( p_employee_id uuid, p_type_key text, p_channel text, p_enabled boolean, p_actor_id uuid default null::uuid )');
    expect(sql).toContain('delete_employee_notification_override( p_employee_id uuid, p_type_key text, p_channel text )');
    expect(sql.split("set search_path to 'public'").length - 1).toBe(3);
  });

  it('documents its dependency on the helper from 20260726220000', () => {
    // Applying this alone would fail: is_active_internal_admin() would not exist.
    expect(raw(MIG)).toContain('20260726220000');
    expect(raw(MIG)).toContain('is_active_internal_admin');
  });

  it('changes no table, policy or data at the migration level', () => {
    // Strip the function bodies first: they legitimately contain INSERT/DELETE,
    // that being what these functions do. What must not appear is DDL or DML
    // OUTSIDE a body — that would mean this migration alters schema or data
    // rather than only re-defining three functions.
    const outsideBodies = sql.split(/\$function\$/).filter((_, i) => i % 2 === 0).join(' ');
    for (const forbidden of [
      'create table', 'alter table', 'drop table',
      'create policy', 'drop policy', 'create index',
      'insert into', 'delete from', 'update public.',
    ]) {
      expect(outsideBodies).not.toContain(forbidden);
    }
  });
});

describe('notification control gates — rollback', () => {
  const rb = code(RB);

  it('restores all three ungated bodies', () => {
    expect(rb).not.toContain('not_authorized: admin only');
    for (const fn of GATED) {
      expect(rb).toContain(`create or replace function public.${fn}`);
    }
  });

  it('restores the original LANGUAGE sql on the delete function', () => {
    const fn = rb.slice(rb.indexOf('create or replace function public.delete_employee_notification_override'));
    expect(fn.slice(0, fn.indexOf('$function$'))).toContain('language sql');
  });

  it('says plainly which doors it re-opens', () => {
    expect(raw(RB)).toContain('re-opens both doors');
  });
});
