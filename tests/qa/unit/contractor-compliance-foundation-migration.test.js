/**
 * FILE: contractor-compliance-foundation-migration.test.js
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the Contractor Compliance migration's private-document and
 *   least-privilege contract visible in the credential-free CI lane.
 *
 * DEPENDS ON:
 *   Internal: paired 20260803090000 migration and rollback
 *   Data: source inspection only; this never contacts Supabase.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migration = readFileSync(join(
  ROOT,
  'supabase/migrations/20260803090000_contractor_compliance_foundation.sql',
), 'utf8');
const rollback = readFileSync(join(
  ROOT,
  'supabase/rollbacks/20260803090000_contractor_compliance_foundation.rollback.sql',
), 'utf8');

const tables = [
  'profiles',
  'documents',
  'requests',
  'request_deliveries',
  'activity',
  'public_attempts',
];

describe('contractor compliance foundation migration contract', () => {
  it('is additive and models historical, scoped document evidence explicitly', () => {
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE public.contractor_compliance_${table}`);
      expect(migration).toContain(`ALTER TABLE public.contractor_compliance_${table} FORCE ROW LEVEL SECURITY;`);
    }
    expect(migration).toContain("document_type IN ('w9', 'workers_comp', 'workers_comp_waiver', 'general_liability')");
    expect(migration).toContain("review_state IN ('pending_review', 'accepted', 'rejected', 'superseded')");
    expect(migration).toContain('version_number integer NOT NULL');
    expect(migration).toContain('coverage_start_date date');
    expect(migration).toContain('coverage_end_date date');
    expect(migration).toContain('tax_year integer');
    expect(migration).toContain('sha256_hex char(64) NOT NULL');
    expect(migration).toContain('UNIQUE (request_id, stage_key)');
    expect(migration).not.toMatch(/\b(?:DROP|RENAME)\b/i);
  });

  it('keeps W-9 evidence private and leaves browser roles without direct access', () => {
    expect(migration).toContain("'contractor-compliance-private'");
    expect(migration).toContain("false, 6291456, ARRAY['application/pdf', 'image/jpeg', 'image/png']");
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.contractor_compliance_profiles,[\s\S]*?FROM PUBLIC, anon, authenticated;/);
    expect(migration).not.toContain("CREATE POLICY contractor_compliance_storage_anon");
    expect(migration).not.toContain("CREATE POLICY contractor_compliance_storage_authenticated");
  });

  it('uses server-derived, role-redacted readiness and pins the Denver date rule', () => {
    expect(migration).toContain('get_contractor_compliance_dashboard');
    expect(migration).toContain('get_contractor_compliance_detail');
    expect(migration).toContain("'America/Denver'");
    expect(migration).toContain("v_role NOT IN ('admin', 'office', 'project_manager')");
    expect(migration).toContain("CASE WHEN v_role='project_manager' THEN '[]'::jsonb");
    expect(migration).toContain("'detail',CASE WHEN v_role='project_manager' THEN NULL");
    expect(migration).toContain("v_role<>'project_manager'");
    expect(migration).toContain("OR r.requested_document_types && ARRAY['workers_comp','workers_comp_waiver','general_liability']::text[]");
    expect(migration).toContain("d.document_type IN ('workers_comp','workers_comp_waiver')");
    expect(migration).toContain("'ready'",);
    expect(migration).toContain("'needs_review'");
    expect(migration).toContain("'expiring'");
    expect(migration).toContain("'expired'");
    expect(migration).toContain("'gap'");
    expect(migration).toContain("'inactive'");
    expect(migration).toContain('contractor_compliance_has_continuous_coverage');
    expect(migration).toContain('range_agg(daterange');
    expect(migration).toContain("'overdue_week_'||g::text");
    expect(migration).toContain("('60d',r.anchor-60)");
    expect(migration).toContain("('expiration',r.anchor)");
    expect(migration).toContain("ARRAY['workers_comp','workers_comp_waiver']");
    expect(migration).not.toContain('contractor_compliance_reminder_candidates_obsolete');
    expect(migration).toContain('ORDER BY due_stage.due DESC');
    expect(migration).toContain('LIMIT 1');
    expect(migration).toContain('contractor_compliance_continuous_coverage_end');
    expect(migration).toContain("SELECT 1 FROM unnest(r.requested_document_types) typ");
    expect(migration).toContain("'upr_contractor_compliance_reminders_daily'");
    expect(migration).toContain("'23 13 * * *'");
    expect(migration).toContain("v_url NOT IN (");
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.contractor_compliance_reminder_poll() FROM PUBLIC, anon, authenticated, service_role;');
  });

  it('revoke-public-before-grant protects each browser callable definer', () => {
    for (const signature of [
      'public.get_contractor_compliance_dashboard(text,text,integer,integer,date,date)',
      'public.get_contractor_compliance_detail(uuid,date,date)',
    ]) {
      const revoke = migration.indexOf(`REVOKE EXECUTE ON FUNCTION ${signature}`);
      const grant = migration.indexOf(`GRANT EXECUTE ON FUNCTION ${signature}`);
      expect(revoke, signature).toBeGreaterThan(-1);
      expect(grant, signature).toBeGreaterThan(revoke);
    }
    expect(migration).toContain('SET search_path = pg_catalog, public');
    const serviceRevoke = migration.indexOf('REVOKE EXECUTE ON FUNCTION public.contractor_compliance_ingest_document');
    const reminderSignature = migration.indexOf('public.contractor_compliance_reminder_candidates(integer)', serviceRevoke);
    const serviceGrant = migration.indexOf('GRANT EXECUTE ON FUNCTION public.contractor_compliance_ingest_document', serviceRevoke);
    expect(serviceRevoke).toBeGreaterThan(-1);
    expect(reminderSignature).toBeGreaterThan(serviceRevoke);
    expect(serviceGrant).toBeGreaterThan(reminderSignature);
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.contractor_compliance_continuous_coverage_end\(uuid,text\[\],date\)[\s\S]*?FROM PUBLIC, anon, authenticated;/);
  });

  it('ships a paired, non-evidence-destructive rollback', () => {
    expect(rollback).toContain('DROP TRIGGER IF EXISTS contractor_compliance_contact_profile_trigger ON public.contacts;');
    expect(rollback).toContain("jobname='upr_contractor_compliance_reminders_daily'");
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.contractor_compliance_reminder_poll();');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.get_contractor_compliance_detail');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.contractor_compliance_reminder_candidates(integer);');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.ensure_contractor_compliance_profile();');
    expect(rollback).toContain('DROP TABLE IF EXISTS public.contractor_compliance_documents;');
    expect(rollback).not.toMatch(/DELETE FROM storage\.buckets|DROP TABLE storage\.objects/i);
  });
});
