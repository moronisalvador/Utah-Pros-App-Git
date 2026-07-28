/**
 * ════════════════════════════════════════════════
 * FILE: native-apns-token-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the safety promises of the iPhone notification registration change.
 *   It prevents later edits from exposing private tokens, accepting an employee
 *   chosen by the app, or mixing development and production registrations.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  migration and rollback SQL source
 *   Data:      reads  → repository files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is the CI-visible source contract. The isolated SQL test covers
 *     runtime behavior against a disposable local Supabase database.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260728223000_native_apns_token_boundary.sql',
  'utf8',
);
const rollback = readFileSync(
  'supabase/rollbacks/20260728223000_native_apns_token_boundary.rollback.sql',
  'utf8',
);
const grantStatements = (sql) => sql.match(/\bGRANT\b[^;]*;/gi) || [];

describe('native APNs token boundary migration', () => {
  it('stores an exact environment while leaving legacy rows inert', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS apns_environment text');
    expect(migration).toContain("apns_environment IN ('sandbox', 'production')");
    expect(migration).not.toMatch(/UPDATE\s+public\.device_tokens/i);
  });

  it('derives the employee and never accepts an employee selector', () => {
    const signature = migration.match(
      /CREATE OR REPLACE FUNCTION public\.upsert_my_native_device_token\(([\s\S]*?)\)\s*RETURNS jsonb/,
    )?.[1] || '';
    expect(signature).toContain('p_token text');
    expect(signature).toContain('p_apns_environment text');
    expect(signature).not.toContain('p_employee_id');
    expect(migration).toContain('employee.auth_user_id = auth.uid()');
  });

  it('returns redacted metadata and removes raw browser access', () => {
    const returned = migration.match(
      /RETURN jsonb_build_object\(([\s\S]*?)\);\s*END;\s*\$function\$;/,
    )?.[1] || '';
    expect(returned).not.toMatch(/['"]token['"]/);
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.upsert_device_token\(uuid, text, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.device_tokens\s+FROM PUBLIC, anon, authenticated;/,
    );
  });

  it('keeps every new definer function explicitly least-privileged', () => {
    for (const signature of [
      'public.upsert_my_native_device_token(text, text)',
      'public.delete_my_native_device_token(text)',
    ]) {
      expect(migration).toContain(
        `REVOKE EXECUTE ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated, service_role;`,
      );
    }
    expect(grantStatements(migration).join('\n')).not.toMatch(/\bTO\s+(?:PUBLIC|anon)\b/i);
  });

  it('rolls back by disabling enrollment without reopening token exposure', () => {
    expect(rollback).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.upsert_my_native_device_token\(text, text\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(grantStatements(rollback).join('\n')).not.toMatch(/\bTO\s+(?:PUBLIC|anon)\b/i);
    expect(rollback).not.toMatch(/GRANT\s+.*ON TABLE public\.device_tokens.*authenticated/i);
    expect(rollback).not.toMatch(/\bDROP\b/i);
  });
});
