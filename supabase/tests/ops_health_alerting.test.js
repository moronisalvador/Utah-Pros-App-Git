import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(fileURLToPath(new URL(
  '../migrations/20260725190000_ops_health_alerting.sql',
  import.meta.url,
)), 'utf8');
const rollback = readFileSync(fileURLToPath(new URL(
  '../rollbacks/20260725190000_ops_health_alerting.rollback.sql',
  import.meta.url,
)), 'utf8');

describe('ops health alerting migration', () => {
  it('seeds only a non-secret worker URL without replacing an owner value', () => {
    expect(migration).toContain("'ops_health_worker_url'");
    expect(migration).toContain("'https://dev.utahpros.app/api/ops-health'");
    expect(migration).toContain('ON CONFLICT (key) DO NOTHING');
    // The cron secret is READ, never seeded with a literal value.
    expect(migration).not.toMatch(/cron_worker_secret'\s*,\s*'[^']+'/);
  });

  it('fails closed unless the URL and existing cron secret are usable', () => {
    expect(migration).toContain("'https://utahpros.app/api/ops-health'");
    expect(migration).toContain("WHERE key = 'cron_worker_secret'");
    expect(migration).toContain('v_worker_url IS NULL');
    expect(migration).toContain("NULLIF(btrim(v_secret), '') IS NULL");
  });

  it('restricts dispatch to the exact dev/production worker URLs', () => {
    const allowlist = migration.match(/v_worker_url NOT IN \(([^)]+)\)/s);
    expect(allowlist).not.toBeNull();
    expect(allowlist[1]).toContain('https://dev.utahpros.app/api/ops-health');
    expect(allowlist[1]).toContain('https://utahpros.app/api/ops-health');
    // No wildcard or configuration-driven host may reach the secret-bearing POST.
    expect(allowlist[1]).not.toMatch(/%|\|\||concat/i);
  });

  it('uses the protected POST contract and a fifteen-minute schedule', () => {
    expect(migration).toContain("'x-webhook-secret', v_secret");
    expect(migration).toContain("'upr_ops_health'");
    expect(migration).toContain("'*/15 * * * *'");
    expect(migration).toContain('net.http_post');
  });

  it('closes the managed-Supabase EXECUTE-to-PUBLIC trap and grants nobody', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.wake_ops_health_worker\(\)\s*\n?\s*FROM PUBLIC, anon, authenticated, service_role;/,
    );
    // pg_cron runs as the scheduling role; no role-level EXECUTE grant is wanted.
    expect(migration).not.toMatch(/GRANT EXECUTE/i);
  });

  it('pins search_path on the SECURITY DEFINER function', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public');
  });

  it('seeds the alert type bell-only and enabled', () => {
    expect(migration).toContain("'ops.health'");
    // bell_default, push_default, email_default, enabled
    expect(migration).toMatch(/true,\s*false,\s*false,\s*true/);
  });

  it('is additive only — no destructive DDL on a live table', () => {
    // Strip `--` comments first: the header PROSE legitimately contains the words
    // "DROP/RENAME/ALTER COLUMN" while asserting the migration does none of them.
    const ddl = migration.replace(/--[^\n]*/g, '');
    expect(ddl).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(ddl).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(ddl).not.toMatch(/\bRENAME\b/i);
    expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
  });
});

describe('ops health alerting rollback', () => {
  it('removes exactly what the migration created', () => {
    expect(rollback).toContain("cron.unschedule('upr_ops_health')");
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.wake_ops_health_worker()');
    expect(rollback).toContain("WHERE key = 'ops_health_worker_url'");
    expect(rollback).toContain("WHERE type_key = 'ops.health'");
  });

  it('preserves delivered notifications and append-only history', () => {
    expect(rollback).not.toMatch(/DELETE\s+FROM\s+public\.notifications/i);
    expect(rollback).not.toMatch(/DELETE\s+FROM\s+public\.system_events/i);
    expect(rollback).not.toMatch(/DELETE\s+FROM\s+public\.worker_runs/i);
  });

  it('never touches the shared cron secret', () => {
    expect(rollback).not.toContain('cron_worker_secret');
  });
});
