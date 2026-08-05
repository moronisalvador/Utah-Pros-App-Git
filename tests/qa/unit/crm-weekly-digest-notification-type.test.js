// ═════════════════════════════════════════════════════════════════════════════
// FILE: crm-weekly-digest-notification-type.test.js
// WHAT: CI-visible source contract for the "Weekly CRM digest" notification
//       type (2026-08-05). Proves the migration is a single additive catalog +
//       role-default seed with a paired rollback, that
//       functions/api/weekly-crm-digest.js resolves recipients through the
//       shared preference system before falling back to the legacy static
//       list, and that this type is never wired into notify.js's real-time
//       dispatchEvent — it has no bell/push emitter, and the worker reads the
//       preference resolver directly instead.
//
// SCOPE HONESTY: this asserts INTENT from source text, not live effect (the
//       type/role-default row is not applied to any hosted database by this
//       test). The behavioral proof for the JS recipient-resolution logic is
//       functions/api/weekly-crm-digest.test.js (credential-free, runs today).
// ═════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

// Strip `--` comments so prose in the required header (which necessarily
// discusses DELETE/UPDATE/ON DELETE RESTRICT) doesn't trip the executable-SQL
// assertions below.
const executable = (sql) => sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

const migration = read(
  '../../../supabase/migrations/20260805030000_crm_weekly_digest_notification_type.sql',
);
const rollback = read(
  '../../../supabase/rollbacks/20260805030000_crm_weekly_digest_notification_type.rollback.sql',
);
const worker = read('../../../functions/api/weekly-crm-digest.js');
const notify = read('../../../functions/api/notify.js');

describe('crm_weekly_digest migration', () => {
  it('is additive-only — two INSERTs, no DDL/UPDATE/DELETE/GRANT/REVOKE', () => {
    const sql = executable(migration);
    expect(sql.match(/INSERT INTO/gi)).toHaveLength(2);
    expect(sql).toContain("'crm_weekly_digest'");
    expect(sql.match(/ON CONFLICT[^;]*DO NOTHING/gi)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(?:DROP|RENAME|ALTER\s+TABLE|ALTER\s+COLUMN)\b/i);
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE)\s/i);
    expect(sql).not.toMatch(/\b(?:GRANT|REVOKE|CREATE\s+POLICY)\b/i);
    expect(sql).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    // A migration must never seed a real secret (database-standard.md §4).
    expect(sql).not.toMatch(/notification_types[\s\S]*(?:token|secret|api_key)/i);
  });

  it('ships bell + push OFF, email OFF at the type level, enabled=true', () => {
    // (bell_default, push_default, email_default, enabled, sort_order)
    expect(migration).toMatch(/false,\s*false,\s*false,\s*true,\s*90/);
  });

  it('seeds an admin-only role default so the digest defaults ON for admins', () => {
    const insert = migration.slice(
      migration.indexOf('INSERT INTO public.notification_role_defaults'),
    );
    expect(insert).toContain("'admin', 'crm_weekly_digest', 'email', true, true");
  });

  it('touches no table other than notification_types and notification_role_defaults', () => {
    const sql = executable(migration);
    expect(sql).toMatch(/INSERT INTO public\.notification_types/i);
    expect(sql).toMatch(/INSERT INTO public\.notification_role_defaults/i);
    expect(sql.match(/INSERT INTO public\.(\w+)/gi)).toEqual([
      'INSERT INTO public.notification_types',
      'INSERT INTO public.notification_role_defaults',
    ]);
  });
});

describe('crm_weekly_digest rollback', () => {
  it('clears the RESTRICT-ing presentation-audit rows before the type row', () => {
    const sql = executable(rollback);
    const audit = sql.indexOf('notification_presentation_audit');
    const roleDefault = sql.indexOf('DELETE FROM public.notification_role_defaults');
    const types = sql.indexOf('DELETE FROM public.notification_types');
    expect(audit).toBeGreaterThan(-1);
    expect(roleDefault).toBeGreaterThan(-1);
    expect(types).toBeGreaterThan(-1);
    // notification_presentation_audit.type_key is ON DELETE RESTRICT, so the
    // type row cannot go first. role_defaults/prefs/overrides all cascade.
    expect(roleDefault).toBeGreaterThan(audit);
    expect(types).toBeGreaterThan(roleDefault);
  });

  it('scopes every delete to crm_weekly_digest only — never an unscoped wipe', () => {
    const sql = executable(rollback);
    const deletes = sql.split(';')
      .map((statement) => statement.trim())
      .filter((statement) => /^DELETE FROM/i.test(statement));
    expect(deletes).toHaveLength(3);
    for (const statement of deletes) {
      expect(statement).toMatch(/crm_weekly_digest/);
    }
  });
});

describe('weekly-crm-digest.js consumes the preference system, not a new emitter', () => {
  it('resolves opted-in admins via get_effective_notification_prefs before the legacy list', () => {
    expect(worker).toContain("const DIGEST_TYPE_KEY = 'crm_weekly_digest';");
    expect(worker).toContain('export async function resolvePreferenceRecipients(db)');
    expect(worker).toContain(
      "role=in.(admin)&is_active=eq.true&is_external=eq.false&select=id,email",
    );
    expect(worker).toContain("db.rpc('get_effective_notification_prefs'");
    expect(worker).toMatch(
      /p\.type_key === DIGEST_TYPE_KEY && p\.channel === 'email' && p\.enabled/,
    );

    const resolveRecipients = worker.slice(
      worker.indexOf('export async function resolveRecipients'),
    );
    const preferredCall = resolveRecipients.indexOf('resolvePreferenceRecipients(db)');
    const legacyEnvCall = resolveRecipients.indexOf('parseRecipients(env)');
    expect(preferredCall).toBeGreaterThan(-1);
    expect(legacyEnvCall).toBeGreaterThan(preferredCall);
  });

  it('never drops an admin whose own prefs lookup fails', () => {
    const resolver = worker.slice(
      worker.indexOf('export async function resolvePreferenceRecipients'),
      worker.indexOf('export async function resolveRecipients'),
    );
    // The per-admin RPC call is inside its own try/catch with a `continue`, so
    // one failed lookup cannot drop the rest of the roster.
    expect(resolver).toMatch(/catch\s*\{\s*continue;/);
  });

  it('is never emitted through notify.js — it has no bell/push consumer', () => {
    // This is a resolver-only consumer of the catalog, not a real-time event.
    // If it ever appears in notify.js it must have been wired into
    // dispatchEvent/ROLE_AUDIENCE/resolveAudience, which would double up the
    // email send (once here, once through the generic dispatcher) and this
    // migration's bell_default/push_default=false posture would be misleading.
    expect(notify).not.toContain('crm_weekly_digest');
  });
});
