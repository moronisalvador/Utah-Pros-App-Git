/**
 * ════════════════════════════════════════════════
 * FILE: appointment-reminder-delivery-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES:
 *   Guards stable reminder occurrence IDs, composition with the exact five
 *   private guarded producers, byte-exact rollback bodies, least privilege,
 *   incident containment, and explicit activation prerequisites.
 *
 * DATA:
 *   Reads repository source only. No database or network access.
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
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

function md5Prosrc(body) {
  return createHash('md5').update(`\n${body}\n`).digest('hex');
}

function directNotifyEmitBody(sql) {
  return sql.match(
    /CREATE OR REPLACE FUNCTION public\.notify_emit\([\s\S]*?AS \$function\$\n([\s\S]*?)\n\$function\$;/,
  )?.[1];
}

function rollbackNotifyEmitBody(tag) {
  return rollback.match(
    new RegExp(
      `\\$${tag}\\$\\nCREATE OR REPLACE FUNCTION public\\.notify_emit\\([\\s\\S]*?`
        + 'AS \\$function\\$\\n([\\s\\S]*?)\\n\\$function\\$;'
        + `\\n\\$${tag}\\$`,
    ),
  )?.[1];
}

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
    expect(migration).toContain("'notification_event_id', v_event_id");
  });

  it('keeps type_key authoritative and composes with the exact five guarded types', () => {
    expect(migration).toContain(
      "v_body := (v_body - 'type_key' - 'notification_event_id')",
    );
    expect(migration).toContain("'type_key', p_type_key");
    expect(migration).toContain(
      "to_regclass('public.notification_producer_occurrences') IS NULL",
    );
    expect(migration).toContain(
      'FROM public.notification_producer_occurrences occurrence',
    );
    expect(migration).toContain('occurrence.type_key = $2');
    expect(migration).toContain(
      "'appointment.assigned',\n    'appointment.updated',\n    'appointment.canceled',\n    'timesheet.change_requested',\n    'timesheet.change_reviewed'",
    );
    const guardedTypes = migration.match(
      /IF p_type_key IN \(([\s\S]*?)\n {2}\) THEN/,
    )?.[1];
    expect(guardedTypes).toBeTruthy();
    expect(guardedTypes).not.toContain('appointment.reminder');
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

  it('revokes every broad role before regranting service_role', () => {
    for (const sql of [migration, rollback]) {
      expect(sql).toMatch(
        /REVOKE EXECUTE ON FUNCTION public\.notify_emit\(text, jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/,
      );
      expect(sql).toMatch(
        /FROM PUBLIC, anon, authenticated, service_role;[\s\S]*GRANT EXECUTE ON FUNCTION public\.notify_emit\(text, jsonb\)[\s\S]*TO service_role;/,
      );
      expect(sql).not.toContain("has_function_privilege('PUBLIC'");
      expect(sql).toContain("acldefault('f', function_record.proowner)");
      expect(sql).toContain('acl.grantee = 0');
      expect(sql).toContain(
        "has_function_privilege('anon', v_oid, 'EXECUTE')",
      );
    }
  });

  it('mechanically ties forward and both rollback bodies to exact drift hashes', () => {
    const forwardBody = directNotifyEmitBody(migration);
    const guardedBody = rollbackNotifyEmitBody('guarded');
    const baselineBody = rollbackNotifyEmitBody('baseline');
    expect(forwardBody).toBeTruthy();
    expect(guardedBody).toBeTruthy();
    expect(baselineBody).toBeTruthy();

    expect(md5Prosrc(forwardBody)).toBe(
      'ea3a9b3b6cca96722c008d7e9b23f6bc',
    );
    expect(md5Prosrc(guardedBody)).toBe(
      '72d1973cff37b95c7149700a7c5bb5b7',
    );
    expect(md5Prosrc(baselineBody)).toBe(
      'c72e0f7fd40a4abec42cce1cd912a45b',
    );
    expect(migration).toContain(
      "md5(function_record.prosrc) = 'ea3a9b3b6cca96722c008d7e9b23f6bc'",
    );
    expect(rollback).toContain(
      "md5(function_record.prosrc) = 'ea3a9b3b6cca96722c008d7e9b23f6bc'",
    );
    expect(rollback).toContain(
      "v_expected_hash := '72d1973cff37b95c7149700a7c5bb5b7'",
    );
    expect(rollback).toContain(
      "v_expected_hash := 'c72e0f7fd40a4abec42cce1cd912a45b'",
    );
  });

  it('never reactivates reminders in either direction', () => {
    for (const sql of [migration, rollback]) {
      expect(sql).not.toMatch(
        /SET\s+enabled\s*=\s*true|cron\.schedule\s*\(/i,
      );
    }
    expect(rollback).toContain('containment drift');
  });

  it('keeps replay fencing and crew authority as tested activation gates', () => {
    const integrations = readFileSync(
      new URL('../../../docs/integrations.md', import.meta.url),
      'utf8',
    );
    const testing = readFileSync(
      new URL('../../../docs/testing-and-deployment.md', import.meta.url),
      'utf8',
    );
    for (const document of [integrations, testing]) {
      expect(document).toContain(
        'durable per-recipient/channel reminder delivery claims',
      );
      expect(document).toContain(
        'server-authoritative appointment crew',
      );
    }
  });
});
