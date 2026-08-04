/**
 * ════════════════════════════════════════════════
 * FILE: appointment-crew-atomic-save-and-audit-repair.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the Production/QA predecessor guards, enum conversion, all-internal
 *   crew authority, immutable activity history, atomic create/update commands,
 *   and fail-closed recovery visible in credential-free CI.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  20260804000910 forward migration, rollback, and SQL proof
 *   Data:      reads → repository SQL source; writes → none
 *
 * NOTES / GOTCHAS:
 *   Behavioral transaction proof runs separately on disposable local Postgres.
 * ════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATION = join(
  ROOT,
  'supabase/migrations/20260804000910_appointment_crew_atomic_save_and_audit_repair.sql',
);
const ROLLBACK = join(
  ROOT,
  'supabase/rollbacks/20260804000910_appointment_crew_atomic_save_and_audit_repair.rollback.sql',
);
const SQL_PROOF = join(
  ROOT,
  'supabase/tests/appointment_crew_atomic_save_and_audit_repair.test.sql',
);
const migration = readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n');
const rollback = readFileSync(ROLLBACK, 'utf8').replace(/\r\n/g, '\n');
const sqlProof = readFileSync(SQL_PROOF, 'utf8').replace(/\r\n/g, '\n');

describe('appointment crew atomic save and audit repair source contract', () => {
  it('ships a paired fail-closed recovery source', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(rollback).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointment_crew',
    );
    expect(rollback).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointments',
    );
    expect(rollback).toContain(
      "'REVOKE INSERT (%s) ON TABLE public.appointments FROM PUBLIC, anon, authenticated, service_role'",
    );
    expect(rollback).toContain(
      "'REVOKE UPDATE (%s) ON TABLE public.appointments FROM PUBLIC, anon, authenticated, service_role'",
    );
    expect(rollback).toContain(
      "'REVOKE INSERT (%s) ON TABLE public.appointment_crew FROM PUBLIC, anon, authenticated, service_role'",
    );
    expect(rollback).toContain(
      "'REVOKE UPDATE (%s) ON TABLE public.appointment_crew FROM PUBLIC, anon, authenticated, service_role'",
    );
    expect(rollback).toContain(
      "VALUES ('anon'), ('authenticated'), ('service_role')",
    );
    expect(rollback).toContain(
      "VALUES ('INSERT'), ('UPDATE')",
    );
    for (const rpc of [
      'sync_appointment_crew(uuid, jsonb)',
      'sync_appointment_crew(\n  uuid,\n  jsonb,\n  uuid',
      'create_appointment_with_crew(',
      'update_appointment_with_crew(',
      'update_appointment(',
    ]) {
      expect(rollback).toContain(`REVOKE EXECUTE ON FUNCTION public.${rpc}`);
    }
    expect(rollback).toContain(
      'ON FUNCTION public.assign_tasks_to_appointment(uuid, uuid[])',
    );
    expect(rollback).toContain(
      'ON FUNCTION public.delete_appointment(uuid, uuid, text)',
    );
    expect(rollback).toContain(
      'ON FUNCTION public.merge_jobs(uuid, uuid)',
    );
    expect(rollback).not.toContain('DROP TABLE');
    expect(rollback).not.toContain('DROP FUNCTION');
    expect(rollback).not.toContain('GRANT EXECUTE');
    expect(migration).not.toContain('DROP TRIGGER');
  });

  it('binds to immutable Production hotfix and QA M1 predecessors', () => {
    for (const hash of [
      '1b5cde73aaf7c910461f6c4c8447029e',
      '2f615878d384051b1dec92b0b57845a9',
      'c5f0ea1f1167ef1274c70e0091af6c13',
      'addbcf6ebd592da9c92a8dffdacd5b96',
      '9ca5bc7f25cbfb0121c299946118a5ee',
      'df0283b20ef8fef0f68028259ab7fd8f',
      '3c1d404cd65307c3de8db2ec7bab2914',
      'e8b67031d148d07efd6fbfd4bb72524a',
      '0c126177d2b677c11c3c878ae2920a17',
    ]) {
      expect(migration).toContain(`'${hash}'`);
    }
    expect(migration).toContain(
      'UPR appointment crew atomic save/audit repair v1:%',
    );
    expect(migration).not.toContain(
      'ee8e8ee6ac74e2388b52e02b79e6ce77',
    );
  });

  it('keeps sync backward compatible and casts every desired JSON role', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.sync_appointment_crew(',
    );
    expect(migration).toContain('p_appointment_id uuid,');
    expect(migration).toContain("p_crew jsonb DEFAULT '[]'::jsonb");
    expect(migration).toContain('RETURNS SETOF public.appointment_crew');
    expect(
      migration.match(/\)::public\.crew_role AS role/g)?.length,
    ).toBe(3);
    expect(migration).toContain(
      ") NOT IN ('lead', 'tech', 'helper')",
    );
    expect(migration).toContain(
      "NULLIF(btrim(element ->> 'role'), ''),",
    );
  });

  it('validates the complete crew payload before the set diff mutates rows', () => {
    const invalidAt = migration.indexOf(
      "'sync_appointment_crew: invalid crew member'",
    );
    const duplicateAt = migration.indexOf(
      "'sync_appointment_crew: duplicate crew member'",
    );
    const targetAt = migration.indexOf(
      "'sync_appointment_crew: active internal crew required'",
    );
    const deleteAt = migration.indexOf(
      'DELETE FROM public.appointment_crew existing',
    );
    expect(invalidAt).toBeGreaterThan(-1);
    expect(duplicateAt).toBeGreaterThan(invalidAt);
    expect(targetAt).toBeGreaterThan(duplicateAt);
    expect(deleteAt).toBeGreaterThan(targetAt);
    expect(migration).toContain(
      'existing.role IS DISTINCT FROM desired.role',
    );
    expect(migration).toContain(
      'ON CONFLICT (appointment_id, employee_id) DO NOTHING',
    );
    expect(migration).toContain(
      'WHERE existing.appointment_id = p_appointment_id',
    );
    expect(migration).toContain(
      'AND existing.employee_id = desired.employee_id',
    );
  });

  it('allows every active internal employee and denies outside identities', () => {
    expect(migration).toContain(
      'employee.auth_user_id = (SELECT auth.uid())',
    );
    expect(migration).toContain('employee.is_active IS TRUE');
    expect(migration).toContain('employee.is_external IS FALSE');
    expect(migration).toContain(
      "employee.role::text IS DISTINCT FROM 'crm_partner'",
    );
    expect(migration).toContain(
      'public.current_active_internal_appointment_employee() IS NOT NULL',
    );
    for (const policy of [
      'all_select_appointment_crew',
      'all_insert_appointment_crew',
      'all_update_appointment_crew',
      'all_delete_appointment_crew',
    ]) {
      expect(migration).toContain(`ALTER POLICY ${policy}`);
    }
  });

  it('attributes immutable old/new crew history only for real changes', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.audit_appointment_crew_change()',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE TRIGGER trg_appointment_crew_actor_audit',
    );
    expect(migration).toContain(
      'NEW.role IS NOT DISTINCT FROM OLD.role',
    );
    expect(migration).toContain("'appointment.crew_changed'");
    expect(migration).toContain("'old_assignment', v_old_assignment");
    expect(migration).toContain("'new_assignment', v_new_assignment");
    expect(migration).toContain("'actor_kind', v_actor_kind");
    expect(migration).toContain("'changed_at', statement_timestamp()");
    expect(migration).toContain("'old_crew', v_old_crew");
    expect(migration).toContain("'new_crew', v_new_crew");
    expect(migration).toContain("'operation', 'set_diff'");
    expect(migration).toContain('INSERT INTO public.system_events');
    expect(migration).toContain(
      'public.current_attributed_appointment_crew_actor()',
    );
    expect(migration).toContain(
      "'upr.appointment_crew_actor_id'",
    );
    expect(migration).toContain(
      'NOT_AUTHORIZED: attributed active internal appointment actor required',
    );
    expect(migration).toContain(
      'REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
    );
  });

  it('adds atomic create/update commands with explicit nullable-field intent', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.create_appointment_with_crew(',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.update_appointment_with_crew(',
    );
    expect(migration).toContain(
      'p_task_templates jsonb DEFAULT',
    );
    expect(migration).toContain(
      'p_crew jsonb DEFAULT NULL::jsonb',
    );
    expect(migration).toContain(
      'p_set_time_start boolean DEFAULT false',
    );
    expect(migration).toContain(
      'p_set_time_end boolean DEFAULT false',
    );
    expect(migration).toContain(
      'p_set_notes boolean DEFAULT false',
    );
    expect(migration).toContain(
      'UPDATE public.appointments appointment',
    );
    expect(migration).toContain(
      'time_start = v_target_time_start',
    );
    expect(migration).toContain(
      'time_end = v_target_time_end',
    );
    expect(migration).toContain(
      'notes = v_target_notes',
    );
    expect(migration).toContain(
      'FROM public.sync_appointment_crew(',
    );
    expect(migration).toContain(
      'PERFORM public.assign_tasks_to_appointment(',
    );
    expect(migration).toContain('INSERT INTO public.job_tasks');
    expect(migration).toContain(
      'public.can_current_employee_create_appointment_command()',
    );
    expect(migration).toContain(
      'public.can_current_employee_edit_appointment_command(',
    );
    expect(migration).toContain(
      'task IDs must be unique, unassigned, and belong to the appointment job',
    );
    expect(migration).toContain(
      'task IDs must be unique, unassigned/current, and belong to the appointment job',
    );
  });

  it('keeps broad crew authority separate from contained appointment edits', () => {
    expect(migration).toContain('v_has_noncrew_intent');
    expect(migration).toContain(
      'COALESCE(p_set_notes, false) OR p_notes IS NOT NULL',
    );
    expect(migration).toContain(
      'NOT_AUTHORIZED: appointment mutation access required',
    );
    expect(migration).toContain(
      'NOT_AUTHORIZED: appointment privacy manager required',
    );
    expect(migration).toContain(
      'IF v_has_core_change THEN',
    );
    expect(migration).toContain(
      'public.can_current_employee_access_appointment_command(',
    );
    expect(migration).toContain(
      'IF NOT v_is_trusted AND NOT v_can_access THEN',
    );
    expect(migration).toContain("'crew_changed',");
    expect(sqlProof).toContain(
      'private same-value field guesses bypassed noncrew intent authorization',
    );
    expect(sqlProof).toContain(
      'private nullable-field guess bypassed noncrew intent authorization',
    );
    expect(sqlProof).toContain(
      'explicit nullable clear lost stored state or reschedule provenance',
    );
  });

  it('requires explicit active-employee attribution for service crew writes', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.sync_appointment_crew(\n  p_appointment_id uuid,\n  p_crew jsonb,\n  p_actor_id uuid',
    );
    expect(migration).toContain(
      'NOT_AUTHORIZED: attributed service appointment actor required',
    );
    expect(migration).toContain(
      'ON FUNCTION public.sync_appointment_crew(uuid, jsonb, uuid)',
    );
    expect(migration).toContain(
      'ON TABLE public.appointment_crew\n  TO service_role;',
    );
    expect(sqlProof).toContain(
      'service crew change lost explicit employee provenance',
    );
    expect(sqlProof).toContain(
      "OR has_function_privilege('service_role', 'public.sync_appointment_crew(uuid,jsonb)', 'EXECUTE')",
    );
    expect(sqlProof).toContain(
      "OR NOT has_function_privilege('service_role', 'public.sync_appointment_crew(uuid,jsonb,uuid)', 'EXECUTE')",
    );
  });

  it('hardens every deployed legacy appointment mutation escape hatch', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.update_appointment(',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.assign_tasks_to_appointment(',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.delete_appointment(',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE TRIGGER trg_appointments_atomic_command_guard',
    );
    expect(migration).toContain(
      'NOT_AUTHORIZED: appointment actor does not match caller',
    );
    expect(migration).toContain(
      'NOT_AUTHORIZED: appointment task access required',
    );
    for (const policy of [
      'all_select_appointments',
      'all_insert_appointments',
      'all_update_appointments',
      'all_delete_appointments',
    ]) {
      expect(migration).toContain(`ALTER POLICY ${policy}`);
    }
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.appointments',
    );
    expect(migration).toContain(
      'Phase A compatibility: installed native builds still create appointments',
    );
    expect(migration).toContain(
      'Phase A compatibility: installed native builds still write crew rows',
    );
  });

  it('keeps job merging atomic without reopening direct appointment identity writes', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.merge_jobs(',
    );
    expect(migration).toContain(
      'NOT_AUTHORIZED: active internal admin required to merge jobs',
    );
    expect(migration).toContain(
      'UPDATE public.appointments SET job_id = p_keep_id',
    );
    expect(migration).toContain(
      "'appointments_moved', v_appointments_moved",
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.merge_jobs(uuid, uuid)\n  TO authenticated;',
    );
    expect(migration).toContain(
      'GRANT UPDATE (%s) ON TABLE public.appointments TO authenticated',
    );
    expect(migration).toContain(
      "'id',\n      'job_id',\n      'kind',\n      'created_by',\n      'created_by_employee_id',\n      'created_at'",
    );
    expect(migration).not.toContain(
      'OR NEW.job_id IS DISTINCT FROM OLD.job_id',
    );
    expect(sqlProof).toContain(
      'direct browser appointment reparent unexpectedly succeeded',
    );
    expect(sqlProof).toContain(
      'direct browser appointment creator rebind unexpectedly succeeded',
    );
    expect(sqlProof).toContain(
      'admin job merge lost atomic appointment/crew preservation or audit',
    );
    expect(sqlProof).toContain(
      "OR NOT has_function_privilege('authenticated', 'public.merge_jobs(uuid,uuid)', 'EXECUTE')",
    );
    expect(sqlProof).toContain(
      "OR has_function_privilege('service_role', 'public.merge_jobs(uuid,uuid)', 'EXECUTE')",
    );
  });

  it('revokes inherited access before granting only guarded compatibility operations', () => {
    const tableRevoke = migration.indexOf(
      'REVOKE ALL PRIVILEGES ON TABLE public.appointment_crew',
    );
    const tableGrant = migration.indexOf(
      'GRANT SELECT, INSERT, UPDATE, DELETE',
      tableRevoke,
    );
    expect(tableRevoke).toBeGreaterThan(-1);
    expect(tableGrant).toBeGreaterThan(tableRevoke);
    expect(migration).toContain(
      'ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY',
    );
    expect(migration).toContain(
      'ALTER TABLE public.appointment_crew ENABLE ROW LEVEL SECURITY',
    );
    expect(rollback).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointments',
    );
    expect(rollback).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointment_crew',
    );
    expect(sqlProof).toContain(
      "OR NOT has_table_privilege('authenticated', 'public.appointments', 'SELECT,INSERT,DELETE')",
    );
    expect(sqlProof).toContain(
      "OR NOT has_table_privilege('authenticated', 'public.appointment_crew', 'SELECT,INSERT,UPDATE,DELETE')",
    );
    expect(sqlProof).not.toContain(
      "OR NOT has_table_privilege('authenticated', 'public.appointments', 'SELECT,INSERT,UPDATE,DELETE')",
    );
    expect(sqlProof).not.toContain(
      "OR has_table_privilege('authenticated', 'public.appointment_crew', 'INSERT,UPDATE,DELETE')",
    );
    expect(sqlProof).toContain(
      "OR has_table_privilege('service_role', 'public.appointments', 'UPDATE')",
    );
    expect(sqlProof).toContain(
      "OR NOT has_column_privilege('service_role', 'public.appointments', 'client_notified_at', 'UPDATE')",
    );
    expect(sqlProof).toContain(
      "OR NOT has_column_privilege('service_role', 'public.appointments', 'client_time_sig', 'UPDATE')",
    );
    expect(sqlProof).toContain(
      "OR has_table_privilege('service_role', 'public.appointments', 'INSERT,DELETE,TRUNCATE')",
    );
    expect(sqlProof).toContain(
      "OR has_table_privilege('service_role', 'public.appointment_crew', 'INSERT,UPDATE,DELETE,TRUNCATE')",
    );
    expect(sqlProof).toContain(
      "'created_by_employee_id', 'created_at'",
    );
    for (const rpc of [
      'sync_appointment_crew(uuid, jsonb)',
      'create_appointment_with_crew(',
      'update_appointment_with_crew(',
      'update_appointment(',
      'assign_tasks_to_appointment(uuid, uuid[])',
      'delete_appointment(uuid, uuid, text)',
    ]) {
      expect(migration).not.toContain(
        `GRANT EXECUTE ON FUNCTION public.${rpc} TO anon`,
      );
    }
  });

  it('does not touch notification activation, providers, Storage, or QBO', () => {
    for (const forbidden of [
      'SET enabled = true',
      'cron.schedule',
      'net.http_post',
      'storage.',
      'qbo_',
      'twilio',
      'resend',
      'capgo',
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(rollback.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
