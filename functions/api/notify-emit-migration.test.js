/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FILE: notify-emit-migration.test.js
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the S1d database patch removes direct browser notification emission, preserves the
 *   verified trigger/cron transport contract, makes the trusted type key authoritative, and has an
 *   exact emergency rollback. Nothing in this test connects to Supabase or invokes a notification.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  S1d migration/rollback/preflight/post-apply SQL, notification caller migrations,
 *              migration provenance manifest and dated live provenance evidence
 *   Data:      reads  → repository files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Live application is deliberately outside this test. Representative role checks and any
 *     synthetic trigger canary require a later owner-authorized shared-database window.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20260726110000_notify_emit_service_boundary.sql';
const rollbackName = '20260726110000_notify_emit_service_boundary.rollback.sql';

const read = (path) => readFileSync(resolve(root, path), 'utf8');
const migration = read(`supabase/migrations/${migrationName}`);
const rollback = read(`supabase/rollbacks/${rollbackName}`);
const preflight = read('supabase/tests/notify_emit_service_boundary_preflight.sql');
const postApply = read('supabase/tests/notify_emit_service_boundary_post_apply.sql');
const foundation = read('supabase/migrations/20260703_notify_f2_foundation.sql');
const estimateCaller = read('supabase/migrations/20260704_notify_estimate_accepted.sql');
const timesheetCallers = read('supabase/migrations/20260704_notify_timesheet_events.sql');
const clockCaller = read('supabase/migrations/20260704_notify_clock_abandoned_scan.sql');
const callerSources = [foundation, estimateCaller, timesheetCallers, clockCaller].join('\n');
const provenanceManifest = JSON.parse(read('scripts/migration-provenance-manifest.json'));
const provenanceEvidence = JSON.parse(
  read('docs/audit/2026-07/evidence/migration-provenance-2026-07-24.json'),
);

const oldMerge =
  "jsonb_build_object('type_key', p_type_key) || COALESCE(p_body, '{}'::jsonb)";
const trustedMerge =
  "COALESCE(p_body, '{}'::jsonb) || jsonb_build_object('type_key', p_type_key)";

function functionBody(sql) {
  const signature = 'CREATE OR REPLACE FUNCTION public.notify_emit';
  const signatureStart = sql.indexOf(signature);
  expect(signatureStart).toBeGreaterThanOrEqual(0);
  const bodyStart = sql.indexOf('AS $$', signatureStart) + 'AS $$'.length;
  const bodyEnd = sql.indexOf('$$;', bodyStart);
  expect(bodyStart).toBeGreaterThan('AS $$'.length - 1);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return sql.slice(bodyStart, bodyEnd);
}

function squashSql(sql) {
  return sql.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
}

function executableSql(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(?:js|jsx|ts|tsx)$/.test(entry.name) || /\.test\.[jt]sx?$/.test(entry.name)) {
      return [];
    }
    return [path];
  });
}

describe('notify_emit service boundary migration', () => {
  it('changes only the live body merge expression and preserves every HTTP transport detail', () => {
    const forwardBody = functionBody(migration);
    const priorBody = functionBody(rollback);

    expect(forwardBody).toBe(priorBody.replace(oldMerge, trustedMerge));
    expect(forwardBody).toContain("WHERE key = 'notify_worker_url'");
    expect(forwardBody).toContain("WHERE key = 'notify_webhook_secret'");
    expect(forwardBody).toContain('PERFORM net.http_post(');
    expect(forwardBody).toContain('url := v_url');
    expect(forwardBody).toContain(
      "jsonb_build_object('Content-Type','application/json','x-webhook-secret', COALESCE(v_secret,''))",
    );
    expect(forwardBody).not.toMatch(/\bINTO\s+v_(?:request|response)/i);
    expect(forwardBody).not.toMatch(/\bEXCEPTION\b/i);
  });

  it('makes the trusted event type win for every verified object-body caller', () => {
    const forwardBody = functionBody(migration);
    expect(forwardBody).toContain(trustedMerge);
    expect(forwardBody).not.toContain(oldMerge);

    const calls = [...callerSources.matchAll(
      /(?:public\.)?notify_emit\s*\(\s*'([^']+)'\s*,\s*jsonb_build_object\s*\(/g,
    )].map((match) => match[1]);

    expect(calls.sort()).toEqual([
      'appointment.assigned',
      'appointment.canceled',
      'appointment.updated',
      'clock.abandoned',
      'estimate.accepted',
      'timesheet.change_requested',
      'timesheet.change_reviewed',
    ]);
  });

  it('denies PUBLIC, anon, and authenticated while retaining only service_role', () => {
    const sql = squashSql(migration);
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb) FROM PUBLIC, anon, authenticated;',
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb) TO service_role;',
    );
    expect(executableSql(migration)).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.notify_emit\([^;]+\) TO (?:PUBLIC|anon|authenticated)/i,
    );
    expect(postApply).toContain('acl.grantee = 0');
    expect(postApply).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(postApply).toContain(
      "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    );
    expect(postApply).toContain("has_function_privilege('service_role', v_oid, 'EXECUTE')");
    expect(migration.match(/v_grantable_count IS DISTINCT FROM 0/g)).toHaveLength(2);
    expect(postApply).toContain('v_grantable_count IS DISTINCT FROM 0');
  });

  it('preserves trigger/cron execution without adding an in-body role check', () => {
    const forwardBody = functionBody(migration);
    expect(forwardBody).not.toMatch(/\b(?:auth\.role|current_user|session_user)\b/i);
    expect(migration).toContain('v_caller_security_definer IS DISTINCT FROM true');
    expect(migration).toContain("v_caller_owner IS DISTINCT FROM 'postgres'");
    expect(migration).toContain('v_caller_count IS DISTINCT FROM 6');
    expect(migration).toContain('v_call_site_count IS DISTINCT FROM 7');
    expect(migration).toContain('regexp_count(');
    expect(migration).toContain("E'\\\\mnotify_emit[[:space:]]*\\\\('");
    expect(migration).toContain("jobname = 'upr_scan_abandoned_clocks'");
    expect(migration).toContain("username = 'postgres'");
    expect(clockCaller).toContain(
      'REVOKE ALL ON FUNCTION public.scan_abandoned_clocks(timestamptz, int) FROM PUBLIC, anon, authenticated;',
    );
  });

  it('does not replace any direct caller, trigger, schedule, table, or policy', () => {
    const replacedFunctions = [...migration.matchAll(
      /CREATE OR REPLACE FUNCTION\s+([^\s(]+)/gi,
    )].map((match) => match[1]);

    expect(replacedFunctions).toEqual(['public.notify_emit']);
    expect(executableSql(migration)).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:TRIGGER|TABLE|POLICY)\b/i,
    );
    expect(executableSql(migration)).not.toMatch(/\bcron\.(?:schedule|unschedule)\s*\(/i);
  });

  it('pins null, disabled-type, missing-URL, pg_net, and ignored-response behavior', () => {
    const forwardBody = functionBody(migration);
    expect(forwardBody).toContain('IF p_type_key IS NULL THEN RETURN; END IF;');
    expect(forwardBody).toContain('IF v_enabled IS NOT TRUE THEN RETURN; END IF;');
    expect(forwardBody).toContain("IF v_url IS NULL OR btrim(v_url) = '' THEN RETURN; END IF;");
    expect(forwardBody).toContain("COALESCE(p_body, '{}'::jsonb)");
    expect(forwardBody).toMatch(/\bPERFORM\s+net\.http_post\s*\(/i);
    expect(forwardBody).not.toMatch(/\bRETURN\s+net\.http_post\b/i);
  });

  it('fails closed on exact target, ACL, caller, trigger, or cron drift before DDL', () => {
    expect(migration.indexOf('DO $notify_emit_preflight$')).toBeLessThan(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.notify_emit'),
    );
    expect(migration).toContain("v_body_md5 IS DISTINCT FROM '5935917b313c772a964b7c02e67c8dd4'");
    expect(migration).toContain(
      "v_definition_md5 IS DISTINCT FROM 'da6b30d100720605990491d4028560f0'",
    );
    for (const hash of [
      'dfc660aa915c4c8ce8e02592a8faa7a3',
      '8977dcbb788d85ade975936820a85f38',
      'e234c89fb88563c0e1c801cef3976852',
      '31f6810a3fac42fae029b6d30ea239e0',
      '0fe47fea140d0a1f108061a14d45c3b5',
      '7061fe1b9f8a212ed44e7e30492fa206',
    ]) {
      expect(migration).toContain(hash);
    }
    expect(migration).toContain('RAISE EXCEPTION');
    expect(migration).toMatch(/migration executor owns the transaction/i);
    expect(migration).not.toMatch(/^\s*BEGIN;\s*$/m);
    expect(migration).not.toMatch(/^\s*COMMIT;\s*$/m);
  });

  it('records an exact, drift-guarded rollback of body and prior ACL', () => {
    const priorBody = functionBody(rollback);
    const priorHash = createHash('md5').update(priorBody).digest('hex');

    expect(priorHash).toBe('5935917b313c772a964b7c02e67c8dd4');
    expect(priorBody).toContain(oldMerge);
    expect(priorBody).not.toContain(trustedMerge);
    expect(rollback).toContain("v_body_md5 IS DISTINCT FROM '27d638e9e2681bf74f17fa255c7eaf04'");
    expect(rollback.match(/v_grantable_count IS DISTINCT FROM 0/g)).toHaveLength(2);
    expect(squashSql(rollback)).toContain(
      'REVOKE EXECUTE ON FUNCTION public.notify_emit(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(squashSql(rollback)).toContain(
      'GRANT EXECUTE ON FUNCTION public.notify_emit(text, jsonb) TO authenticated, service_role;',
    );
    expect(rollback).toMatch(/re-opens authenticated browser execution/i);
    expect(rollback.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('keeps apply-window SQL catalog-only and non-invoking', () => {
    for (const sql of [preflight, postApply]) {
      const executable = executableSql(sql);
      expect(executable).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i,
      );
      expect(executable).not.toMatch(/\bPERFORM\s+(?:public\.)?notify_emit\s*\(/i);
      expect(executable).not.toMatch(/\bnet\.http_post\s*\(/i);
      expect(executable).not.toMatch(/\bcron\.(?:schedule|unschedule)\s*\(/i);
    }
    expect(postApply).toContain("md5(p.prosrc) = '27d638e9e2681bf74f17fa255c7eaf04'");
    expect(postApply).toContain('v_matching_caller_count IS DISTINCT FROM 6');
    expect(postApply).toContain('v_trigger_count IS DISTINCT FROM 3');
    expect(postApply).toContain('v_cron_count IS DISTINCT FROM 1');
  });

  it('does not acquire a browser or Pages Worker RPC caller', () => {
    const productFiles = [
      ...sourceFiles(resolve(root, 'src')),
      ...sourceFiles(resolve(root, 'functions')),
    ];
    const browserRpcCallers = productFiles.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /rpc\s*\(\s*['"]notify_emit['"]|\/rpc\/notify_emit/i.test(source);
    });
    expect(browserRpcCallers).toEqual([]);
  });

  it('does not claim unapplied provenance and retains the d54 ledger reconciliation', () => {
    const manifestText = JSON.stringify(provenanceManifest);
    const evidenceText = JSON.stringify(provenanceEvidence);
    expect(manifestText).not.toContain(migrationName);
    expect(evidenceText).not.toContain('notify_emit_service_boundary');

    const opsHealthMappings = provenanceManifest.ledgerMappings.filter(
      (entry) => entry.name === 'ops_health_alerting',
    );
    expect(opsHealthMappings.map((entry) => entry.version)).toEqual([
      '20260725201238',
      '20260725201303',
    ]);
    expect(new Set(opsHealthMappings.map((entry) => entry.path))).toEqual(
      new Set(['supabase/migrations/20260725190000_ops_health_alerting.sql']),
    );
  });
});
