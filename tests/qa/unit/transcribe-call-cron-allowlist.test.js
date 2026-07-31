/**
 * ════════════════════════════════════════════════
 * FILE: transcribe-call-cron-allowlist.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the transcribe-call cron hardening visible in credential-free CI.
 *   The two pg_cron safety nets (backfill + reclassify) used to inline a
 *   net.http_post whose target URL came straight from the integration_config
 *   settings table — a rewritten row would redirect the call (and the shared
 *   cron secret header) to any host. This test reads the migration SOURCE and
 *   asserts the fix is what it claims: each command moved into a SECURITY
 *   DEFINER wake function with an exact two-URL allowlist, a fail-closed
 *   secret gate, a zero-grant ACL (cron runs as the postgres job owner),
 *   preserved job names/schedules/payloads/timeout, and a real rollback.
 *   It proves intent, not live effect — the behavioral proof runs against
 *   the qa-staging branch in the apply window (never presented as CI
 *   coverage, per close-out-standard.md 2b).
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  the 20260731100000 migration, its rollback, the post-apply
 *              check, the 20260722 cron migration it repoints, the worker it
 *              targets, and the worker-URL registry doc
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - The rollback restores the ORIGINAL inlined commands byte-for-byte from
 *     20260722_crm_calls_classification_cron.sql, so that file is asserted
 *     unchanged here — editing it would silently desynchronize the rollback.
 * ════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20260731100000_transcribe_call_cron_allowlist.sql',
);
const rollback = read(
  'supabase/rollbacks/20260731100000_transcribe_call_cron_allowlist.rollback.sql',
);
const postApply = read('supabase/tests/transcribe_call_cron_allowlist_post_apply.sql');
const originalCron = read('supabase/migrations/20260722_crm_calls_classification_cron.sql');

// Strip line comments so assertions hit executable SQL, not prose.
const executable = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

const migrationSql = executable(migration);
const rollbackSql = executable(rollback);

const ALLOWED_URLS = [
  'https://dev.utahpros.app/api/transcribe-call',
  'https://utahpros.app/api/transcribe-call',
];
const GATE = "IF v_worker_url IS NULL OR v_worker_url NOT IN ( "
  + "'https://dev.utahpros.app/api/transcribe-call', "
  + "'https://utahpros.app/api/transcribe-call' "
  + ") OR NULLIF(btrim(v_secret), '') IS NULL THEN RETURN; END IF;";

describe('transcribe-call cron allowlist (20260731100000)', () => {
  it('gates both wake functions on the exact two-URL allowlist', () => {
    expect(countOf(migrationSql, GATE)).toBe(2);
    // No third URL sneaks in: exactly the two allowed URLs, once per body.
    const urlLiterals = migrationSql.match(/'https:\/\/[^']+'/g) || [];
    expect(urlLiterals.sort()).toEqual(
      [...ALLOWED_URLS, ...ALLOWED_URLS].map((u) => `'${u}'`).sort(),
    );
  });

  it('fails closed on a missing or blank cron secret in both bodies', () => {
    const gates = migrationSql.match(/NULLIF\(btrim\(v_secret\), ''\) IS NULL/g) || [];
    expect(gates).toHaveLength(2);
    expect(migrationSql).not.toContain("COALESCE(v_secret, '')");
  });

  it('creates both functions as pinned-search_path SECURITY DEFINERs', () => {
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.wake_transcribe_call_backfill() '
      + 'RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public',
    );
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.wake_transcribe_call_reclassify() '
      + 'RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public',
    );
    expect(migrationSql.match(/SECURITY DEFINER/g)).toHaveLength(2);
    // Function + cron repoint only: no schema, table, policy, or data DDL/DML.
    expect(migrationSql).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|TRIGGER|INDEX|VIEW)\b/i,
    );
    expect(migrationSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it('leaves both functions zero-grant: owner-only execution for pg_cron', () => {
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.wake_transcribe_call_backfill() '
      + 'FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.wake_transcribe_call_reclassify() '
      + 'FROM PUBLIC, anon, authenticated, service_role;',
    );
    // The canonical wake posture grants NOBODY — cron executes as the
    // postgres job owner. Any GRANT here would be a widening regression.
    expect(migrationSql).not.toMatch(/\bGRANT\b/i);
  });

  it('re-points both jobs preserving exact names, schedules, and payloads', () => {
    expect(migrationSql).toContain(
      "SELECT cron.schedule( 'upr_calls_backfill_safety_net', '20 */6 * * *', "
      + '$$SELECT public.wake_transcribe_call_backfill();$$ );',
    );
    expect(migrationSql).toContain(
      "SELECT cron.schedule( 'upr_calls_reclassify_safety_net', '40 */6 * * *', "
      + '$$SELECT public.wake_transcribe_call_reclassify();$$ );',
    );
    // The payloads and 60s timeout moved into the function bodies unchanged.
    expect(migrationSql).toContain("body := jsonb_build_object('backfill', true, 'days', 3)");
    expect(migrationSql).toContain("body := jsonb_build_object('reclassify', true)");
    expect(migrationSql.match(/timeout_milliseconds := 60000/g)).toHaveLength(2);
    // The unschedule half of the swap is present and guarded (idempotent).
    for (const job of ['upr_calls_backfill_safety_net', 'upr_calls_reclassify_safety_net']) {
      expect(migrationSql).toContain(`PERFORM cron.unschedule('${job}');`);
    }
  });

  it('leaves no inlined config-driven post in any cron command string', () => {
    // $$...$$ blocks are the cron commands; net.http_post may live only
    // inside the $function$-delimited wake bodies.
    expect(migrationSql).not.toMatch(/\$\$[^$]*net\.http_post/);
    expect(migrationSql).not.toMatch(/\$\$[^$]*integration_config/);
  });

  it('ships a rollback that restores the original inlined commands, then drops the functions', () => {
    // The restored commands are the 20260722 originals: config-driven URL +
    // secret lookups, same payloads, schedules, and timeout.
    expect(countOf(
      rollbackSql,
      "url := (SELECT value FROM integration_config WHERE key = 'transcribe_call_worker_url')",
    )).toBe(2);
    expect(rollbackSql).toContain("body := jsonb_build_object('backfill', true, 'days', 3)");
    expect(rollbackSql).toContain("body := jsonb_build_object('reclassify', true)");
    expect(rollbackSql).toContain("'20 */6 * * *'");
    expect(rollbackSql).toContain("'40 */6 * * *'");
    // Both wake functions are removed — after the commands stop naming them.
    const firstSchedule = rollbackSql.indexOf('cron.schedule');
    const backfillDrop = rollbackSql.indexOf(
      'DROP FUNCTION IF EXISTS public.wake_transcribe_call_backfill();',
    );
    const reclassifyDrop = rollbackSql.indexOf(
      'DROP FUNCTION IF EXISTS public.wake_transcribe_call_reclassify();',
    );
    expect(firstSchedule).toBeGreaterThan(-1);
    expect(backfillDrop).toBeGreaterThan(firstSchedule);
    expect(reclassifyDrop).toBeGreaterThan(firstSchedule);
    // The rollback names its cost and never widens the ACL surface.
    expect(rollback).toMatch(/REOPENS the config-driven arbitrary-URL surface/i);
    expect(rollbackSql).not.toMatch(/\bGRANT\b/i);
  });

  it('keeps the 20260722 source of the restored commands unchanged', () => {
    // The rollback copies these byte-for-byte; if this migration drifts, the
    // rollback silently stops restoring the true prior state.
    expect(originalCron).toContain("'20 */6 * * *'");
    expect(originalCron).toContain("'40 */6 * * *'");
    expect(originalCron).toContain(
      "url := (SELECT value FROM integration_config WHERE key = 'transcribe_call_worker_url')",
    );
    expect(originalCron).toContain("body := jsonb_build_object('backfill', true, 'days', 3)");
    expect(originalCron).toContain("body := jsonb_build_object('reclassify', true)");
  });

  it('ships a catalog-only post-apply check', () => {
    const code = executable(postApply);
    expect(code).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i,
    );
    expect(code).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(code).toContain("has_function_privilege('service_role', v_oid, 'EXECUTE')");
    for (const job of ['upr_calls_backfill_safety_net', 'upr_calls_reclassify_safety_net']) {
      expect(code).toContain(`'${job}'`);
    }
  });

  it('points only at a worker that exists in this repository', () => {
    expect(existsSync(join(root, 'functions/api/transcribe-call.js'))).toBe(true);
  });

  it('closes the registry gap it was authored for', () => {
    const registry = read('docs/database/integration-config-worker-urls.md');
    expect(registry).toContain('wake_transcribe_call_backfill');
    expect(registry).toContain('wake_transcribe_call_reclassify');
    expect(registry).toContain('20260731100000');
    // The transcribe row was the last ❌ in the registry table.
    expect(registry).not.toContain('❌ **no allowlist**');
  });

  it('keeps the canonical wake-function pattern this migration copies', () => {
    const opsHealth = read('supabase/migrations/20260725190000_ops_health_alerting.sql');
    expect(opsHealth).toContain("'https://utahpros.app/api/ops-health'");
    expect(opsHealth).toMatch(/NOT IN \(/);
  });
});
