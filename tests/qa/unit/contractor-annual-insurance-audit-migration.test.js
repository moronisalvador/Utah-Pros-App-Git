/**
 * QA CONTRACT: annual contractor insurance audits
 * PURPOSE:
 *   Keeps named audit periods, immutable evidence snapshots, explicit unknown
 *   paid/activity facts, and least-privilege RPC boundaries CI-visible.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260803145000_contractor_annual_insurance_audits.sql'),
  'utf8',
);
const rollback = fs.readFileSync(
  path.join(root, 'supabase/rollbacks/20260803145000_contractor_annual_insurance_audits.rollback.sql'),
  'utf8',
);
const authorizationProof = fs.readFileSync(
  path.join(root, 'supabase/tests/contractor_compliance_authorization_isolated.sql'),
  'utf8',
);
const localDbRunner = fs.readFileSync(
  path.join(root, 'scripts/qa/run-local-db-tests.mjs'),
  'utf8',
);

describe('annual contractor insurance audit migration', () => {
  it('preserves named roster, coverage/gap, and request-history snapshots', () => {
    expect(migration).toContain('CREATE TABLE public.contractor_compliance_audit_periods');
    expect(migration).toContain('CREATE TABLE public.contractor_compliance_audit_roster');
    expect(migration).toContain('CREATE TABLE public.contractor_compliance_audit_evidence');
    expect(migration).toContain('CREATE TABLE public.contractor_compliance_audit_requests');
    expect(migration).toContain('CREATE TABLE public.contractor_compliance_audit_request_deliveries');
    expect(migration).toContain("interval_kind IN ('coverage', 'gap')");
    expect(migration).toContain("d.review_state IN ('accepted', 'superseded')");
    expect(migration).toContain('document_version');
    expect(migration).toContain("q.requested_document_types\n        && ARRAY['workers_comp', 'workers_comp_waiver', 'general_liability']::text[]");
  });

  it('does not fabricate period activity or payment facts', () => {
    expect(migration).toContain('active_in_period boolean');
    expect(migration).toContain('paid_in_period boolean');
    expect(migration).toContain("'current active profile at materialization; not proof of activity or payment in the audit period'");
    expect(migration).toContain("'external_import'");
    expect(migration).toContain('source_external_id');
  });

  it('keeps direct tables service-only and every RPC role checked', () => {
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toMatch(/REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/FROM PUBLIC, anon;\s+GRANT EXECUTE ON FUNCTION/);
    expect(migration).toContain("e.role::text IN ('admin', 'office')");
    expect(migration).toContain("v_role NOT IN ('admin', 'office', 'project_manager')");
    expect(migration).toContain('period fact filters require audit manager');
    expect(migration).toContain("'request_count', f.request_count");
    expect(migration).not.toMatch(/GRANT\s+EXECUTE[\s\S]{0,200}\sTO\s+anon/i);
  });

  it('ships a dependency-ordered rollback', () => {
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.get_contractor_compliance_audit_manifest');
    expect(rollback.indexOf('DROP TABLE IF EXISTS public.contractor_compliance_audit_request_deliveries'))
      .toBeLessThan(rollback.indexOf('DROP TABLE IF EXISTS public.contractor_compliance_audit_periods'));
  });

  it('registers the guarded negative authorization proof in the local DB lane', () => {
    expect(authorizationProof).toContain("current_setting('upr.isolated_test_database', true)");
    expect(authorizationProof).toContain("current_database() IN ('postgres', 'glsmljpabrwonfiltiqm')");
    expect(authorizationProof).toContain('PM received the required W-9 tax year');
    expect(authorizationProof).toContain('PM unexpectedly received the W-9/provider checklist');
    expect(localDbRunner).toContain("'supabase/tests/contractor_compliance_authorization_isolated.sql'");
  });
});
