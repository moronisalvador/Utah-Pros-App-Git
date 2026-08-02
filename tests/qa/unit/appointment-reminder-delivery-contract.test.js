/**
 * ════════════════════════════════════════════════
 * FILE: appointment-reminder-delivery-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES:
 *   Guards the database/Worker release boundary for appointment reminders:
 *   stable producer occurrence ids survive notify_emit, caller-supplied type
 *   keys cannot override the function argument, and incident containment stays
 *   in place until a later activation migration.
 *
 * DATA:
 *   Reads migration and rollback source only. No database or network access.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20260802040935_preserve_notify_emit_event_id.sql',
    import.meta.url,
  ),
  'utf8',
);
const rollback = readFileSync(
  new URL(
    '../../../supabase/rollbacks/20260802040935_preserve_notify_emit_event_id.rollback.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('appointment reminder delivery release contract', () => {
  it('preserves a usable producer occurrence id and generates only a missing one', () => {
    expect(migration).toContain(
      "v_event_id := v_body -> 'notification_event_id';",
    );
    expect(migration).toContain(
      "NULLIF(btrim(v_body ->> 'notification_event_id'), '') IS NULL",
    );
    expect(migration).toContain(
      'v_event_id := to_jsonb(gen_random_uuid()::text);',
    );
    expect(migration).toContain(
      "'notification_event_id', v_event_id",
    );
    expect(migration).not.toMatch(
      /body\s*:=\s*COALESCE\(p_body[\s\S]*'notification_event_id',\s*gen_random_uuid\(\)/,
    );
  });

  it('keeps the function argument authoritative for the notification type', () => {
    expect(migration).toContain(
      "v_body := (v_body - 'type_key' - 'notification_event_id')",
    );
    expect(migration).toContain("'type_key', p_type_key");
  });

  it('contains the producer before replacing the compatible function', () => {
    const disable = migration.indexOf(
      "WHERE type_key = 'appointment.reminder'",
    );
    const unschedule = migration.indexOf(
      "WHERE jobname = 'upr_appointment_reminders'",
    );
    const replace = migration.indexOf(
      'CREATE OR REPLACE FUNCTION public.notify_emit',
    );
    expect(disable).toBeGreaterThan(-1);
    expect(unschedule).toBeGreaterThan(disable);
    expect(replace).toBeGreaterThan(unschedule);
    expect(migration).not.toMatch(
      /SET\s+enabled\s*=\s*true|cron\.schedule\s*\(/i,
    );
  });

  it('keeps notify_emit service-role-only in both directions', () => {
    for (const sql of [migration, rollback]) {
      expect(sql).toMatch(
        /REVOKE EXECUTE ON FUNCTION public\.notify_emit\(text, jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated;/,
      );
      expect(sql).toMatch(
        /GRANT EXECUTE ON FUNCTION public\.notify_emit\(text, jsonb\)[\s\S]*TO service_role;/,
      );
      expect(sql).not.toMatch(
        /GRANT EXECUTE ON FUNCTION public\.notify_emit[\s\S]*TO (?:PUBLIC|anon|authenticated)/,
      );
    }
  });

  it('never reactivates reminders during rollback', () => {
    expect(rollback).not.toMatch(
      /SET\s+enabled\s*=\s*true|cron\.schedule\s*\(/i,
    );
    expect(rollback).toContain('reminder containment drift');
  });
});
