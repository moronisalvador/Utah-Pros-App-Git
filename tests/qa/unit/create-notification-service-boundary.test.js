/**
 * ════════════════════════════════════════════════
 * FILE: create-notification-service-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the S1f bell-emission authorization patch visible in credential-free CI.
 *   It checks source intent only and never connects to Supabase or creates a notification.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  S1f migration, rollback, catalog checks, and trusted Worker caller
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - Applied role behavior remains a separate owner-authorized database-window proof.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20260726194300_create_notification_service_boundary.sql',
);
const rollback = read(
  'supabase/rollbacks/20260726194300_create_notification_service_boundary.rollback.sql',
);
const preflight = read('supabase/tests/create_notification_service_boundary_preflight.sql');
const postApply = read('supabase/tests/create_notification_service_boundary_post_apply.sql');
const notifyWorker = read('functions/api/notify.js');
const workerSupabase = read('functions/lib/supabase.js');
const executable = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');

describe('S1f create_notification service boundary', () => {
  it('removes direct browser execution and retains the trusted Worker role', () => {
    const sql = executable(migration);
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.create_notification(text,text,text,text,text,uuid,uuid,jsonb,uuid,text) TO service_role;',
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_notification\([^;]+\) TO (?:PUBLIC|anon|authenticated)/i,
    );
  });

  it('is attribute-only and pins the exact live body and database caller', () => {
    const sql = executable(migration);
    expect(sql).not.toMatch(/\bCREATE OR REPLACE FUNCTION\b/i);
    expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|TRIGGER)\b/i);
    expect(migration).toContain('939e2f34e6397672fa5a974c4a67d3cd');
    expect(migration).toContain('29ccd83a067aefbcb27a89e9a9a71bea');
    expect(migration).toContain('public.apply_midnight_clock_split()');
    expect(migration).toContain('53b9c36e5deeeb3ded60136a97b079a1');
  });

  it('preserves the sole checked-in runtime API caller behind the service client', () => {
    expect(notifyWorker).toContain("await db.rpc('create_notification'");
    expect(notifyWorker).toContain('export async function dispatchToRecipient');
    expect(notifyWorker).toContain(
      'db: supabase(env, fetchWithTimeout)',
    );
    expect(workerSupabase).toContain('const key = env.SUPABASE_SERVICE_ROLE_KEY');
    expect(workerSupabase).toContain("'apikey': key");
    expect(workerSupabase).toContain("'Authorization': `Bearer ${key}`");
  });

  it('ships catalog-only apply checks and an explicit unsafe rollback', () => {
    for (const sql of [preflight, postApply]) {
      const code = executable(sql);
      expect(code).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i,
      );
      expect(code).not.toMatch(/\bPERFORM\s+(?:public\.)?create_notification\s*\(/i);
    }
    expect(postApply).toContain(
      "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    );
    expect(rollback).toContain('TO authenticated, service_role');
    expect(rollback).toMatch(/reopens arbitrary bell emission/i);
    expect(rollback).toContain(
      "v_execute_grantees IS DISTINCT FROM ARRAY['postgres', 'service_role']::text[]",
    );
    expect(rollback).toContain(
      "ARRAY['authenticated', 'postgres', 'service_role']::text[]",
    );
    expect(rollback.match(/v_grantable_count IS DISTINCT FROM 0/g)).toHaveLength(2);
    expect(rollback.match(/29ccd83a067aefbcb27a89e9a9a71bea/g)).toHaveLength(2);
  });
});
