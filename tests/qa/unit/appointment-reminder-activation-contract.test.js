/**
 * ════════════════════════════════════════════════
 * FILE: appointment-reminder-activation-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the inert reminder occurrence, current-target, replay, and rollback
 *   contract in a credential-free CI lane. Runtime database behavior remains a
 *   separate local/qa-staging qualification gate.
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('.');
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20260803223000_appointment_reminder_delivery_claims.sql',
  ),
  'utf8',
);
const rollback = fs.readFileSync(
  path.join(
    root,
    'supabase/rollbacks/20260803223000_appointment_reminder_delivery_claims.rollback.sql',
  ),
  'utf8',
);
const notify = fs.readFileSync(
  path.join(root, 'functions/api/notify.js'),
  'utf8',
);
const apns = fs.readFileSync(
  path.join(root, 'functions/lib/apns.js'),
  'utf8',
);

function dispatcherBody(sql) {
  return sql.match(
    /CREATE OR REPLACE FUNCTION public\.dispatch_due_appointment_reminders\(\)[\s\S]*?AS \$function\$\n([\s\S]*?)\n\$function\$;/,
  )?.[1];
}

function md5Prosrc(body) {
  return createHash('md5').update(`\n${body}\n`).digest('hex');
}

describe('appointment reminder activation contract', () => {
  it('accepts only the exact absent-QA or full-Production foundation shapes', () => {
    expect(migration).toContain(
      'IF v_foundation_objects NOT IN (0, 6) THEN',
    );
    expect(migration).toContain('IF v_foundation_objects = 6 THEN');
  });

  it('keeps the reminder outside the exact-five guarded producer set', () => {
    const guardedBlock = /export const GUARDED_PRODUCER_TYPES = new Set\(\[([\s\S]*?)\]\);/
      .exec(notify)?.[1] || '';
    expect(guardedBlock).toContain("'appointment.assigned'");
    expect(guardedBlock).toContain("'appointment.updated'");
    expect(guardedBlock).toContain("'appointment.canceled'");
    expect(guardedBlock).toContain('...TIMESHEET_AUDIENCE_TYPES');
    expect(guardedBlock).not.toContain('appointment.reminder');
  });

  it('creates a separate forced-RLS service-only reminder delivery ledger', () => {
    expect(migration).toContain(
      'CREATE TABLE public.appointment_reminder_delivery_claims',
    );
    expect(migration).toContain(
      'ALTER TABLE public.appointment_reminder_delivery_claims\n  FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*public\.appointment_reminder_delivery_claims[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, DELETE ON TABLE[\s\S]*public\.appointment_reminder_delivery_claims[\s\S]*TO service_role;/,
    );
    expect(migration).toContain('acl.grantee = 0');
    expect(migration).not.toMatch(
      /GRANT[\s\S]*appointment_reminder_delivery_claims[\s\S]*TO (PUBLIC|anon|authenticated)/,
    );
  });

  it('atomically binds every claim to enabled, due, scheduled current crew', () => {
    const validator = /CREATE FUNCTION public\.validate_appointment_reminder_delivery\(([\s\S]*?)\$function\$;/
      .exec(migration)?.[0] || '';
    expect(validator).toContain(
      "notification_type.type_key = 'appointment.reminder'",
    );
    expect(validator).toContain('notification_type.enabled IS TRUE');
    expect(validator).toContain("appointment.status = 'scheduled'");
    expect(validator).toContain("AT TIME ZONE 'America/Denver'");
    expect(validator).toContain("now() + interval '50 minutes'");
    expect(validator).toContain("now() + interval '70 minutes'");
    expect(validator).toContain(
      'crew.employee_id = reminder.employee_id',
    );
    expect(validator).toContain('employee.is_active IS TRUE');
    expect(validator).toContain('employee.is_external IS FALSE');

    for (const fn of [
      'claim_appointment_reminder_delivery',
      'claim_appointment_reminder_native_delivery',
    ]) {
      const block = new RegExp(
        `CREATE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$;`,
      ).exec(migration)?.[0] || '';
      expect(block).toContain(
        'public.validate_appointment_reminder_delivery(',
      );
      expect(block).toContain("current_user <> 'service_role'");
    }
  });

  it('validates exact bell, subscription, email, and native targets', () => {
    expect(migration).toContain("p_channel = 'bell'");
    expect(migration).toContain('p_target = p_employee_id::text');
    expect(migration).toContain(
      'subscription.employee_id = p_employee_id',
    );
    expect(migration).toContain('subscription.endpoint = p_target');
    expect(migration).toContain(
      'lower(btrim(employee.email)) = lower(btrim(p_target))',
    );
    expect(migration).toContain('token.employee_id = p_employee_id');
    expect(migration).toContain("token.platform = 'ios'");
    expect(migration).toContain(
      'token.apns_environment = p_apns_environment',
    );
  });

  it('re-emits one stable occurrence while channel claims absorb replay', () => {
    expect(migration).toContain(
      'ADD COLUMN notification_event_id text NOT NULL',
    );
    expect(migration).toContain(
      'ADD CONSTRAINT appointment_reminder_claims_event_id_key',
    );
    expect(migration).toContain(
      'CREATE INDEX appointment_reminder_claims_employee_idx',
    );
    expect(migration).toMatch(
      /ON CONFLICT \(\s*appointment_id,\s*employee_id,\s*appointment_starts_at\s*\) DO UPDATE[\s\S]*RETURNING notification_event_id/,
    );
    expect(migration).toContain(
      "PERFORM public.notify_emit(\n      'appointment.reminder'",
    );
    expect(migration).toContain(
      'Recipient/channel claims make a delivered replay a',
    );
  });

  it('routes Worker claims through the reminder-only database contract', () => {
    expect(notify).toContain(
      "db.rpc('validate_appointment_reminder_delivery'",
    );
    expect(notify).toContain(
      "'claim_appointment_reminder_delivery'",
    );
    expect(notify).toContain(
      "'release_appointment_reminder_delivery_claim'",
    );
    expect(notify).toContain('appointmentReminderClaim');
    expect(apns).toContain(
      "db.rpc('claim_appointment_reminder_native_delivery'",
    );
  });

  it('remains disabled and unscheduled in forward and rollback paths', () => {
    expect(migration).toContain(
      "WHERE type_key = 'appointment.reminder'",
    );
    expect(migration).toContain(
      "WHERE jobname = 'upr_appointment_reminders'",
    );
    expect(migration).not.toContain(
      "cron.schedule('upr_appointment_reminders'",
    );
    expect(rollback).toContain(
      "WHERE type_key = 'appointment.reminder'",
    );
    expect(rollback).toContain(
      "WHERE jobname = 'upr_appointment_reminders'",
    );
    expect(rollback).not.toContain(
      "cron.schedule('upr_appointment_reminders'",
    );
  });

  it('removes the new claim boundary before restoring the inert dispatcher', () => {
    const forwardDispatcherBody = dispatcherBody(migration);
    expect(forwardDispatcherBody).toBeTruthy();
    expect(md5Prosrc(forwardDispatcherBody)).toBe(
      'a0d8bbb5a8e871903330499c7d7e4d3b',
    );
    expect(rollback).toContain(
      "md5(function_record.prosrc) =\n           'a0d8bbb5a8e871903330499c7d7e4d3b'",
    );
    expect(rollback).toContain(
      "pg_get_userbyid(function_record.proowner) = 'postgres'",
    );
    expect(rollback).toContain('function_record.prosecdef');
    expect(rollback).toContain('acl.grantee = 0');
    expect(rollback).toContain(
      'appointment reminder claims rollback: dispatcher drift',
    );
    expect(rollback.indexOf('DO $preflight$')).toBeLessThan(
      rollback.indexOf('UPDATE public.notification_types'),
    );
    expect(rollback).toContain(
      'DROP FUNCTION public.claim_appointment_reminder_native_delivery',
    );
    expect(rollback).toContain(
      'DROP FUNCTION public.claim_appointment_reminder_delivery',
    );
    expect(rollback).toContain(
      'DROP TABLE public.appointment_reminder_delivery_claims;',
    );
    expect(rollback).toContain(
      'DROP COLUMN notification_event_id;',
    );
    expect(rollback).toContain(
      "'c010eb4a4cab2f0d00ede467a47e4148'",
    );
  });
});
