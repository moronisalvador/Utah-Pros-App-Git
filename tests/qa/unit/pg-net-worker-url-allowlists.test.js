/**
 * ════════════════════════════════════════════════
 * FILE: pg-net-worker-url-allowlists.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the worker-URL allowlist hardening visible in credential-free CI.
 *   After the 2026-07-30 push outage, an audit found two database functions
 *   (the Google-Calendar sync notifier and the notification emitter) would
 *   call whatever web address the integration_config settings table held.
 *   This test reads the migration SOURCE and asserts the fix is what it
 *   claims: an exact two-URL allowlist, a fail-closed secret gate, unchanged
 *   signatures, revoke-before-grant, no anon access, and a real rollback.
 *   It proves intent, not live effect — the behavioral proof runs against
 *   the qa-staging branch in the apply window (never presented as CI
 *   coverage, per close-out-standard.md 2b).
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  the 20260730214500 migration, its rollback, the post-apply
 *              check, and the two worker files the allowlists point at
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - The md5 literals are prosrc fingerprints: the pre-change ones anchor
 *     the migration's drift guard, the post-change ones anchor the rollback
 *     preflight. If you edit a function body you must recompute them — the
 *     migration and rollback will refuse to run otherwise, by design.
 * ════════════════════════════════════════════════
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read(
  'supabase/migrations/20260730214500_pg_net_worker_url_allowlists.sql',
);
const rollback = read(
  'supabase/rollbacks/20260730214500_pg_net_worker_url_allowlists.rollback.sql',
);
const postApply = read('supabase/tests/pg_net_worker_url_allowlists_post_apply.sql');

// Strip line comments so assertions hit executable SQL, not prose.
const executable = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');

const migrationSql = executable(migration);
const rollbackSql = executable(rollback);

const GCAL_URLS = [
  'https://dev.utahpros.app/api/google-calendar-sync',
  'https://utahpros.app/api/google-calendar-sync',
];
const NOTIFY_URLS = [
  'https://dev.utahpros.app/api/notify',
  'https://utahpros.app/api/notify',
];

describe('pg_net worker-URL allowlists (20260730214500)', () => {
  it('gates both callers on an exact two-URL allowlist', () => {
    for (const url of [...GCAL_URLS, ...NOTIFY_URLS]) {
      expect(migrationSql).toContain(`'${url}'`);
    }
    // The allowlist must be the refusal condition, not a comment or a seed.
    expect(migrationSql).toMatch(
      /IF v_worker_url IS NULL OR v_worker_url NOT IN \( 'https:\/\/dev\.utahpros\.app\/api\/google-calendar-sync', 'https:\/\/utahpros\.app\/api\/google-calendar-sync' \)/,
    );
    expect(migrationSql).toMatch(
      /IF v_url IS NULL OR v_url NOT IN \( 'https:\/\/dev\.utahpros\.app\/api\/notify', 'https:\/\/utahpros\.app\/api\/notify' \)/,
    );
    // No third URL sneaks into either list: exactly the four above.
    const urlLiterals = migrationSql.match(/'https:\/\/[^']+'/g) || [];
    expect(urlLiterals.sort()).toEqual(
      [...GCAL_URLS, ...NOTIFY_URLS].map((u) => `'${u}'`).sort(),
    );
  });

  it('fails closed on a missing or blank webhook secret in both bodies', () => {
    const gates = migrationSql.match(/NULLIF\(btrim\(v_secret\), ''\) IS NULL/g) || [];
    expect(gates).toHaveLength(2);
    // The blank-secret send path is gone: no COALESCE(v_secret, '') remains.
    expect(migrationSql).not.toContain("COALESCE(v_secret, '')");
  });

  it('preserves both deployed signatures, definer mode, and pinned search_path', () => {
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.notify_google_calendar_sync(p_source_id UUID, p_op TEXT, p_cancel JSONB DEFAULT NULL) RETURNS VOID',
    );
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.notify_emit( p_type_key text, p_body jsonb ) RETURNS void',
    );
    expect(migrationSql.match(/SECURITY DEFINER/g)).toHaveLength(2);
    expect(migrationSql).toContain('SET search_path = public');
    expect(migrationSql).toContain("SET search_path TO 'public'");
    // Function-body-only: no schema, table, policy, or trigger DDL.
    expect(migrationSql).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|POLICY|TRIGGER|INDEX|VIEW)\b/i,
    );
    expect(migrationSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it('re-declares the managed-project ACLs: revoke before grant, no anon, no widening', () => {
    const gcalRevoke = migrationSql.indexOf(
      'REVOKE EXECUTE ON FUNCTION public.notify_google_calendar_sync(uuid, text, jsonb) FROM PUBLIC, anon;',
    );
    const gcalGrant = migrationSql.indexOf(
      'GRANT EXECUTE ON FUNCTION public.notify_google_calendar_sync(uuid, text, jsonb) TO authenticated, service_role;',
    );
    const emitRevoke = migrationSql.indexOf(
      'REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb) FROM PUBLIC, anon, authenticated;',
    );
    const emitGrant = migrationSql.indexOf(
      'GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb) TO service_role;',
    );
    for (const index of [gcalRevoke, gcalGrant, emitRevoke, emitGrant]) {
      expect(index).toBeGreaterThan(-1);
    }
    expect(gcalRevoke).toBeLessThan(gcalGrant);
    expect(emitRevoke).toBeLessThan(emitGrant);
    expect(migrationSql).not.toMatch(/GRANT[^;]*TO[^;]*\b(?:anon|PUBLIC)\b/i);
    // notify_emit stays service-role-only: no authenticated grant on it.
    expect(migrationSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.notify_emit\([^;]*TO[^;]*authenticated/i,
    );
  });

  it('anchors the apply to the reviewed live bodies via md5 drift guards', () => {
    // Pre-change fingerprints (the 3f97… value is independently confirmed by
    // the 20260728224000 rollback preflight, which expects the same body).
    expect(migration).toContain('9c97af19a10e688964bc830f9d11c160');
    expect(migration).toContain('3f972d71b7995dd7787ef6ff2fb76872');
    // Post-change fingerprints in the migration postflight…
    expect(migration).toContain('9c12900f57b2516170dc374b5a63cc23');
    expect(migration).toContain('c72e0f7fd40a4abec42cce1cd912a45b');
    // …are the same ones the rollback preflight requires before undoing.
    expect(rollback).toContain('9c12900f57b2516170dc374b5a63cc23');
    expect(rollback).toContain('c72e0f7fd40a4abec42cce1cd912a45b');
  });

  it('ships a rollback that restores the exact prior bodies without reopening anon', () => {
    // Restored gates are the pre-allowlist originals…
    expect(rollbackSql).toContain(
      "IF v_worker_url IS NULL OR btrim(v_worker_url) = '' THEN RETURN; END IF;",
    );
    expect(rollbackSql).toContain(
      "IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;",
    );
    // …verified byte-exact against the source-migration fingerprints.
    expect(rollback).toContain('9c97af19a10e688964bc830f9d11c160');
    expect(rollback).toContain('3f972d71b7995dd7787ef6ff2fb76872');
    expect(rollbackSql).not.toMatch(/GRANT[^;]*TO[^;]*\b(?:anon|PUBLIC)\b/i);
    expect(rollback).toMatch(/REOPENS the config-driven arbitrary-URL surface/i);
  });

  it('ships a catalog-only post-apply check', () => {
    const code = executable(postApply);
    expect(code).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i,
    );
    expect(postApply).toContain('9c12900f57b2516170dc374b5a63cc23');
    expect(postApply).toContain('c72e0f7fd40a4abec42cce1cd912a45b');
    expect(code).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
  });

  it('points only at workers that exist in this repository', () => {
    expect(existsSync(join(root, 'functions/api/google-calendar-sync.js'))).toBe(true);
    expect(existsSync(join(root, 'functions/api/notify.js'))).toBe(true);
  });

  it('keeps the sibling wake-function allowlists this migration mirrors', () => {
    // The pattern reference must not rot: outbox + ops-health still allowlist.
    const outbox = read(
      'supabase/migrations/20260724001500_message_notification_outbox_scheduler.sql',
    );
    const opsHealth = read('supabase/migrations/20260725190000_ops_health_alerting.sql');
    expect(outbox).toContain("'https://utahpros.app/api/process-message-notification-outbox'");
    expect(opsHealth).toContain("'https://utahpros.app/api/ops-health'");
    for (const source of [outbox, opsHealth]) {
      expect(source).toMatch(/NOT IN \(/);
    }
  });
});
