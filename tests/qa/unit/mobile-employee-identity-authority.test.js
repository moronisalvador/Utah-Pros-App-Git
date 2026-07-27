/**
 * ════════════════════════════════════════════════
 * FILE: mobile-employee-identity-authority.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the employee boundary split into two safe release steps. It proves the
 *   first migration adds replacement reads without revoking old clients, while
 *   the later migration removes broad browser access and protects pay,
 *   commissions, and account authority.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  both employee identity migrations and rollbacks, guarded SQL
 *              behavior proof, browser callers, and admin employee Worker
 *   Data:      reads → repository source only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is CI-visible source-intent evidence, not applied database proof.
 *   - The two migrations require separate compatibility/apply windows.
 * ════════════════════════════════════════════════
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import {
  dirname,
  extname,
  join,
  relative,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const paths = {
  additive:
    'supabase/migrations/20260726180000_mobile_employee_identity_authority.sql',
  containment:
    'supabase/migrations/20260726182000_mobile_employee_identity_containment.sql',
  additiveRollback:
    'supabase/rollbacks/20260726180000_mobile_employee_identity_authority.rollback.sql',
  containmentRollback:
    'supabase/rollbacks/20260726182000_mobile_employee_identity_containment.rollback.sql',
  isolated: 'supabase/tests/mobile_employee_identity_authority_isolated.sql',
  wrapper: 'supabase/tests/mobile_employee_identity_authority.test.sql',
  localDbRunner: 'scripts/qa/run-local-db-tests.mjs',
  authContext: 'src/contexts/AuthContext.jsx',
  directoryHelper: 'src/lib/employeeDirectory.js',
  conversations: 'src/pages/Conversations.jsx',
  techThread: 'src/pages/tech/v2/messages/useThread.js',
  team: 'src/pages/settings/Team.jsx',
  commissions: 'src/pages/settings/Commissions.jsx',
  adminUsers: 'functions/api/admin-users.js',
};

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const source = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, read(path)]),
);

function executableSql(value) {
  return value
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function functionBlock(value, functionName) {
  const match = value.match(new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION public\\.${functionName}\\(`
      + '[\\s\\S]*?\\$function\\$;',
    'i',
  ));
  expect(match, `function block for ${functionName}`).not.toBeNull();
  return executableSql(match[0]);
}

function browserSourceFiles(directory = join(ROOT, 'src')) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return browserSourceFiles(path);
    if (!['.js', '.jsx'].includes(extname(entry.name))) return [];
    if (entry.name.includes('.test.')) return [];
    return [path];
  });
}

const additive = executableSql(source.additive);
const containment = executableSql(source.containment);
const additiveRollback = executableSql(source.additiveRollback);
const containmentRollback = executableSql(source.containmentRollback);

describe('additive employee identity compatibility contract', () => {
  it('ships first with its own guarded rollback and executor-owned atomicity', () => {
    for (const path of [
      paths.additive,
      paths.additiveRollback,
      paths.containment,
      paths.containmentRollback,
    ]) {
      expect(existsSync(join(ROOT, path))).toBe(true);
    }

    expect(paths.additive.localeCompare(paths.containment)).toBeLessThan(0);
    expect(source.additive.toLowerCase()).toContain(
      'the supabase migration executor owns the transaction',
    );
    expect(additive).not.toMatch(/\b(?:begin|commit|rollback)\s*;/i);
    expect(source.additive).toContain(
      '20260726182000_mobile_employee_identity_containment.sql',
    );
    expect(source.additive.toLowerCase()).toContain(
      'schema-last revoke',
    );
  });

  it('adds only selector-safe profile, roster, and message-author RPCs', () => {
    expect(additive.match(/\bcreate function public\./g)).toHaveLength(3);
    expect(additive).not.toContain('create or replace function');
    expect(additive).toContain(
      'create function public.get_my_employee_profile()',
    );
    expect(additive).toContain(
      'create function public.get_employee_directory( p_include_inactive boolean default false )',
    );
    expect(additive).toContain(
      'create function public.get_message_author_directory( p_message_ids uuid[] )',
    );

    const profile = functionBlock(
      source.additive,
      'get_my_employee_profile',
    );
    const profileSignature = profile.slice(0, profile.indexOf(' language '));
    expect(profileSignature).toBe(
      'create function public.get_my_employee_profile() returns table ( id uuid, full_name text, display_name text, email text, role text, is_active boolean, is_external boolean, default_division text )',
    );
    expect(profile).toContain('v_actor_id uuid := auth.uid()');
    expect(profile).toContain(
      'where employee.auth_user_id = v_actor_id and employee.is_active',
    );
    expect(profile).toContain('if v_binding_count = 0 then return');

    const directory = functionBlock(
      source.additive,
      'get_employee_directory',
    );
    const directorySignature = directory.slice(
      0,
      directory.indexOf(' language '),
    );
    expect(directorySignature).toBe(
      'create function public.get_employee_directory( p_include_inactive boolean default false ) returns table ( id uuid, full_name text, display_name text, role text, color text, avatar_url text, is_active boolean )',
    );
    expect(directorySignature).not.toMatch(
      /\b(?:email|phone|auth_user_id|hourly_rate|overtime_rate|commission_percent|commission_flat)\b/,
    );
    expect(directory).toContain(
      "auth.jwt() ->> 'role' = 'service_role'",
    );
    expect(directory).toContain(
      "v_actor_role not in ( 'admin', 'office', 'project_manager', 'supervisor' )",
    );
    expect(directory).toContain(
      'where coalesce(p_include_inactive, false) or employee.is_active',
    );

    const messageAuthors = functionBlock(
      source.additive,
      'get_message_author_directory',
    );
    const messageAuthorSignature = messageAuthors.slice(
      0,
      messageAuthors.indexOf(' language '),
    );
    expect(messageAuthorSignature).toBe(
      'create function public.get_message_author_directory( p_message_ids uuid[] ) returns table ( id uuid, full_name text, display_name text )',
    );
    expect(messageAuthors).toContain(
      'public.messaging_can_access_conversations()',
    );
    expect(messageAuthors).toContain(
      "auth.jwt() ->> 'role' = 'service_role'",
    );
    expect(messageAuthors).toContain(
      'cardinality(p_message_ids) > 200',
    );
    expect(messageAuthors).toContain(
      'from unnest(p_message_ids) requested(message_id)',
    );
    expect(messageAuthors).toContain(
      "join public.messages message on message.id = requested.message_id and message.type = 'internal_note'",
    );
    expect(messageAuthors).toContain(
      'join public.employees employee on employee.id = message.sent_by',
    );
    expect(messageAuthorSignature).not.toMatch(
      /\b(?:email|phone|auth_user_id|role|is_active|is_external|hourly_rate|overtime_rate|commission_percent|commission_flat)\b/,
    );
  });

  it('does not revoke the old table boundary or replace sensitive RPCs', () => {
    expect(additive).not.toMatch(/\b(?:create|drop|alter)\s+policy\b/i);
    expect(additive).not.toMatch(
      /\b(?:grant|revoke)\b[^;]*\bon table public\.employees\b/i,
    );
    expect(additive).not.toMatch(
      /\b(?:insert into|update|delete from)\s+public\.employees\b/i,
    );
    for (const functionName of [
      'get_all_employees',
      'get_employee_commissions',
      'upsert_employee_commission',
      'can_current_employee_access_settings',
    ]) {
      expect(additive).not.toContain(`function public.${functionName}`);
    }
  });

  it('revokes inherited execution before granting only authenticated and service roles', () => {
    for (const identity of [
      'public.get_my_employee_profile()',
      'public.get_employee_directory(boolean)',
      'public.get_message_author_directory(uuid[])',
    ]) {
      const revoke = additive.indexOf(
        `revoke execute on function ${identity} from public, anon, authenticated, service_role`,
      );
      const grant = additive.indexOf(
        `grant execute on function ${identity} to authenticated, service_role`,
      );
      expect(revoke).toBeGreaterThan(-1);
      expect(grant).toBeGreaterThan(revoke);
    }

    for (const exactBodyHash of [
      'b0df079edcab6eb4de1d7820663966e1',
      '51bdc3ce561c947a55373090f8913446',
      'e2abe76a7795aaa4e084a5e6640918e2',
    ]) {
      expect(additive).toContain(exactBodyHash);
    }
    expect(additive).toContain(
      "'postgres>authenticated:execute:not_grantable'",
    );
    expect(additive).toContain(
      "'postgres>postgres:execute:not_grantable'",
    );
    expect(additive).toContain(
      "'postgres>service_role:execute:not_grantable'",
    );
    expect(additive).toContain(
      'coalesce(grantor_role.rolname, \'<missing>\')',
    );
    expect(additive).toContain(
      "procedure.proconfig = array[ 'search_path=public, extensions, pg_temp' ]::text[]",
    );
    expect(additive).toContain(
      "'table(id uuid, full_name text, display_name text, email text, role text, is_active boolean, is_external boolean, default_division text)'",
    );
    expect(additive).toContain(
      "'table(id uuid, full_name text, display_name text, role text, color text, avatar_url text, is_active boolean)'",
    );
    expect(additive).toContain(
      "'table(id uuid, full_name text, display_name text)'",
    );
    expect(additive).toContain(
      "md5(procedure.prosrc) = '52eebbbee082292bbd650261d0adda17'",
    );
  });

  it('rolls back only the additive RPCs and refuses while containment/consumers remain', () => {
    expect(additiveRollback).toContain(
      "current_setting( 'upr.allow_unsafe_employee_identity_contract_rollback', true ) is distinct from 'on'",
    );
    expect(additiveRollback).toContain(
      "policyname = 'employees_self_identity_read'",
    );
    expect(additiveRollback).toContain(
      "to_regclass('public.inbound_lead_recording_sources')",
    );
    expect(additiveRollback).toContain(
      "to_regclass('public.notification_reads')",
    );
    expect(additiveRollback).toContain(
      "to_regprocedure( 'public.is_current_active_internal_employee(uuid)' )",
    );
    expect(additiveRollback.match(/\bdrop function public\./g)).toHaveLength(3);
    expect(additiveRollback).not.toMatch(
      /\b(?:grant|revoke)\b[^;]*\bon table public\.employees\b/i,
    );
    for (const exactBodyHash of [
      'b0df079edcab6eb4de1d7820663966e1',
      '51bdc3ce561c947a55373090f8913446',
      'e2abe76a7795aaa4e084a5e6640918e2',
    ]) {
      expect(additiveRollback).toContain(exactBodyHash);
    }
    expect(additiveRollback).toContain(
      'pg_get_function_arguments(procedure.oid) = v_expected.arguments',
    );
    expect(additiveRollback).toContain(
      'pg_get_function_result(procedure.oid) = v_expected.result_type',
    );
    expect(additiveRollback).toContain(
      'md5(procedure.prosrc) = v_expected.body_md5',
    );
    expect(additiveRollback).toContain(
      "'postgres>authenticated:execute:not_grantable'",
    );
    expect(additiveRollback).toContain(
      "procedure.proname in ( 'get_my_employee_profile', 'get_employee_directory', 'get_message_author_directory' )",
    );
  });
});

describe('schema-last employee identity containment', () => {
  it('requires the additive ledger entry and pins the captured broad input', () => {
    expect(containment).toContain(
      "migration.name = 'mobile_employee_identity_authority'",
    );
    expect(containment).toContain(
      "array[ 'allow_anon_read_employees', 'allow_authenticated_employees' ]::text[]",
    );
    expect(containment).toContain("and cmd = 'all'");
    expect(containment).toContain("and qual = 'true'");
    expect(containment).toContain("and with_check = 'true'");
    expect(containment).toContain(
      "md5(procedure.prosrc) = 'be7e057f6b8a1ae76beb17b63970c8fb'",
    );
    expect(containment).toContain(
      "md5(procedure.prosrc) = 'b1a067b845248b9c96dcc533fe3938d8'",
    );
    expect(containment).toContain(
      "md5(procedure.prosrc) = '7efc239d1754cebe2648fd48298823fa'",
    );
    expect(containment).toContain(
      "md5(procedure.prosrc) = 'a0d1719549f9fc5cff2e47c26aabe666'",
    );
    expect(containment).toContain(
      "trigger_record.tgname = 'trg_calc_time_entry_cost'",
    );
    expect(containment).toContain(
      "policy.tablename = 'job_time_entries'",
    );
    expect(containment).toContain(
      'and not procedure.prosecdef',
    );
    for (const exactAdditiveHash of [
      'b0df079edcab6eb4de1d7820663966e1',
      '51bdc3ce561c947a55373090f8913446',
      'e2abe76a7795aaa4e084a5e6640918e2',
    ]) {
      expect(containment).toContain(exactAdditiveHash);
    }
    expect(containment).toContain(
      'pg_get_function_arguments(procedure.oid) = v_expected.arguments',
    );
    expect(containment).toContain(
      'pg_get_function_result(procedure.oid) = v_expected.result_type',
    );
    expect(containment).toContain(
      "'postgres>authenticated:execute:not_grantable'",
    );
  });

  it('replaces broad policies with self-only RLS and four identity columns', () => {
    const anonDrop = containment.indexOf(
      'drop policy allow_anon_read_employees on public.employees',
    );
    const authenticatedDrop = containment.indexOf(
      'drop policy allow_authenticated_employees on public.employees',
    );
    const selfPolicy = containment.indexOf(
      'create policy employees_self_identity_read on public.employees for select to authenticated using (auth_user_id = auth.uid())',
    );
    const revoke = containment.indexOf(
      'revoke all privileges on table public.employees from public, anon, authenticated',
    );
    const grant = containment.indexOf(
      'grant select (id, auth_user_id, role, is_active) on table public.employees to authenticated',
    );

    expect(anonDrop).toBeGreaterThan(-1);
    expect(authenticatedDrop).toBeGreaterThan(anonDrop);
    expect(selfPolicy).toBeGreaterThan(authenticatedDrop);
    expect(revoke).toBeGreaterThan(selfPolicy);
    expect(grant).toBeGreaterThan(revoke);
    expect(containment).not.toContain(
      'grant select on table public.employees to authenticated',
    );
    expect(containment).not.toContain(
      'grant select on table public.employees to anon',
    );
    expect(containment).not.toMatch(
      /grant (?:insert|update|delete|truncate|references|trigger|maintain)[^;]* to (?:anon|authenticated)/i,
    );

    expect(containment).toContain(
      "v_authenticated_columns is distinct from array['auth_user_id', 'id', 'is_active', 'role']::text[]",
    );
    expect(containment).toContain(
      'v_authenticated_privileges is distinct from array[]::text[]',
    );
    expect(containment).toContain(
      "has_table_privilege( 'authenticated', 'public.employees', 'select' )",
    );
    expect(containment).toContain(
      "where acl.grantee = 0 or grantor_role.rolname is distinct from 'postgres' or grantee_role.rolname is distinct from 'authenticated'",
    );
    const columnGrant = containment.match(
      /grant select \(id, auth_user_id, role, is_active\) on table public\.employees to authenticated/,
    )?.[0];
    expect(columnGrant).toBeTruthy();
    for (const sensitiveColumn of [
      'full_name',
      'display_name',
      'email',
      'phone',
      'hourly_rate',
      'overtime_rate',
      'commission_percent',
      'commission_flat',
      'is_external',
    ]) {
      expect(columnGrant).not.toContain(sensitiveColumn);
    }
  });

  it('makes full employee data active-internal-admin/service only', () => {
    const block = functionBlock(source.containment, 'get_all_employees');
    expect(block).toContain(
      "auth.jwt() ->> 'role' = 'service_role'",
    );
    expect(block).toContain('actor.auth_user_id = auth.uid()');
    expect(block).toContain('and actor.is_active');
    expect(block).toContain('and not actor.is_external');
    expect(block).toContain("and actor.role::text = 'admin'");
    expect(block).toContain(
      'not_authorized: employee administration requires admin',
    );
    for (const sensitiveKey of [
      "'auth_user_id'",
      "'email'",
      "'phone'",
      "'hourly_rate'",
      "'overtime_rate'",
    ]) {
      expect(block).toContain(sensitiveKey);
    }
  });

  it('uses the exact Settings capability for commission reads and writes', () => {
    const capability = functionBlock(
      source.containment,
      'can_current_employee_access_settings',
    );
    expect(capability).toContain('employee.auth_user_id = auth.uid()');
    expect(capability).toContain('and employee.is_active');
    expect(capability).toContain('and not employee.is_external');
    expect(capability).toContain("flag.key = 'page:settings'");
    expect(capability).toContain('and flag.force_disabled');
    expect(capability).toContain('from public.employee_page_access access');
    expect(capability).toContain("and access.nav_key = 'settings'");
    expect(capability).toContain("if v_actor_role = 'admin'");
    expect(capability).toContain('from public.nav_permissions permission');
    expect(capability).toContain("and permission.nav_key = 'settings'");
    expect(containment).toContain(
      'revoke execute on function public.can_current_employee_access_settings() from public, anon, authenticated, service_role',
    );
    expect(containment).not.toContain(
      'grant execute on function public.can_current_employee_access_settings()',
    );

    const readBlock = functionBlock(
      source.containment,
      'get_employee_commissions',
    );
    const writeBlock = functionBlock(
      source.containment,
      'upsert_employee_commission',
    );
    for (const block of [readBlock, writeBlock]) {
      expect(block).toContain(
        'public.can_current_employee_access_settings()',
      );
      expect(block).toContain(
        'not_authorized: commission settings access required',
      );
    }
  });

  it('preserves commission signatures while validating values and redacting browser results', () => {
    expect(containment).toContain(
      'create or replace function public.get_employee_commissions() returns table ( id uuid, full_name text, role text, is_active boolean, commission_percent numeric, commission_flat numeric )',
    );
    expect(containment).toContain(
      'create or replace function public.upsert_employee_commission( p_employee_id uuid, p_percent numeric default null, p_flat numeric default null ) returns public.employees',
    );

    const writeBlock = functionBlock(
      source.containment,
      'upsert_employee_commission',
    );
    for (const invariant of [
      'employee is required',
      'percent and flat are mutually exclusive',
      'percent must be between 0 and 100',
      'flat amount must be nonnegative',
      'employee not found',
    ]) {
      expect(writeBlock).toContain(`invalid_commission: ${invariant}`);
    }
    expect(writeBlock).toContain(
      "p_percent::text in ('nan', 'infinity', '-infinity')",
    );
    expect(writeBlock).toContain(
      "p_flat::text in ('nan', 'infinity', '-infinity')",
    );
    expect(writeBlock).toContain('if v_is_service then return v_stored');
    expect(writeBlock).toContain('v_result.id := v_stored.id');
    expect(writeBlock).toContain(
      'v_result.commission_percent := v_stored.commission_percent',
    );
    expect(writeBlock).toContain(
      'v_result.commission_flat := v_stored.commission_flat',
    );
    for (const assignment of [
      'v_result.auth_user_id',
      'v_result.email',
      'v_result.phone',
      'v_result.hourly_rate',
      'v_result.overtime_rate',
    ]) {
      expect(writeBlock).not.toContain(`${assignment} :=`);
    }
  });

  it('revokes inherited execution before each public RPC grant', () => {
    for (const identity of [
      'public.get_all_employees()',
      'public.get_employee_commissions()',
      'public.upsert_employee_commission(uuid, numeric, numeric)',
    ]) {
      const revoke = containment.indexOf(
        `revoke execute on function ${identity} from public, anon, authenticated, service_role`,
      );
      const grant = containment.indexOf(
        `grant execute on function ${identity} to authenticated, service_role`,
      );
      expect(revoke).toBeGreaterThan(-1);
      expect(grant).toBeGreaterThan(revoke);
    }
  });

  it('keeps the unsafe containment rollback separate and owner-guarded', () => {
    expect(containmentRollback).toContain(
      "current_setting( 'upr.allow_unsafe_employee_identity_containment_rollback', true ) is distinct from 'on'",
    );
    expect(containmentRollback).toContain(
      'unsafe employee identity containment rollback refused',
    );
    expect(containmentRollback).toContain(
      'create policy allow_anon_read_employees on public.employees for select to anon using (true)',
    );
    expect(containmentRollback).toContain(
      'create policy allow_authenticated_employees on public.employees for all to authenticated using (true) with check (true)',
    );
    expect(containmentRollback).toContain(
      'grant select, insert, update, delete, truncate, references, trigger, maintain on table public.employees to anon, authenticated',
    );
    expect(containmentRollback).toContain(
      "to_regprocedure( 'public.is_current_active_internal_employee(uuid)' )",
    );
    expect(containmentRollback).not.toContain('has_table_privilege(');
    expect(containmentRollback).toContain(
      "policyname = 'employees_self_identity_read' and roles = array['authenticated']::name[] and cmd = 'select' and qual = '(auth_user_id = auth.uid())' and with_check is null",
    );
    expect(containmentRollback).toContain(
      "'postgres>postgres:execute:not_grantable'",
    );
    expect(containmentRollback).toContain(
      'pg_get_function_arguments(procedure.oid) = v_expected.arguments',
    );
    expect(containmentRollback).toContain(
      'pg_get_function_result(procedure.oid) = v_expected.result_type',
    );
    expect(containmentRollback).toContain(
      'md5(procedure.prosrc) = v_expected.body_md5',
    );
    for (const exactForwardHash of [
      '24f8db8b3486f47f6223d4f47cfe7800',
      '160d3c16f2bbc24c5151f2e465d9f1f6',
      'ac13416910f68bea3e0f073db3fd1b09',
      '4e8befd62b6cc5e06a4fc421fdb41fea',
    ]) {
      expect(containmentRollback).toContain(exactForwardHash);
    }
    for (const exactRestoredHash of [
      'be7e057f6b8a1ae76beb17b63970c8fb',
      'b1a067b845248b9c96dcc533fe3938d8',
      '7efc239d1754cebe2648fd48298823fa',
    ]) {
      expect(containmentRollback).toContain(exactRestoredHash);
    }
    expect(containmentRollback).toContain(
      "procedure.proname = 'can_current_employee_access_settings'",
    );
  });
});

describe('isolated two-step behavior proof', () => {
  it('is local-only, requires both ledger entries, and always rolls back', () => {
    expect(source.isolated).toContain('ISOLATED DATABASE ONLY');
    expect(source.isolated).toMatch(
      /NEVER run this behavior script against the shared UPR Supabase project/i,
    );
    expect(source.isolated).toContain('\\if :{?UPR_ISOLATED_DB}');
    expect(source.isolated).toContain(
      "current_setting('upr.isolated_test_database', true)",
    );
    expect(source.isolated).toContain(
      "migration.name = 'mobile_employee_identity_authority'",
    );
    expect(source.isolated).toContain(
      "migration.name = 'mobile_employee_identity_containment'",
    );
    expect(source.isolated.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(source.wrapper).toContain('\\set UPR_ISOLATED_DB 1');
    expect(source.wrapper).toContain(
      '\\ir mobile_employee_identity_authority_isolated.sql',
    );
    expect(source.localDbRunner).toContain(
      "'supabase/tests/mobile_employee_identity_authority.test.sql'",
    );
  });

  it('proves self-only identity columns and denies browser employee authority', () => {
    for (const label of [
      'authenticated self identity-column read failed',
      'foreign employee identity row leaked through direct SELECT',
      'authenticated full-name column read',
      'authenticated employee select star',
      'authenticated self-binding insert',
      'authenticated own role promotion',
      'authenticated own Auth binding change',
      'authenticated own active-state change',
      'authenticated own external-state change',
      'authenticated foreign-row binding',
      'authenticated employee delete',
      'authenticated employee truncate',
      'anonymous employee select',
      'anonymous employee insert',
    ]) {
      expect(source.isolated).toContain(label);
    }
    expect(source.isolated).not.toContain(
      'authenticated employee directory read compatibility failed',
    );
  });

  it('covers safe RPC shapes, inactive-directory capability, and denied identities', () => {
    for (const proof of [
      'selector-safe employee profile shape/value drift',
      'safe active employee directory behavior drift',
      'field employee inactive directory',
      'time-admin inactive employee directory compatibility failed',
      'unmapped employee directory',
      'inactive employee directory',
      'active external profile or safe active directory compatibility failed',
      'external inactive directory',
      'anonymous profile RPC',
      'anonymous directory RPC',
      'historical internal-note author attribution compatibility failed',
      'message-author null selector',
      'message-author null array element',
      'message-author oversized selector',
      'unmapped historical message author',
      'inactive historical message author',
      'external historical message author',
      'anonymous historical message-author RPC',
    ]) {
      expect(source.isolated).toContain(proof);
    }
  });

  it('covers exact sensitive RPC gates, validation, redaction, and service compatibility', () => {
    for (const proof of [
      'non-admin all-employee HR read',
      'settings-denied commission read',
      'settings-denied commission write',
      'private Settings capability helper',
      'Settings-capable commission read compatibility failed',
      'browser commission result compatibility/redaction failed',
      'commission percent and flat together',
      'commission percent above 100',
      'commission percent NaN',
      'commission percent positive infinity',
      'commission percent negative infinity',
      'negative flat commission',
      'flat commission NaN',
      'flat commission positive infinity',
      'flat commission negative infinity',
      'missing commission employee',
      'admin employee/pay/commission compatibility failed',
      'anonymous all-employee HR RPC',
      'anonymous commission read RPC',
      'anonymous commission write RPC',
      'service-role employee directory/commission/message-author read compatibility failed',
      'service-role full employee RPC compatibility failed',
      'service-role full commission result compatibility failed',
      'service-role selector-safe profile compatibility failed',
      'service-role employee mutation compatibility failed',
      'service-role employee delete compatibility failed',
    ]) {
      expect(source.isolated).toContain(proof);
    }
  });
});

describe('browser and trusted employee callers', () => {
  it('uses the selector-safe profile and directory contracts in browser source', () => {
    expect(source.authContext).toContain(
      "'get_my_employee_profile'",
    );
    expect(source.directoryHelper).toContain(
      "db.rpc('get_employee_directory'",
    );
    expect(source.directoryHelper).toContain(
      "db.rpc('get_message_author_directory'",
    );
    expect(source.directoryHelper).toContain('start += 200');
    for (const caller of [source.conversations, source.techThread]) {
      expect(caller).toContain('missingMessageAuthorMessageIds');
      expect(caller).toContain('loadMessageAuthorDirectory');
      expect(caller).not.toContain('employees(full_name)');
    }

    for (const file of browserSourceFiles()) {
      const contents = readFileSync(file, 'utf8');
      expect(
        contents,
        `direct employees Data API call in ${relative(ROOT, file)}`,
      ).not.toMatch(
        /\.(?:select|insert|update|delete)\(\s*['"]employees['"]/,
      );
    }
  });

  it('leaves sensitive UI callers on their separately gated RPCs', () => {
    expect(source.team).toContain("db.rpc('get_all_employees')");
    expect(source.commissions).toContain(
      "db.rpc('get_employee_commissions')",
    );
    expect(source.commissions).toContain(
      "db.rpc('upsert_employee_commission'",
    );

    const fullEmployeeCallers = browserSourceFiles()
      .filter((file) => readFileSync(file, 'utf8').includes(
        "db.rpc('get_all_employees')",
      ))
      // Normalise separators: relative() yields `src\pages\...` on Windows, so a
      // hardcoded forward-slash comparison passed on CI's Linux and failed on the
      // owner's machine. A test that is only green on CI teaches people to ignore
      // local failures, which is worse than the test not existing.
      .map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(fullEmployeeCallers).toEqual(['src/pages/settings/Team.jsx']);
  });

  it('keeps employee mutation behind the active internal admin Worker', () => {
    expect(source.adminUsers).toContain(
      "requireRole(request, env, db, ['admin'])",
    );
    expect(source.adminUsers).toContain(
      'auth.employee.is_external === true',
    );
    expect(source.adminUsers).toContain("db.insert('employees'");
    expect(source.adminUsers).toContain("db.update('employees'");
    expect(source.adminUsers).toContain("db.delete('employees'");
  });
});
