// ═════════════════════════════════════════════════════════════════════════════
// FILE: conversation-access-default-open.test.js
// WHAT: Source contract for the 2026-08-04 correction that put field technicians
//       back into customer conversations. The 2026-08-01 predicate was
//       deny-by-default, so a tech saw a conversation only if somebody had
//       explicitly added them — measured live that day: all 3 active techs held
//       the Conversations page and could access exactly 0 conversations.
//
// SCOPE HONESTY: this asserts INTENT from source text, not live effect. The
//       behavioural proof (default-open for internal roles; explicit removal,
//       crm_partner, inactive and external all still denied) ran on qa-staging
//       inside rolled-back transactions, per close-out-standard.md §2b.
// ═════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const migration = read(
  '../../../supabase/migrations/20260804230000_conversation_access_default_open.sql',
);
const rollback = read(
  '../../../supabase/rollbacks/20260804230000_conversation_access_default_open.rollback.sql',
);

// Blast-radius assertions are about EXECUTABLE SQL; both files discuss the old
// behaviour in prose, so strip `--` comments first.
const executable = (sql) => sql
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

describe('conversation access default-open migration', () => {
  // THREE functions carried the same deny-by-default rule. Fixing only the read
  // predicate would leave a tech able to read every existing thread but unable
  // to start a new one, or even find the customer — the "new lead texts in"
  // case, which is the likeliest way to recreate the original complaint.
  const TARGETS = [
    'messaging_employee_can_access_conversation',
    'find_or_create_scoped_conversation',
    'search_scoped_conversation_contacts',
  ];

  it('corrects all three deny-by-default gates, not just the read predicate', () => {
    const sql = executable(migration);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/gi)).toHaveLength(3);
    for (const name of TARGETS) {
      expect(sql).toContain(`public.${name}(`);
    }
    // The two start-a-conversation gates each had their own inline copy of the
    // old rule; neither may still require a conversation_default_members row.
    const startGates = sql.slice(sql.indexOf('find_or_create_scoped_conversation'));
    expect(startGates).not.toMatch(/conversation_default_members/);
  });

  it('preserves every signature so deployed callers keep working', () => {
    const sql = executable(migration);
    expect(sql).toMatch(/RETURNS boolean/);
    expect(sql).toMatch(/RETURNS jsonb/);
    expect(sql).toMatch(/RETURNS TABLE\(id uuid, name text, phone text, company text\)/);
    expect(sql).toMatch(/LANGUAGE sql/);
    expect(sql.match(/LANGUAGE plpgsql/g)).toHaveLength(2);
    expect(sql.match(/SET search_path TO 'pg_catalog', 'public'/g)).toHaveLength(3);
    // SECURITY INVOKER is the default and must not silently become DEFINER.
    // Assert on each DECLARATION block (the text before its body), because the
    // preflight guard legitimately names SECURITY DEFINER inside an error string.
    const declarations = sql
      .split(/CREATE OR REPLACE FUNCTION/i)
      .slice(1)
      .map((chunk) => chunk.split('AS $function$')[0]);
    expect(declarations).toHaveLength(3);
    for (const declaration of declarations) {
      expect(declaration).not.toMatch(/SECURITY DEFINER/i);
    }
    // The two service-only functions keep their runtime caller check.
    expect(sql.match(/current_user <> 'service_role'/g)).toHaveLength(2);
  });

  it('refuses to overwrite a drifted pre-image', () => {
    const sql = executable(migration);
    // Sibling migration 20260731213000 established this pattern. Without it,
    // drift is silently overwritten and the rollback's byte-exact promise is
    // quietly false. Proven to fail closed on qa-staging 2026-08-04.
    expect(sql).toMatch(/DO \$preflight\$/);
    expect(sql).toMatch(/md5\(p\.prosrc\)/);
    for (const name of TARGETS) {
      expect(sql).toContain(`'${name}'`);
    }
    expect(sql).toMatch(/body drifted/);
    expect(sql).toMatch(/ERRCODE = '55000'/);
  });

  it('re-asserts service-role-only grants and proves them afterwards', () => {
    const sql = executable(migration);
    // database-standard.md §1: this managed project re-applies EXECUTE TO PUBLIC
    // to every replaced function, and ALTER DEFAULT PRIVILEGES does not cover
    // functions — so the posture is restated explicitly, not assumed.
    expect(sql.match(/REVOKE ALL ON FUNCTION/g)).toHaveLength(3);
    expect(sql.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(3);
    expect(sql.match(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/g)).toHaveLength(3);
    expect(sql).toMatch(/DO \$postcheck\$/);
    expect(sql).toMatch(/has_function_privilege\('anon'/);
  });

  it('touches no table, policy or row, and never grants a browser role', () => {
    const sql = executable(migration);
    expect(sql).not.toMatch(/\b(?:DROP|RENAME|ALTER\s+TABLE|ALTER\s+COLUMN|CREATE\s+TABLE)\b/i);
    expect(sql).not.toMatch(/\b(?:CREATE\s+POLICY|DROP\s+POLICY)\b/i);
    // No data migration. (INSERT/UPDATE/DELETE appear only inside the replaced
    // function bodies' own SQL, never as top-level statements — assert on the
    // statement level by requiring none at the start of a line.)
    expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE)\s/im);
    // Grants ARE re-asserted (managed-Supabase re-grants EXECUTE TO PUBLIC on
    // every replaced function), but only ever TO service_role.
    expect(sql).not.toMatch(/GRANT[^;]*TO\s+(?:PUBLIC|anon|authenticated)/i);
  });

  it('is default-OPEN for internal staff — the whole point of the change', () => {
    const sql = executable(migration);
    // The fallback is the fix: deny-by-default became allow.
    expect(sql).toMatch(/ELSE true\s*\n\s*END/);
    expect(sql).not.toMatch(/ELSE false\s*\n\s*END/);
    // Still bounded to an active, internal employee row, in all three.
    expect(sql.match(/employee\.is_active/g).length).toBeGreaterThanOrEqual(3);
    expect(sql.match(/NOT employee\.is_external/g).length).toBeGreaterThanOrEqual(3);
  });

  it('states the send consequence, not just "read"', () => {
    // The same predicate authorizes POST /api/send-message, so gaining access to
    // a thread also means being able to send AS the company into it. A header
    // that says only "read access" would understate the change.
    expect(migration).toMatch(/send-message/);
    expect(migration).toMatch(/SEND AS UTAH PROS RESTORATION|not merely view it/);
  });

  it('says out loud that the capability check lives in the callers', () => {
    // The old comment claimed the function itself checked the Conversations page
    // capability. It never did — that check is in every caller. A future engineer
    // reading the catalog comment must not be told otherwise.
    expect(migration).toMatch(/does NOT check the Conversations/i);
    expect(migration).toMatch(/messaging_employee_has_conversations_capability/);
  });

  it('keeps partners out and lets an explicit removal win for every role', () => {
    const sql = executable(migration);
    const partner = sql.indexOf("employee_row.role = 'crm_partner'");
    const override = sql.indexOf('EXISTS (SELECT 1 FROM manual_choice)');
    expect(partner).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(-1);
    // crm_partner is evaluated FIRST, so no override can promote a partner.
    expect(partner).toBeLessThan(override);
    // The old privileged-role shortcut made admin/office/PM/supervisor
    // unremovable, which contradicted "add or remove access from people".
    expect(sql).not.toMatch(
      /role IN \('admin', 'office', 'project_manager', 'supervisor'\)/,
    );
  });

  it('leaves the live conversation_default_members contract alone', () => {
    const sql = executable(migration);
    // The auto-add automation still writes it and it stays readable; it simply
    // stops being the only way in. Dropping a live table would break callers.
    expect(sql).not.toMatch(/DROP\s+TABLE[\s\S]*conversation_default_members/i);
  });

  it('ships a rollback that restores all three prior deny-by-default bodies', () => {
    const sql = executable(rollback);
    expect(sql.match(/CREATE OR REPLACE FUNCTION/gi)).toHaveLength(3);
    for (const name of TARGETS) {
      expect(sql).toContain(`public.${name}(`);
    }
    expect(sql).toMatch(
      /role IN \(\s*'admin', 'office', 'project_manager', 'supervisor'\s*\)|role IN \('admin', 'office', 'project_manager', 'supervisor'\)/,
    );
    expect(sql).toMatch(/ELSE false\s*\n?\s*END/);
    // The default-members gate is part of the restored behaviour in all three.
    expect(sql.match(/conversation_default_members/g).length).toBeGreaterThanOrEqual(3);
    // The original catalog comment is restored, not erased.
    expect(sql).toMatch(/Service-only trusted staff membership decision/);
    expect(sql).not.toMatch(/COMMENT ON FUNCTION[^;]*IS NULL/);
    // The rollback is destructive to access; the file must say so out loud.
    expect(rollback).toMatch(/re-locks all 3 active field technicians|NOT a harmless undo/);
  });
});
