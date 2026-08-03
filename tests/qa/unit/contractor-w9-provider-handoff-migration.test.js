/**
 * QA CONTRACT: annual W-9 readiness and provider handoff
 * PURPOSE:
 *   Prevents the narrow W-9 checklist from becoming a shadow 1099, tax amount,
 *   or public document-delivery system.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260803145100_contractor_w9_provider_handoffs.sql'),
  'utf8',
);
const rollback = fs.readFileSync(
  path.join(root, 'supabase/rollbacks/20260803145100_contractor_w9_provider_handoffs.rollback.sql'),
  'utf8',
);

describe('annual W-9 provider handoff migration', () => {
  it('derives the required annual W-9 status vocabulary from private versions', () => {
    expect(migration).toContain('get_contractor_w9_tax_year_checklist');
    expect(migration).toContain("'valid'");
    expect(migration).toContain("'missing'");
    expect(migration).toContain("'needs_review'");
    expect(migration).toContain("'rejected'");
    expect(migration).toContain("'stale_previous_year'");
    expect(migration).toContain("d.document_type = 'w9'");
    expect(migration).toContain("d.review_state IN ('accepted', 'superseded')");
  });

  it('stores only provider handoff and external reconciliation identifiers', () => {
    expect(migration).toContain('CREATE TABLE public.contractor_w9_provider_handoffs');
    expect(migration).toContain('quickbooks_contractor_external_id');
    expect(migration).toContain('gusto_contractor_external_id');
    expect(migration).toContain('handoff_date');
    expect(migration).toContain('provider_reference');
    expect(migration).not.toContain('gross_reportable');
    expect(migration).not.toContain('1099_nec');
    expect(migration).not.toContain('contractor_tax_documents');
    expect(migration).not.toContain('contractor_tax_deliveries');
    expect(migration).not.toContain('access_grants');
    expect(migration).not.toContain('recipient_email');
    expect(migration).not.toMatch(/\bnotes\b/);
  });

  it('is admin/office-only with service-owned direct storage', () => {
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain("e.role::text IN ('admin', 'office')");
    expect(migration).toContain("v_role NOT IN ('admin', 'office')");
    expect(migration).not.toContain("'project_manager'");
    expect(migration).not.toMatch(/GRANT\s+EXECUTE[\s\S]{0,200}\sTO\s+anon/i);
  });

  it('prevents a provider-ready state without an accepted W-9', () => {
    expect(migration).toContain('W9_NOT_READY: accepted W-9 required for tax year');
    expect(migration).toContain("p_handoff_status <> 'not_ready' AND NOT v_has_current_w9");
  });

  it('ships a complete rollback', () => {
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.get_contractor_w9_tax_year_checklist');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.contractor_w9_upsert_provider_handoff');
    expect(rollback).toContain('DROP TABLE IF EXISTS public.contractor_w9_provider_handoffs');
  });
});
