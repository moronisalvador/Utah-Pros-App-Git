/**
 * ════════════════════════════════════════════════
 * FILE: notification-role-defaults-rpc-only.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the notification-defaults closure migration as TEXT and checks it still
 *   says what it is supposed to say. No database required.
 *
 *   What is being guarded: the admin-only helper that edits notification defaults
 *   had an open back door — the table itself accepted writes from ANY logged-in
 *   employee, including external CRM partners, going straight past the admin
 *   check. This migration closes the table and leaves the helpers as the only way
 *   in. It must not, however, revoke `service_role`, which is what the helpers run
 *   as when a Worker calls them.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260727144500_notification_role_defaults_rpc_only.sql
 *              supabase/rollbacks/20260727144500_notification_role_defaults_rpc_only.rollback.sql
 *   Data:      reads  → migration + rollback source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Proves INTENT, not EFFECT. The behavioural proof is deliberately manual and
 *     cheap: open Settings → Notification Defaults as an admin after the apply and
 *     confirm the matrix loads and a toggle saves. No db-lane file was added,
 *     because that lane does not run in CI and each addition raises the
 *     dark-guard debt tracked by db-lane-coverage.test.js.
 *   - Statement assertions strip `--` comments, or the header prose about revoking
 *     matches the very patterns being forbidden.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIGRATION = join(ROOT, 'supabase/migrations/20260727144500_notification_role_defaults_rpc_only.sql');
const ROLLBACK = join(ROOT, 'supabase/rollbacks/20260727144500_notification_role_defaults_rpc_only.rollback.sql');

const read = (p) => readFileSync(p, 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const stmts = (s) => norm(s.replace(/--[^\r\n]*/g, ''));

describe('notification_role_defaults RPC-only — migration source contract', () => {
  const raw = read(MIGRATION);
  const sql = norm(raw);
  const code = stmts(raw);

  it('exists alongside a rollback (database-standard.md §6)', () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it('drops the always-true policy that was the back door', () => {
    expect(code).toContain('drop policy if exists notification_role_defaults_all');
  });

  it('revokes both browser roles — authenticated was the actual escalation', () => {
    // anon could read it; any authenticated employee could WRITE it, which is the
    // bypass around set_notification_default's admin gate.
    expect(code).toMatch(/revoke all on table public\.notification_role_defaults\s+from anon, authenticated/);
  });

  it('never revokes service_role — the helpers run as it from Workers', () => {
    expect(code).not.toMatch(/revoke[^;]*service_role/);
  });

  it('leaves the gated RPCs alone', () => {
    // The admin gate lives inside set_notification_default. This migration closes
    // the bypass around it and must not redefine the function itself.
    expect(code).not.toMatch(/\bcreate (or replace )?function\b/);
    expect(code).not.toContain('set_notification_default(');
  });

  it('adds no policy back, keeping the table RPC-only', () => {
    expect(code).not.toMatch(/\bcreate policy\b/);
  });

  it('creates or drops no schema object and changes no data', () => {
    expect(code).not.toMatch(/\bcreate table\b|\bdrop table\b|\bcreate index\b|\bdrop index\b/);
    expect(code).not.toMatch(/\binsert into\b|\bupdate public\.|\bdelete from\b/);
  });

  it('declares its RED tier rather than claiming to be additive', () => {
    expect(sql).toContain('additive-only:');
    expect(sql).toContain('red tier');
  });

  it('cites the already-applied precedent for this posture', () => {
    // notification_types is RLS-on with zero policies and no browser grants.
    expect(sql).toContain('notification_types');
  });
});

describe('notification_role_defaults RPC-only — rollback source contract', () => {
  const raw = read(ROLLBACK);
  const sql = norm(raw);
  const code = stmts(raw);

  it('restores the policy and the browser-role grants', () => {
    expect(code).toContain('create policy notification_role_defaults_all');
    expect(code).toMatch(/grant [^;]*on table public\.notification_role_defaults\s+to anon, authenticated/);
  });

  it('warns that restoring re-opens the admin bypass', () => {
    expect(sql).toContain('external crm partner');
  });
});
