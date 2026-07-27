/**
 * ════════════════════════════════════════════════
 * FILE: notification-read-recipient-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the S1g notification read/recipient boundary visible in credential-free
 *   CI. It checks source intent only and never connects to Supabase, reads a
 *   notification row, marks anything read, or opens a Realtime subscription.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  S1g migration, rollback, catalog checks, isolated behavior proof,
 *              NotificationBell, and shared Realtime subscription
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - Applied database behavior and Realtime delivery remain separate,
 *     owner-authorized apply-window gates.
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20260726260000_notification_read_recipient_boundary.sql',
);
const rollback = read(
  'supabase/rollbacks/20260726260000_notification_read_recipient_boundary.rollback.sql',
);
const preflight = read(
  'supabase/tests/notification_read_recipient_boundary_preflight.sql',
);
const postApply = read(
  'supabase/tests/notification_read_recipient_boundary_post_apply.sql',
);
const isolated = read(
  'supabase/tests/notification_read_recipient_boundary_isolated.sql',
);
const isolatedWrapper = read(
  'supabase/tests/notification_read_recipient_boundary.test.sql',
);
const localDbRunner = read('scripts/qa/run-local-db-tests.mjs');
const identityConsumers = [migration, preflight, postApply, isolated];
const bell = read('src/components/NotificationBell.jsx');
const realtime = read('src/lib/realtime.js');
const executable = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');
const md5 = (value) => createHash('md5').update(value).digest('hex');
const extractAuthoredBody = (name) => {
  const match = migration.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?`
      + 'AS \\$function\\$(\\n[\\s\\S]*?\\n)\\$function\\$;',
  ));
  expect(match, `authored body for ${name}`).not.toBeNull();
  return match[1];
};
const authoredFunctions = [
  {
    name: 'get_notifications',
    identity: 'public.get_notifications(integer,uuid)',
    canonicalArguments:
      'p_limit integer DEFAULT 30, p_employee_id uuid DEFAULT NULL::uuid',
    result: 'SETOF notifications',
    bodyMd5: 'fefa4b58a7cf9faaae6d235c98faa1d6',
    definitionMd5: 'a9d0da79befb2d2cb2a3e5452d3c6269',
  },
  {
    name: 'get_unread_notification_count',
    identity: 'public.get_unread_notification_count(uuid)',
    canonicalArguments: 'p_employee_id uuid DEFAULT NULL::uuid',
    result: 'integer',
    bodyMd5: '2b8706a1ff85ab821c44e084f66bc998',
    definitionMd5: '8bd9df112ee1a6a7ff9f5c18789142d8',
  },
  {
    name: 'mark_all_notifications_read',
    identity: 'public.mark_all_notifications_read(uuid)',
    canonicalArguments: 'p_employee_id uuid DEFAULT NULL::uuid',
    result: 'void',
    bodyMd5: '17535104ecaa23b9eb98c9192921cf05',
    definitionMd5: 'd954d04ad3e3fe2ead30ec3e9d8bfbf7',
  },
  {
    name: 'mark_notification_read',
    identity: 'public.mark_notification_read(uuid)',
    canonicalArguments: 'p_id uuid',
    result: 'void',
    bodyMd5: 'cbe82dd0652029a881944527e99b9091',
    definitionMd5: '868d6fd6e3a5278d152860318753805f',
  },
];
const canonicalDefinition = (contract, body) =>
  `CREATE OR REPLACE FUNCTION public.${contract.name}(${contract.canonicalArguments})\n`
  + ` RETURNS ${contract.result}\n`
  + ' LANGUAGE plpgsql\n'
  + ' SECURITY DEFINER\n'
  + " SET search_path TO 'public'\n"
  + `AS $function$${body}$function$\n`;

describe('S1g notification read/recipient boundary', () => {
  it('preserves every deployed RPC identity, default, result, and caller shape', () => {
    const sql = executable(migration);
    for (const identity of [
      'public.get_notifications(integer,uuid)',
      'public.get_unread_notification_count(uuid)',
      'public.mark_notification_read(uuid)',
      'public.mark_all_notifications_read(uuid)',
    ]) {
      expect(migration).toContain(identity);
      expect(rollback).toContain(identity);
    }

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_notifications\( p_limit integer DEFAULT 30, p_employee_id uuid DEFAULT NULL::uuid \) RETURNS SETOF public\.notifications/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_unread_notification_count\( p_employee_id uuid DEFAULT NULL::uuid \) RETURNS integer/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.mark_notification_read\(p_id uuid\) RETURNS void/i,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.mark_all_notifications_read\( p_employee_id uuid DEFAULT NULL::uuid \) RETURNS void/i,
    );
    expect(sql).not.toMatch(/\bDROP FUNCTION\b/i);
    expect(sql).toContain(
      'ORDER BY notification.created_at DESC LIMIT greatest(1, least(p_limit, 100));',
    );

    expect(bell).toContain(
      "rpc('get_unread_notification_count', { p_employee_id: empRef.current })",
    );
    expect(bell).toContain(
      "rpc('get_notifications', { p_limit: 30, p_employee_id: empRef.current })",
    );
    expect(bell).toContain(
      "rpc('mark_notification_read', { p_id: item.id })",
    );
    expect(bell).toContain(
      "rpc('mark_all_notifications_read', { p_employee_id: empRef.current })",
    );
  });

  it('reconstructs active internal callers and rejects foreign recipient selectors', () => {
    expect(migration.match(/employee\.auth_user_id = \(SELECT auth\.uid\(\)\)/g))
      .toHaveLength(5);
    expect(migration.match(/employee\.is_active = true/g)).toHaveLength(5);
    expect(migration.match(/employee\.is_external = false/g)).toHaveLength(5);
    expect(migration.match(/p_employee_id <> v_actor/g)).toHaveLength(3);
    expect(migration).toContain(
      "COALESCE((SELECT auth.jwt() ->> 'role' = 'service_role'), false)",
    );
    expect(migration.match(/IF v_is_service_role THEN/g)).toHaveLength(4);
    expect(migration).not.toMatch(/\bauth\.role\s*\(/i);
    expect(migration).toContain(
      "'NOT_AUTHORIZED: notification recipient mismatch'",
    );

    const sql = executable(migration);
    for (const identity of [
      'public.get_notifications(integer, uuid)',
      'public.get_unread_notification_count(uuid)',
      'public.mark_notification_read(uuid)',
      'public.mark_all_notifications_read(uuid)',
    ]) {
      expect(sql).toContain(
        `REVOKE EXECUTE ON FUNCTION ${identity} FROM PUBLIC, anon;`,
      );
      expect(sql).toContain(
        `GRANT EXECUTE ON FUNCTION ${identity} TO authenticated, service_role;`,
      );
    }
  });

  it('uses private per-employee receipts without resurfacing legacy broadcasts', () => {
    const sql = executable(migration);
    expect(sql).toContain('CREATE TABLE public.notification_reads');
    expect(sql).toContain(
      'PRIMARY KEY (notification_id, employee_id)',
    );
    expect(sql).toContain(
      'ALTER TABLE public.notification_reads FORCE ROW LEVEL SECURITY;',
    );
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.notification_reads FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(sql).not.toMatch(
      /CREATE POLICY [^;]+ ON public\.notification_reads/i,
    );
    expect(sql).toContain(
      'THEN COALESCE(notification.read_at, receipt.read_at)',
    );
    expect(sql).toContain(
      'ON CONFLICT (notification_id, employee_id) DO NOTHING;',
    );
    expect(sql).toContain(
      'WHERE notification.recipient_id IS NULL AND notification.read_at IS NULL',
    );
    expect(migration).toContain(
      'FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE',
    );
    expect(migration).toContain(
      'FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE',
    );
    expect(migration).toContain(
      'CREATE INDEX notification_reads_employee_id_idx ON public.notification_reads USING btree (employee_id)',
    );
    expect(migration).toContain('5ae62afd8335deffffb81c9aa98f62be');

    for (const contract of authoredFunctions) {
      const body = extractAuthoredBody(contract.name);
      expect(md5(body)).toBe(contract.bodyMd5);
      expect(md5(canonicalDefinition(contract, body)))
        .toBe(contract.definitionMd5);

      for (const guard of [migration, rollback, postApply]) {
        const offsets = [...guard.matchAll(new RegExp(
          `'${contract.identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`,
          'g',
        ))].map((match) => match.index);
        const hasExactGuard = offsets.some((offset) => {
          const guardedContract = guard.slice(offset, offset + 700);
          return guardedContract.includes(`'${contract.bodyMd5}'`)
            && guardedContract.includes(`'${contract.definitionMd5}'`);
        });
        expect(hasExactGuard, `${contract.identity} exact guarded hash pair`)
          .toBe(true);
      }
    }
  });

  it('moves direct-table and Realtime payload authorization into RLS', () => {
    const sql = executable(migration);
    expect(sql).toContain(
      'ALTER POLICY notifications_select ON public.notifications TO authenticated USING ( EXISTS',
    );
    expect(sql).toContain(
      'notifications.recipient_id IS NULL OR notifications.recipient_id = employee.id',
    );
    expect(sql).toContain(
      'DROP POLICY notifications_delete_testrows ON public.notifications;',
    );
    expect(sql).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.notifications FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).toContain(
      'GRANT SELECT ON TABLE public.notifications TO authenticated;',
    );
    expect(migration).not.toMatch(
      /DROP POLICY notifications_select/i,
    );
    expect(migration).toContain('supabase_realtime');
    expect(migration).toContain('f6a4b946f6d65eadf3bf4764e734d5b1');
    expect(migration).toContain('c821903bc39dd59e6ac6b60d039a731d');
    for (const sqlSource of identityConsumers) {
      expect(sqlSource).toContain(
        "migration.name = 'mobile_employee_identity_containment'",
      );
      expect(sqlSource).toContain('employees_self_identity_read');
      expect(sqlSource).toContain('(auth_user_id = auth.uid())');
      expect(sqlSource).not.toContain(
        "migration.name = 'mobile_employee_identity_authority'",
      );
      expect(sqlSource).not.toContain('allow_authenticated_employees');
      expect(sqlSource).not.toContain('allow_anon_read_employees');
      expect(sqlSource).toContain('MAINTAIN');
      expect(sqlSource).toContain('attacl');
      expect(sqlSource).toContain('acl.grantor <> relation.relowner');
      expect(sqlSource).toContain("grantee_role.rolname = 'anon'");
      expect(sqlSource).toContain("grantee_role.rolname = 'authenticated'");
      expect(sqlSource).toContain("acl.privilege_type = 'SELECT'");
      expect(sqlSource).toContain(
        "ARRAY['auth_user_id', 'id', 'is_active', 'role']::text[]",
      );
      expect(sqlSource).toContain('ARRAY[]::text[]');
    }
    for (const sqlSource of [migration, rollback, preflight, postApply]) {
      expect(sqlSource).toContain(
        "to_regclass('public.notifications')",
      );
      expect(sqlSource).toContain(
        "to_regclass('public.notification_reads')",
      );
      expect(sqlSource).toContain('pg_attribute');
      expect(sqlSource).toContain('pg_publication_rel');
      expect(sqlSource).toContain('puballtables');
    }
    expect(executable(migration)).not.toMatch(/\b(?:BEGIN|COMMIT)\s*;/i);

    // Existing client filtering remains a second check, not the primary boundary.
    expect(realtime).toContain("table: 'notifications'");
    expect(bell).toContain(
      'if (row && row.recipient_id && row.recipient_id !== empRef.current) return;',
    );
  });

  it('ships non-invoking catalog checks and an isolated rollback-only behavior proof', () => {
    for (const sql of [preflight, postApply]) {
      const code = executable(sql);
      const codeWithoutStringLiterals = code.replace(/'(?:''|[^'])*'/g, "''");
      expect(codeWithoutStringLiterals).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i,
      );
      expect(code).not.toMatch(
        /\b(?:PERFORM|CALL)\s+(?:public\.)?(?:get_notifications|get_unread_notification_count|mark_notification_read|mark_all_notifications_read)\s*\(/i,
      );
      expect(code).not.toMatch(
        /\bFROM\s+public\.(?:notifications|notification_reads)\b/i,
      );
    }

    expect(isolated).toMatch(/ISOLATED DATABASE ONLY/);
    expect(isolated).toMatch(/NEVER run this behavior script against the shared/i);
    expect(isolated).toContain('\\if :{?UPR_ISOLATED_DB}');
    expect(isolated).toContain(
      "current_setting('upr.isolated_test_database', true)",
    );
    expect(isolated).toContain("IS DISTINCT FROM 'on'");
    expect(isolated).toContain('\\quit 2');
    expect(isolated).toContain('SET LOCAL ROLE authenticated;');
    expect(isolated).toContain('SET LOCAL ROLE service_role;');
    expect(isolated).toContain('S1g isolated service list compatibility failed');
    expect(isolated).toContain(
      'S1g isolated authenticated own-target mark-one failed',
    );
    expect(isolated).toContain(
      'S1g isolated default/explicit-null list scope failed',
    );
    expect(isolated).toContain(
      'S1g isolated default/explicit-null count mismatch',
    );
    expect(isolated).toContain(
      'v_default_before - v_default_after IS DISTINCT FROM 1',
    );
    expect(isolated).toContain(
      'S1g isolated authenticated direct receipt read was accepted',
    );
    expect(isolated).toContain("EXCEPTION WHEN SQLSTATE '42501'");
    expect(isolated).toContain('ROLLBACK;');
    expect(executable(isolated)).not.toMatch(/\bCOMMIT\b/i);

    expect(isolatedWrapper).toContain('\\set UPR_ISOLATED_DB 1');
    expect(isolatedWrapper).toContain(
      '\\ir notification_read_recipient_boundary_isolated.sql',
    );
    expect(isolatedWrapper.indexOf('\\ir notification_read_recipient_boundary_isolated.sql'))
      .toBeLessThan(isolatedWrapper.indexOf('SELECT plan(1);'));
    expect(localDbRunner).toContain(
      "'supabase/tests/notification_read_recipient_boundary.test.sql'",
    );
    expect(localDbRunner).toContain("'--local'");
    expect(localDbRunner).toContain(
      "PGOPTIONS: '-cupr.isolated_test_database=on'",
    );
    expect(localDbRunner).not.toContain("'--linked'");
    expect(localDbRunner).not.toContain("'--db-url'");
    expect(existsSync(join(
      root,
      'supabase/tests/notify_foundation.test.js',
    ))).toBe(false);
  });

  it('guards rollback fidelity and makes unsafe receipt loss explicit', () => {
    expect(rollback).toContain(
      "current_setting('upr.allow_unsafe_s1g_rollback', true)",
    );
    expect(rollback).toMatch(/reopens cross-recipient notification reads/i);
    expect(rollback).toMatch(/drops every[\s\S]*per-employee broadcast receipt/i);
    expect(rollback).toContain(
      "ALTER POLICY notifications_select\n  ON public.notifications\n  TO authenticated\n  USING (true);",
    );
    expect(rollback).toContain('CREATE POLICY notifications_delete_testrows');
    expect(rollback).toContain('DROP TABLE public.notification_reads;');
    expect(rollback).toContain('a66659f2c54bc0b7bdc2b60949fdb883');
    expect(rollback).toContain('b15c8a180f65586d6bd3c4f75d1c6f9e');
    expect(rollback).toContain('4ba9b450a720c65bb2149d45f6ea53f1');
    expect(rollback).toContain('389254cd40d74bdec30f23c7ebeb498e');
    expect(rollback).toContain('5ae62afd8335deffffb81c9aa98f62be');
    expect(rollback).toContain('f6a4b946f6d65eadf3bf4764e734d5b1');
    expect(rollback).toContain('c821903bc39dd59e6ac6b60d039a731d');
    expect(rollback).toContain('30224ec8c0a49e4f2e7a8e23544660ed');
    expect(rollback).toContain('acl.grantor <> relation.relowner');
    expect(rollback).toContain('attacl');
    expect(executable(rollback)).toContain(
      'GRANT ALL PRIVILEGES ON TABLE public.notifications TO authenticated, service_role;',
    );
    expect(executable(rollback)).not.toContain(
      'GRANT ALL PRIVILEGES ON TABLE public.notifications TO anon, authenticated, service_role;',
    );
    expect(rollback).toMatch(/historical anon table grant is intentionally not restored/i);
  });
});
