/**
 * ════════════════════════════════════════════════
 * FILE: public_form_rpc_boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves public form submissions can reach the database only through the two service-role
 *   Workers that enforce schema, abuse, consent, and webhook checks. Browser roles must not call
 *   the privileged form-lead RPC directly.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  public-form boundary migration and rollback, form-submit.js,
 *              webflow-form-webhook.js, functions/lib/supabase.js
 *   Data:      reads  → repository files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Live role behavior is verified only in the separately authorized apply window with the
 *     companion post-apply SQL. This test never calls Supabase.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const migrationName = '20260723235900_public_form_rpc_boundary.sql';
const signature =
  'public.upsert_lead_from_form(uuid, text, jsonb, jsonb, boolean, text, text, uuid)';

const migration = readFileSync(resolve(root, 'supabase/migrations', migrationName), 'utf8');
const rollback = readFileSync(
  resolve(root, 'supabase/rollbacks', '20260723235900_public_form_rpc_boundary.rollback.sql'),
  'utf8',
);
const postApply = readFileSync(
  resolve(root, 'supabase/tests/public_form_rpc_boundary_post_apply.sql'),
  'utf8',
);
const formWorker = readFileSync(resolve(root, 'functions/api/form-submit.js'), 'utf8');
const webflowWorker = readFileSync(
  resolve(root, 'functions/api/webflow-form-webhook.js'),
  'utf8',
);
const workerDb = readFileSync(resolve(root, 'functions/lib/supabase.js'), 'utf8');
const crmFormsTest = readFileSync(
  resolve(root, 'supabase/tests/crm_phase10_forms.test.js'),
  'utf8',
);
const anonClosureSql = readFileSync(
  resolve(root, 'supabase/tests/db_foundation_p3_anon_closure.sql'),
  'utf8',
);
const squashSql = (sql) =>
  sql.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

describe('public form RPC boundary', () => {
  it('removes every browser grant and preserves only service_role execution', () => {
    expect(squashSql(migration)).toContain(
      `REVOKE EXECUTE ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`,
    );
    expect(squashSql(migration)).toContain(
      `GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`,
    );

    const executableSql = migration
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executableSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.upsert_lead_from_form\([^;]+\) TO (?:PUBLIC|anon|authenticated)/i,
    );
  });

  it('does not replace or mutate the deployed RPC contract', () => {
    expect(migration).not.toMatch(/\bDROP\s+FUNCTION\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
    expect(migration).not.toMatch(/\bALTER\s+FUNCTION\b/i);
    expect(squashSql(migration)).toContain(signature);
  });

  it('keeps both trusted callers on the shared service-role database client', () => {
    for (const source of [formWorker, webflowWorker]) {
      expect(source).toMatch(/import\s+\{\s*supabase\s*\}\s+from\s+'..\/lib\/supabase\.js'/);
      expect(source).toContain("db.rpc('upsert_lead_from_form'");
    }
    expect(workerDb).toContain('const key = env.SUPABASE_SERVICE_ROLE_KEY;');
    expect(workerDb).toContain("'Authorization': `Bearer ${key}`");
    expect(workerDb).toContain("'apikey': key");
  });

  it('records the exact legacy ACL rollback without applying it', () => {
    expect(squashSql(rollback)).toContain(
      `GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC, anon, authenticated, service_role;`,
    );
    expect(rollback).toMatch(/re-opens the direct browser bypass/i);
  });

  it('post-apply verification checks PUBLIC ACL membership and both browser roles read-only', () => {
    expect(postApply).toContain('acl.grantee = 0');
    expect(postApply).toContain("has_function_privilege('anon', v_oid, 'EXECUTE')");
    expect(postApply).toContain(
      "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    );
    expect(postApply).toContain("has_function_privilege('service_role', v_oid, 'EXECUTE')");
    expect(postApply).toContain("COALESCE(role_grantee.rolname, 'PUBLIC') <> 'service_role'");
    expect(postApply).not.toMatch(/\b(?:insert|update|delete|alter|drop|grant|revoke)\b/i);
  });

  it('removes the RPC from the canonical anonymous drift allowlist', () => {
    const executableSql = anonClosureSql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(executableSql).not.toContain("'upsert_lead_from_form'");
  });

  it('keeps direct database behavior tests service-role-only and refuses production', () => {
    expect(crmFormsTest).toContain("QA_ALLOW_MUTATION_TESTS");
    expect(crmFormsTest).toContain("'UPR_ISOLATED_QA'");
    expect(crmFormsTest).toContain("'glsmljpabrwonfiltiqm'");
    expect(crmFormsTest).toContain('QA_SUPABASE_SERVICE_ROLE_KEY');
    expect(crmFormsTest).not.toContain("from '../../src/lib/supabase.js'");
  });
});
