/**
 * ════════════════════════════════════════════════
 * FILE: inbound-lead-recording-source-contract.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the S1e migration's authorization intent visible in credential-free
 *   CI while its behavioral SQL suite remains isolated-database-only.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  S1e migration and rollback SQL
 *   Data:      reads → repository source only; writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves source intent, not applied database behavior.
 * ════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260726183409_inbound_lead_recording_source_boundary.sql');
const rollback = read('supabase/rollbacks/20260726183409_inbound_lead_recording_source_boundary.rollback.sql');
const preflight = read('supabase/tests/inbound_lead_recording_source_preflight.sql');
const postApply = read('supabase/tests/inbound_lead_recording_source_post_apply.sql');
const isolated = read('supabase/tests/inbound_lead_recording_source_isolated.sql');
const wrapper = read('supabase/tests/inbound_lead_recording_source.test.sql');
const localDbRunner = read('scripts/qa/run-local-db-tests.mjs');
const executable = (sql) => sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .replace(/\s+/g, ' ');
const md5 = (value) => createHash('md5').update(value).digest('hex');
const extractAuthoredBody = (name) => {
  const match = migration.match(new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]*?`
      + 'AS \\$function\\$(\\n[\\s\\S]*?\\n)\\$function\\$;',
  ));
  expect(match, `authored body for ${name}`).not.toBeNull();
  return match[1];
};

describe('S1e recording-source migration CI contract', () => {
  it('removes browser writes and raw recording-source storage', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.inbound_leads FROM anon');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
    expect(migration).toContain('CREATE TABLE public.inbound_lead_recording_sources');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("WHERE e.key NOT IN ('recording', 'recording_url')");
    expect(migration).toContain("SET recording_url = 'upr-recording://available'");
    expect(migration).toContain("OR btrim(NEW.recording_url) = ''");
    expect(migration).toContain('SET recording_url = NULL');
    expect(migration).toContain(
      "COALESCE(\n               lead.recording_url = 'upr-recording://available',",
    );
  });

  it('pins the exact authored forward function bodies used by catalog guards', () => {
    for (const [name, expected] of [
      ['strip_recording_sources', '2a1f0ce38c9be975f82b87c0756da0eb'],
      ['sanitize_inbound_lead_recording_payload', 'a256cccfd36b0f81d7d258a5b6f6e779'],
      ['protect_inbound_lead_recording_source', '9bbf983b2d260cece45366a56732c564'],
      ['get_inbound_leads', 'f6456487bf2871ce343f0a82b508b584'],
    ]) {
      expect(md5(extractAuthoredBody(name))).toBe(expected);
      expect(migration).toContain(expected);
      expect(rollback).toContain(expected);
      expect(postApply).toContain(expected);
    }
  });

  it('keeps source reads and ingestion service-only', () => {
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.inbound_lead_recording_sources\n'
        + '  FROM PUBLIC, anon, authenticated, service_role',
    );
    expect(migration).toContain(
      'CREATE POLICY inbound_lead_recording_sources_service_role_all',
    );
    expect(migration).toContain('TO service_role\n  USING (true)\n  WITH CHECK (true)');
    expect(migration).toContain('ON TABLE public.inbound_lead_recording_sources TO service_role');
    expect(migration.match(/INTENTIONALLY worker-\/trigger-only/g)).toHaveLength(2);
    const revoke = migration.indexOf('REVOKE EXECUTE ON FUNCTION public.upsert_lead_from_callrail(');
    const grant = migration.indexOf('GRANT EXECUTE ON FUNCTION public.upsert_lead_from_callrail(');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('gates browser reads and carries an explicit rollback', () => {
    expect(migration).toContain('CREATE POLICY inbound_leads_active_internal_select');
    expect(migration).toContain('AND e.is_active = true');
    expect(migration).toContain('AND e.is_external = false');
    expect(migration).toContain("v_employee.role::text = 'admin'");
    expect(migration).toContain("epa.nav_key = 'crm_call_log'");
    expect(rollback).toContain('DROP TABLE public.inbound_lead_recording_sources');
    expect(rollback).toContain('GRANT ALL ON TABLE public.inbound_leads TO anon, authenticated');
  });

  it('ships value-free catalog proofs and a governed isolated behavior runner', () => {
    for (const sql of [preflight, postApply]) {
      const code = executable(sql);
      const codeWithoutStringLiterals = code.replace(/'(?:''|[^'])*'/g, "''");
      expect(codeWithoutStringLiterals).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/i,
      );
      expect(code).not.toMatch(/\bFROM\s+public\.inbound_leads\b/i);
      expect(code).not.toMatch(/\bFROM\s+public\.inbound_lead_recording_sources\b/i);
    }

    expect(isolated).toContain('\\quit 2');
    expect(isolated).toContain(
      "current_setting('upr.isolated_test_database', true)",
    );
    expect(isolated).toContain(
      "'S1e blank recording source left a stale private source row'",
    );
    expect(isolated).toContain(
      "'S1e NULL recording source left a stale private source row'",
    );
    expect(isolated).toContain('ROLLBACK;');
    expect(executable(isolated)).not.toMatch(/\bCOMMIT\b/i);
    expect(wrapper).toContain('\\set UPR_ISOLATED_DB 1');
    expect(wrapper).toContain('\\ir inbound_lead_recording_source_isolated.sql');
    expect(localDbRunner).toContain(
      "'supabase/tests/inbound_lead_recording_source.test.sql'",
    );
  });

  it('pins identity, publication, column ACL, and explicit unsafe rollback gates', () => {
    for (const sql of [migration, preflight, postApply, isolated]) {
      expect(sql).toContain(
        "migration.name = 'mobile_employee_identity_containment'",
      );
      expect(sql).toContain('employees_self_identity_read');
      expect(sql).toContain("'auth_user_id = auth.uid()'");
      expect(sql).not.toContain(
        "migration.name = 'mobile_employee_identity_authority'",
      );
      expect(sql).not.toContain('allow_authenticated_employees');
      expect(sql).not.toContain('allow_anon_read_employees');
      expect(sql).toContain('MAINTAIN');
      expect(sql).toContain('pg_attribute');
      expect(sql).toContain('attacl');
      expect(sql).toContain('acl.grantor <> relation.relowner');
      expect(sql).toContain("grantee_role.rolname = 'anon'");
      expect(sql).toContain("grantee_role.rolname = 'authenticated'");
      expect(sql).toContain("acl.privilege_type = 'SELECT'");
      expect(sql).toContain("'is_external'");
      expect(sql).toContain('ARRAY[]::text[]');
    }
    for (const sql of [migration, rollback, preflight, postApply]) {
      expect(sql).toContain('pg_publication_rel');
      expect(sql).toContain('puballtables');
    }
    expect(rollback).toContain(
      "current_setting('upr.allow_unsafe_s1e_rollback', true)",
    );
  });
});
