/**
 * ════════════════════════════════════════════════
 * FILE: notification-activation-prerequisites.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the static least-privilege and index contract required before the
 *   notification producer migrations can be applied to Production.
 * ════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('.');
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20260803221500_notification_activation_prerequisites.sql',
  ),
  'utf8',
);
const rollback = fs.readFileSync(
  path.join(
    root,
    'supabase/rollbacks/20260803221500_notification_activation_prerequisites.rollback.sql',
  ),
  'utf8',
);

describe('notification activation prerequisites migration', () => {
  it('adds the three exact producer foreign-key indexes', () => {
    expect(migration).toContain(
      'CREATE INDEX notification_producer_occurrences_type_key_idx',
    );
    expect(migration).toContain(
      'ON public.notification_producer_occurrences(type_key);',
    );
    expect(migration).toContain(
      'CREATE INDEX notification_delivery_claims_event_idx',
    );
    expect(migration).toContain(
      'ON public.notification_delivery_claims(notification_event_id);',
    );
    expect(migration).toContain(
      'CREATE INDEX notification_delivery_claims_employee_idx',
    );
    expect(migration).toContain(
      'ON public.notification_delivery_claims(employee_id);',
    );
    expect(migration).toContain(
      'notification activation prerequisites: candidate index already exists',
    );
    expect(migration).not.toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('revokes every browser privilege from the three deny-all secret stores', () => {
    for (const source of [migration, rollback]) {
      expect(source).toMatch(
        /REVOKE ALL PRIVILEGES ON TABLE[\s\S]*public\.billing_2fa_codes,[\s\S]*public\.integration_config,[\s\S]*public\.user_google_accounts[\s\S]*FROM PUBLIC, anon, authenticated;/,
      );
      expect(source).toContain('aclexplode(');
      expect(source).toContain('acl.grantee = 0');
      expect(source).toContain('column_record.attacl');
      expect(source).toContain("to_regrole('anon')::oid");
      expect(source).toContain("to_regrole('authenticated')::oid");
      expect(source).toContain("has_table_privilege(\n         'anon'");
      expect(source).toContain("has_table_privilege(\n         'authenticated'");
      expect(source).not.toContain("has_table_privilege(\n         'PUBLIC'");
    }
    expect(migration).not.toMatch(/GRANT[\s\S]*TO (PUBLIC|anon|authenticated)/);
    expect(rollback).not.toMatch(/GRANT[\s\S]*TO (PUBLIC|anon|authenticated)/);
  });

  it('requires RLS/no-policy ownership and preserves service access', () => {
    expect(migration).toContain(
      "pg_get_userbyid(table_record.relowner) = 'postgres'",
    );
    expect(migration).toContain('table_record.relrowsecurity');
    expect(migration).toContain('FROM pg_policy');
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(migration).toContain(
        `'service_role',\n         to_regclass('public.' || v_table),\n         '${privilege}'`,
      );
    }
  });

  it('rolls back only the indexes and keeps the secret stores fail-closed', () => {
    expect(rollback).toContain(
      'DROP INDEX IF EXISTS public.notification_delivery_claims_employee_idx;',
    );
    expect(rollback).toContain(
      'DROP INDEX IF EXISTS public.notification_delivery_claims_event_idx;',
    );
    expect(rollback).toContain(
      'DROP INDEX IF EXISTS public.notification_producer_occurrences_type_key_idx;',
    );
    expect(rollback).not.toMatch(/GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE)/);
  });
});
