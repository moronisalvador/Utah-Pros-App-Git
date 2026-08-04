/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FILE: sync-appointment-crew-hotfix.test.js
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Freezes the emergency appointment-crew RPC repair: enum-safe writes,
 *   caller-bound appointment authorization, diff-based row preservation, and
 *   least-privilege grants with a fail-closed rollback.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  the 20260804000042 migration, rollback, and isolated SQL proof
 *   Data:      reads → repository source; writes → none
 *
 * NOTES / GOTCHAS:
 *   Runtime behavior is exercised separately by the disposable-local SQL proof.
 *   This credential-free test is the CI-visible source contract.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const migration = source(
  'supabase/migrations/20260804000042_sync_appointment_crew_enum_authorization_hotfix.sql',
);
const rollback = source(
  'supabase/rollbacks/20260804000042_sync_appointment_crew_enum_authorization_hotfix.rollback.sql',
);
const isolatedProof = source(
  'supabase/tests/sync_appointment_crew_hotfix_isolated.sql',
);

describe('sync_appointment_crew production hotfix', () => {
  it('preserves the deployed RPC signature and casts every desired role', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.sync_appointment_crew(',
    );
    expect(migration).toContain('p_appointment_id uuid');
    expect(migration).toContain(
      "p_crew jsonb DEFAULT '[]'::jsonb",
    );
    expect(migration).toContain(
      'RETURNS SETOF public.appointment_crew',
    );
    expect(
      migration.match(/\)::public\.crew_role AS role/g),
    ).toHaveLength(3);
    expect(migration).not.toContain(
      "NULLIF(elem->>'role', '')\n  FROM jsonb_array_elements",
    );
  });

  it('derives browser authority and rejects unauthorized or unsafe targets', () => {
    expect(migration).toContain(
      'employee.auth_user_id = (SELECT auth.uid())',
    );
    expect(migration).toContain('employee.is_active IS TRUE');
    expect(migration).toContain('employee.is_external IS FALSE');
    expect(migration).toContain(
      'public.can_current_employee_manage_appointment_crew(',
    );
    expect(migration).toContain(
      "'NOT_AUTHORIZED: appointment crew management required'",
    );
    expect(migration).toContain(
      "'sync_appointment_crew: active internal crew required'",
    );
    expect(migration).toContain(
      "employee.role::text IN ('admin', 'project_manager')",
    );
    expect(migration).toContain(
      "employee.role::text IN ('field_tech', 'estimator')",
    );
    expect(migration).toContain(
      "v_request_role = 'service_role'",
    );
  });

  it('uses a locked set diff and preserves unchanged assignment identities', () => {
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain(
      'DELETE FROM public.appointment_crew existing',
    );
    expect(migration).toContain(
      'UPDATE public.appointment_crew existing',
    );
    expect(migration).toContain(
      'ON CONFLICT (appointment_id, employee_id) DO NOTHING',
    );
    expect(isolatedProof).toContain(
      'crew row identity changed during role-only sync',
    );
    expect(isolatedProof).toContain(
      'unassigned employee replaced appointment crew',
    );
    expect(isolatedProof).toContain(
      'external employee accepted as appointment crew',
    );
    expect(isolatedProof).toContain(
      'anonymous caller replaced appointment crew',
    );
    expect(isolatedProof).toContain(
      'inactive employee replaced appointment crew',
    );
    expect(isolatedProof).toContain(
      'external employee replaced appointment crew',
    );
    expect(isolatedProof).toContain(
      'office employee replaced private appointment crew',
    );
    expect(isolatedProof).toContain(
      'assigned technician replaced private appointment crew',
    );
    expect(isolatedProof).toContain(
      'admin could not manage private appointment crew',
    );
    expect(isolatedProof).toContain(
      "has_function_privilege(\n      'anon'",
    );
  });

  it('revokes broad execution and makes rollback fail closed', () => {
    for (const sql of [migration, rollback]) {
      expect(sql).toContain(
        'REVOKE EXECUTE ON FUNCTION public.sync_appointment_crew(uuid, jsonb)',
      );
      expect(sql).toContain(
        'FROM PUBLIC, anon, authenticated, service_role;',
      );
      expect(sql).toContain(
        'TO authenticated, service_role;',
      );
    }
    expect(rollback).toContain(
      'sync_appointment_crew temporarily disabled during rollback containment',
    );
    expect(rollback).not.toContain(
      "NULLIF(elem->>'role', '')",
    );
    expect(rollback).toContain(
      'rollback refuses to replace an unknown/newer body',
    );
  });
});
