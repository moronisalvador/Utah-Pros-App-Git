/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FILE: notification-producer-crew-composition.test.js
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the forward composition to notification-only behavior and proves it
 *   cannot quietly replace the live Crew Phase-A RPC, policy, audit, or legacy
 *   installed-client compatibility boundary.
 *
 * DEPENDS ON:
 *   Packages: Node built-ins, Vitest
 *   Internal: notification M1/M2, the composition migration, and its rollback
 *   Data: reads repository source; writes nothing
 *
 * NOTES / GOTCHAS:
 *   Runtime authorization and rollback/reapply behavior is separately covered
 *   by the commit-bound two-lineage disposable-database qualification.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const sha256 = source => createHash('sha256').update(source).digest('hex');

const m1 = read(
  'supabase/migrations/20260801215912_notification_producer_authorization.sql',
);
const m2 = read(
  'supabase/migrations/20260802040935_preserve_notify_emit_event_id.sql',
);
const composition = read(
  'supabase/migrations/20260804153859_notification_producer_crew_phase_a_composition.sql',
);
const rollback = read(
  'supabase/rollbacks/20260804153859_notification_producer_crew_phase_a_composition.rollback.sql',
);

function functionBody(sql, signature) {
  const start = sql.indexOf(
    `CREATE OR REPLACE FUNCTION public.${signature}(`,
  );
  expect(start, `${signature} start`).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf('AS $function$\n', start);
  const end = sql.indexOf('\n$function$;', bodyStart);
  expect(bodyStart, `${signature} body`).toBeGreaterThan(start);
  expect(end, `${signature} end`).toBeGreaterThan(bodyStart);
  return sql.slice(bodyStart + 'AS $function$\n'.length, end);
}

describe('notification producer / Crew Phase-A composition source', () => {
  it('keeps the already-reviewed M1 and M2 sources immutable', () => {
    expect(sha256(m1)).toBe(
      'af5f8a9c47edb5317172401f186d526c695e1de20f84d964d56306d0c7817e5f',
    );
    expect(sha256(m2)).toBe(
      '5b49c17e6ddbc229b81510ce4d0099fa6ed0021bbcf3ef5c4d1a993eb79b694d',
    );
  });

  it('uses the exact final M2 transport behavior with a composition marker', () => {
    expect(functionBody(composition, 'notify_emit')).toBe(
      functionBody(m2, 'notify_emit'),
    );
    expect(composition).toContain(
      'UPR notification producer/crew Phase-A composition v1:',
    );
    expect(composition).toContain(
      "'ea3a9b3b6cca96722c008d7e9b23f6bc'",
    );
    expect(composition).toContain(
      "ARRAY['search_path=public']::text[]",
    );
    expect(composition).toContain(
      'GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb)\n  TO service_role;',
    );
  });

  it('never replaces the Phase-A appointment or crew authority surface', () => {
    for (const forbiddenDefinition of [
      'sync_appointment_crew',
      'update_appointment',
      'delete_appointment',
      'can_current_employee_manage_appointment_crew',
      'guard_appointment_command_write',
      'audit_appointment_crew_change',
      'assert_notification_producer_write',
      'is_current_notification_producer_actor',
      'can_current_employee_access_appointment',
      'can_current_employee_mutate_appointment',
      'is_current_appointment_manager',
      'enforce_private_appointment_role',
      'is_trusted_notification_producer_caller',
    ]) {
      expect(composition).not.toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${forbiddenDefinition}\\(`,
        ),
      );
    }
    expect(composition).not.toMatch(
      /ALTER POLICY all_(?:select|insert|update|delete)_(?:appointments|appointment_crew)/,
    );
    expect(composition).not.toMatch(
      /(?:GRANT|REVOKE)[\s\S]{0,100}ON TABLE public\.(?:appointments|appointment_crew)/,
    );
    expect(composition).not.toContain(
      'trg_appointments_notification_producer_authority',
    );
    expect(composition).not.toContain(
      'trg_appointment_crew_notification_producer_authority',
    );
  });

  it('fingerprints functions, policies, triggers, table ACLs, and column ACLs', () => {
    for (const marker of [
      'pg_get_functiondef(procedure.oid)',
      "LIKE 'UPR appointment crew atomic save/audit repair v1:%'",
      "'trg_appointments_atomic_command_guard'",
      "'trg_appointment_crew_actor_audit'",
      "policy.tablename IN ('appointments', 'appointment_crew')",
      "'table-acl'",
      "'column-acl'",
      'upr_phase_a_composition_snapshot',
      'upr_phase_a_composition_current',
      'changed the Phase-A authority surface',
      'PHASE-B BOUNDARY',
      'adoption-gated',
    ]) {
      expect(composition).toContain(marker);
    }
    expect(
      composition.match(/ARRAY\['search_path=""'\]::text\[\]/g),
    ).toHaveLength(8);
    expect(composition).not.toContain("ARRAY['search_path=']::text[]");
  });

  it('installs only contained notification state and the three FK indexes', () => {
    expect(composition).toContain(
      'CREATE TABLE IF NOT EXISTS public.notification_producer_occurrences',
    );
    expect(composition).toContain(
      'CREATE TABLE IF NOT EXISTS public.notification_delivery_claims',
    );
    expect(composition).not.toContain('public.notification_events');
    for (const index of [
      'notification_producer_occurrences_type_key_idx',
      'notification_delivery_claims_event_id_idx',
      'notification_delivery_claims_employee_id_idx',
    ]) {
      expect(composition).toContain(`CREATE INDEX IF NOT EXISTS ${index}`);
    }
    expect(composition).toContain(
      "employee.role::text IS DISTINCT FROM 'crm_partner'",
    );
    expect(composition).toContain(
      'CREATE OR REPLACE TRIGGER trg_appointments_bind_creator',
    );
    expect(composition).not.toContain('cron.unschedule');
    expect(composition).not.toMatch(
      /UPDATE public\.notification_types\s+SET enabled/iu,
    );
  });

  it('keeps rollback notification-only and preserves the Phase-A bridge', () => {
    expect(rollback).toContain(
      'UPR notification producer/crew Phase-A composition v1:',
    );
    expect(rollback).toContain('SET enabled = false');
    expect(rollback).not.toContain('SET enabled = true');
    expect(rollback).toContain('ON COMMIT PRESERVE ROWS');
    expect(rollback).toContain(
      'upr_composition_phase_a_current',
    );
    expect(rollback.match(/EXCEPT ALL/g)).toHaveLength(2);
    expect(rollback).toContain(
      "LIKE 'UPR appointment crew atomic save/audit repair v1:%'",
    );
    expect(rollback).toContain(
      'revoked the Phase-A legacy DML bridge',
    );
    expect(rollback).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.(?:sync_appointment_crew|update_appointment|delete_appointment)\(/,
    );
    expect(rollback).not.toMatch(
      /ALTER POLICY all_(?:select|insert|update|delete)_(?:appointments|appointment_crew)/,
    );
    expect(rollback).not.toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.sync_appointment_crew/,
    );
    expect(rollback).not.toMatch(
      /(?:GRANT|REVOKE)[\s\S]{0,100}ON TABLE public\.(?:appointments|appointment_crew)/,
    );
  });
});
