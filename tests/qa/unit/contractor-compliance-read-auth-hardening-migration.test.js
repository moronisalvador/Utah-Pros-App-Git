// ═════════════════════════════════════════════════════════════════════════════
// FILE: contractor-compliance-read-auth-hardening-migration.test.js
// WHAT: Statically proves the additive read-RPC authorization repair keeps the
//       public signatures while requiring an active internal employee.
// DEPENDS ON: the 20260803220000 migration and paired rollback.
// ═════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260803220000_contractor_compliance_read_auth_fail_closed.sql', import.meta.url),
  'utf8',
);
const rollback = readFileSync(
  new URL('../../../supabase/rollbacks/20260803220000_contractor_compliance_read_auth_fail_closed.rollback.sql', import.meta.url),
  'utf8',
);

const publicDeclarations = [
  `CREATE OR REPLACE FUNCTION public.get_contractor_compliance_dashboard(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_audit_start date DEFAULT NULL,
  p_audit_end date DEFAULT NULL
) RETURNS jsonb`,
  `CREATE OR REPLACE FUNCTION public.get_contractor_compliance_detail(
  p_contact_id uuid,
  p_audit_start date DEFAULT NULL,
  p_audit_end date DEFAULT NULL
) RETURNS jsonb`,
  `CREATE OR REPLACE FUNCTION public.get_contractor_compliance_audit_periods()
RETURNS jsonb`,
  `CREATE OR REPLACE FUNCTION public.get_contractor_compliance_audit_manifest(
  p_audit_period_id uuid,
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_paid_filter text DEFAULT NULL,
  p_active_filter text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb`,
  `CREATE OR REPLACE FUNCTION public.get_contractor_w9_tax_year_checklist(
  p_tax_year integer,
  p_search text DEFAULT NULL,
  p_w9_status text DEFAULT NULL,
  p_provider_target text DEFAULT NULL,
  p_handoff_status text DEFAULT NULL,
  p_active_only boolean DEFAULT true,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
) RETURNS jsonb`,
];

describe('contractor compliance read authorization hardening migration', () => {
  it('preserves every public overload, argument name, and default', () => {
    for (const declaration of publicDeclarations) {
      expect(migration).toContain(declaration);
    }
  });

  it('fails closed for missing employee roles while retaining the service boundary', () => {
    expect(
      migration.match(
        /current_setting\('request\.jwt\.claim\.role', true\) IS DISTINCT FROM 'service_role'/g,
      ),
    ).toHaveLength(5);
    expect(migration.match(/AND \(v_role IS NULL OR v_role NOT IN/g)).toHaveLength(5);
    expect(migration).not.toMatch(/\bALTER FUNCTION\b[\s\S]*\bRENAME TO\b/);
    expect(migration).toContain('FROM PUBLIC, anon;');
    expect(migration).toContain('TO authenticated, service_role');
  });

  it('ships a fail-closed rollback', () => {
    expect(rollback).toContain('FROM PUBLIC, anon, authenticated');
    expect(rollback).toContain('TO service_role');
    expect(rollback).not.toContain('TO authenticated');
  });
});
