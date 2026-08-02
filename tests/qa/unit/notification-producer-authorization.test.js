/**
 * ════════════════════════════════════════════════
 * FILE: notification-producer-authorization.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the five contained notification producers fail-closed while proving
 *   their checked-in repair has caller-bound actors, locked/idempotent database
 *   mutations, durable delivery identities, least-privilege grants, and
 *   diff-based appointment crew callers.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  the 20260801215912 migration/rollback, notify worker, and three
 *              appointment crew editors
 *   Data:      reads → repository source; writes → none
 *
 * NOTES / GOTCHAS:
 *   - Runtime RLS/RPC behavior is separately exercised only by the governed
 *     disposable-local SQL proof. This credential-free suite is the CI-visible
 *     contract for the authored migration.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const migration = source(
  'supabase/migrations/20260801215912_notification_producer_authorization.sql',
);
const rollback = source(
  'supabase/rollbacks/20260801215912_notification_producer_authorization.rollback.sql',
);
const notifyWorker = source('functions/api/notify.js');
const apnsWorker = source('functions/lib/apns.js');
const isolatedProof = source(
  'supabase/tests/notification_producer_authorization_isolated.sql',
);
const guardedTypes = [
  'appointment.assigned',
  'appointment.updated',
  'appointment.canceled',
  'timesheet.change_requested',
  'timesheet.change_reviewed',
];

function functionBody(sql, name, nextMarker) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = sql.indexOf(nextMarker, start);
  expect(start, `${name} function start`).toBeGreaterThan(-1);
  expect(end, `${name} function end`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('notification producer authorization migration', () => {
  it('keeps all five producer flags disabled before and after the repair', () => {
    expect(migration).toContain(
      'notification producer authorization requires all five flags disabled',
    );
    expect(migration).toContain(
      'notification producer authorization postflight found enabled flags',
    );
    expect(migration).toContain('SET enabled = false');
    expect(rollback).toContain('SET enabled = false');
    expect(rollback).not.toContain('SET enabled = true');
    for (const typeKey of guardedTypes) {
      expect(migration).toContain(`'${typeKey}'`);
      expect(rollback).toContain(`'${typeKey}'`);
    }
  });

  it('binds browser actor ids to auth.uid and rejects inactive/external users', () => {
    const actor = functionBody(
      migration,
      'require_notification_producer_actor',
      'ALTER FUNCTION public.require_notification_producer_actor',
    );
    expect(actor).toContain('employee.auth_user_id = auth.uid()');
    expect(actor).toContain('employee.is_active IS TRUE');
    expect(actor).toContain('employee.is_external IS FALSE');
    expect(actor).toContain(
      'p_supplied_actor_id IS DISTINCT FROM v_actor.id',
    );
    expect(actor).toContain(
      "'NOT_AUTHORIZED: actor does not match authenticated employee'",
    );

    for (const rpc of [
      'update_appointment',
      'delete_appointment',
      'submit_time_entry_change_request',
      'review_time_entry_change_request',
      'sync_appointment_crew',
    ]) {
      const rpcBody = functionBody(
        migration,
        rpc,
        `ALTER FUNCTION public.${rpc}`,
      );
      expect(rpcBody).toContain(
        'public.require_notification_producer_actor(',
      );
    }
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.can_current_employee_access_appointment(',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.can_current_employee_manage_appointment_crew(',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.can_current_employee_mutate_appointment(',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.is_current_appointment_manager()',
    );
    expect(migration).toContain(
      'ADD COLUMN created_by_employee_id uuid',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.bind_appointment_creator()',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.is_trusted_notification_producer_caller()',
    );
    expect(migration).toContain(
      "'NOT_AUTHORIZED: appointment creator does not match caller'",
    );
    expect(migration).toContain('appointment.is_private IS FALSE');
    expect(migration).toContain(
      "employee.role::text IN ('admin', 'project_manager')",
    );
    expect(migration).toContain(
      'crew.employee_id = employee.id',
    );
    expect(migration).toContain('ALTER POLICY all_select_appointments');
    expect(migration).toContain(
      'public.can_current_employee_manage_appointment_crew(appointment_id)',
    );
    expect(migration).toContain(
      'public.can_current_employee_mutate_appointment(id)',
    );
    expect(migration).toContain(
      "'NOT_AUTHORIZED: only active internal admins or project managers may change appointment privacy'",
    );
    expect(migration).toContain(
      "'NOT_AUTHORIZED: appointment crew identity is immutable'",
    );
    expect(migration).toContain(
      "'NOT_AUTHORIZED: active internal appointment crew required'",
    );
    expect(migration).toContain(
      'NEW.employee_id IS DISTINCT FROM OLD.employee_id',
    );
    expect(migration).toContain(
      "'public.enforce_private_appointment_role()'::regprocedure",
    );
    expect(migration).toContain(
      'OLD.is_private IS DISTINCT FROM NEW.is_private',
    );
    expect(migration).not.toContain('DROP POLICY');
  });

  it('freezes exact appointment policies/triggers and scopes timesheet request reads', () => {
    expect(migration).toContain(
      "policy.tablename IN ('appointments', 'appointment_crew')",
    );
    expect(migration).toContain(") <> 8");
    expect(migration).toContain("policy.cmd = expected.command");
    expect(migration).toContain("policy.permissive = 'PERMISSIVE'");
    expect(migration).toContain(
      "policy.roles = ARRAY['authenticated'::name]",
    );
    for (const triggerName of [
      'trg_enforce_private_appointment',
      'trg_appointment_notify',
      'trg_appointment_crew_notify',
      'trg_appointments_bind_creator',
    ]) {
      expect(migration).toContain(`'${triggerName}'`);
    }
    expect(migration).toContain("trigger.tgenabled IN ('O', 'A')");
    expect(migration).toContain('trigger.tgqual IS NULL');
    expect(migration).toContain("trigger.tgattr = ''::int2vector");
    expect(migration).toContain('trigger.tgnargs = 0');

    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.can_current_employee_read_time_entry_change_request(',
    );
    expect(migration).toContain('ALTER POLICY tecr_read');
    expect(migration).toContain(
      "ARRAY['anon'::name, 'authenticated'::name]",
    );
    expect(migration).toContain(
      'ALTER TABLE public.time_entry_change_requests ENABLE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.time_entry_change_requests FROM PUBLIC, anon;',
    );
    expect(migration).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
    );
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.time_entry_change_requests TO authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.can_current_employee_read_time_entry_change_request(uuid)\n  TO authenticated, service_role;',
    );
    expect(migration).toContain(
      'employee.id = p_requested_by',
    );
    for (const role of [
      "'admin'",
      "'office'",
      "'project_manager'",
      "'supervisor'",
    ]) {
      expect(migration).toContain(role);
    }
    expect(migration).toContain(
      "policy.tablename = 'time_entry_change_requests'",
    );
    expect(migration).toContain(") <> 1");
    for (const proof of [
      'requester could not read their own change request',
      'unrelated employee read another timesheet request',
      'inactive employee read a timesheet request',
      'external employee read a timesheet request',
      'orphan account read a timesheet request',
      'admin RequestsView lost timesheet request access',
    ]) {
      expect(isolatedProof).toContain(proof);
    }
  });

  it('serializes crew and timesheet decisions and makes exact submit retries idempotent', () => {
    const crew = functionBody(
      migration,
      'sync_appointment_crew',
      'ALTER FUNCTION public.sync_appointment_crew',
    );
    expect(crew).toContain('FOR UPDATE');
    expect(crew).toContain('duplicate crew member');
    expect(crew).toContain('active internal crew required');
    expect(crew).toMatch(/\bDELETE FROM public\.appointment_crew\b/);
    expect(crew).toMatch(/\bUPDATE public\.appointment_crew\b/);
    expect(crew).toMatch(/\bINSERT INTO public\.appointment_crew\b/);
    expect(crew).toContain(
      'ON CONFLICT (appointment_id, employee_id) DO NOTHING',
    );

    const submit = functionBody(
      migration,
      'submit_time_entry_change_request',
      'CREATE OR REPLACE FUNCTION public.review_time_entry_change_request',
    );
    expect(submit.match(/FOR UPDATE/g)).toHaveLength(2);
    expect(submit).toContain('v_request.proposed = v_proposed');
    expect(submit).toContain(
      'v_request.tech_note IS NOT DISTINCT FROM p_tech_note',
    );
    expect(submit).toContain('RETURN v_request;');
    expect(submit).toContain("'PENDING_REQUEST_EXISTS'");

    const review = functionBody(
      migration,
      'review_time_entry_change_request',
      'ALTER FUNCTION public.submit_time_entry_change_request',
    );
    expect(review).toContain('FOR UPDATE');
    expect(review).toContain("'REQUEST_ALREADY_REVIEWED'");

    const update = functionBody(
      migration,
      'update_appointment',
      'ALTER FUNCTION public.update_appointment',
    );
    expect(update).toContain('FOR UPDATE');
    expect(update).toContain(
      'public.can_current_employee_mutate_appointment(p_appointment_id)',
    );
    expect(update).toContain(
      'NOT public.is_trusted_notification_producer_caller()',
    );
    expect(crew).toContain(
      'public.can_current_employee_manage_appointment_crew(',
    );

    const remove = functionBody(
      migration,
      'delete_appointment',
      'ALTER FUNCTION public.delete_appointment',
    );
    expect(remove).toContain('FOR UPDATE');
    expect(remove).toContain(
      'public.can_current_employee_mutate_appointment(',
    );
    expect(remove).toContain(
      'NOT public.is_trusted_notification_producer_caller()',
    );
    expect(remove).toContain(
      'public.require_notification_producer_actor(p_actor_id, false)',
    );
  });

  it('keeps occurrence and generic delivery claims private and service-only', () => {
    expect(migration).toContain(
      'ALTER TABLE public.notification_producer_occurrences\n  FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'CREATE POLICY notification_producer_occurrences_service_role',
    );
    expect(migration).toContain(
      'ALTER TABLE public.notification_delivery_claims\n  FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'ON CONFLICT (delivery_key) DO NOTHING',
    );
    expect(migration).toContain(
      "IF current_user <> 'service_role' THEN",
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.validate_notification_producer_delivery(',
    );
    expect(migration).toContain(
      'occurrence.entity_type = p_entity_type',
    );
    expect(migration).toContain(
      'occurrence.entity_id = p_entity_id',
    );
    expect(migration).toContain('crew.id = p_entity_id');
    expect(migration).toContain(
      'crew.appointment_id = p_entity_id',
    );
    expect(migration).toContain(
      "employee.role::text = 'admin'",
    );
    expect(migration).toContain(
      'request.requested_by = p_employee_id',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(',
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.claim_guarded_native_push_delivery(',
    );
    expect(migration).toContain('token.token = p_token');
    expect(migration).toContain("token.platform = 'ios'");
    expect(migration).toContain(
      'token.apns_environment = p_apns_environment',
    );
    expect(migration).toContain(
      'CREATE FUNCTION public.claim_guarded_notification_target_delivery(',
    );
    expect(migration).toContain(
      'subscription.endpoint = p_target',
    );
    expect(migration).toContain(
      'lower(btrim(employee.email)) = lower(btrim(p_target))',
    );
    expect(migration).toContain(
      'public.validate_notification_producer_delivery(',
    );
    expect(migration).toContain(
      ') TO service_role;',
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)[^;]*notification_(?:producer_occurrences|delivery_claims)[^;]*\bTO\s+(?:PUBLIC|anon|authenticated)\b/is,
    );
  });

  it('requires a ledger-backed occurrence UUID and claims each non-native channel', () => {
    expect(migration).toContain(
      "|| jsonb_build_object('notification_event_id', v_occurrence_id)",
    );
    expect(migration).toContain(
      "'appointment.assigned',\n    'appointment.assigned:' || NEW.id::text,\n    'appointment_crew',\n    NEW.id",
    );
    expect(migration).toContain("'appointment_crew_id', NEW.id");
    expect(migration).toContain(
      'FROM public.notification_producer_occurrences occurrence',
    );
    expect(notifyWorker).toContain(
      'export const GUARDED_PRODUCER_TYPES = new Set([',
    );
    expect(notifyWorker).toContain(
      "reason: 'missing_notification_event_id'",
    );
    for (const channel of ['bell', 'pwa_push', 'email']) {
      expect(notifyWorker).toContain(`channel: '${channel}'`);
    }
    expect(notifyWorker).toContain(
      "db.rpc('claim_notification_delivery'",
    );
    expect(notifyWorker).toContain(
      "db.rpc('release_notification_delivery_claim'",
    );
    expect(notifyWorker).toContain('guardedProducerClaim: {');
    expect(apnsWorker).toContain(
      "db.rpc('claim_guarded_native_push_delivery'",
    );
    expect(notifyWorker).toContain(
      "'claim_guarded_notification_target_delivery'",
    );
    expect(notifyWorker.indexOf(
      'if (TIMESHEET_AUDIENCE_TYPES.has(typeKey))',
    )).toBeLessThan(
      notifyWorker.indexOf(
        'if (Array.isArray(body.recipient_ids) && body.recipient_ids.length)',
      ),
    );
    expect(notifyWorker).toContain(
      "'time_entry_change_requests',",
    );
    expect(notifyWorker).toContain(
      "entity_type: 'time_entry_change_request'",
    );
    expect(notifyWorker).toContain(
      "link: '/time-tracking'",
    );
  });

  it('routes every deployed destructive crew editor through the diff RPC', () => {
    for (const path of [
      'src/pages/tech/TechEditAppointment.jsx',
      'src/components/EditAppointmentModal.jsx',
      'src/components/EventModal.jsx',
    ]) {
      const caller = source(path);
      expect(caller, path).toContain("db.rpc('sync_appointment_crew'");
      expect(caller, path).not.toContain(
        "db.delete('appointment_crew'",
      );
    }

    const techEditor = source('src/pages/tech/TechEditAppointment.jsx');
    expect(techEditor).toContain('shouldSyncAppointmentCrew({');
    expect(techEditor).toContain(
      'const canEditCrew = !isPrivate || canTogglePrivate;',
    );
    expect(techEditor).toContain('{canEditCrew && showCrew && (');
  });
});
