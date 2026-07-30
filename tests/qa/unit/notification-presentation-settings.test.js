/**
 * ════════════════════════════════════════════════
 * FILE: notification-presentation-settings.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the repository-visible security contract for notification presentation
 *   storage: additive tables, forced RLS, zero browser grants, service-only
 *   mutation, internal-admin revalidation, audit/idempotency, and rollback.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs/path
 *   Internal:  the paired 20260729163127 migration/rollback
 *   Data:      source inspection only; no database
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const migration = readFileSync(join(
  ROOT,
  'supabase/migrations/20260729163127_notification_presentation_settings.sql',
), 'utf8');
const rollback = readFileSync(join(
  ROOT,
  'supabase/rollbacks/20260729163127_notification_presentation_settings.rollback.sql',
), 'utf8');

describe('notification presentation migration contract', () => {
  it('creates only additive presentation and audit objects with forced RLS', () => {
    expect(migration).toContain('CREATE TABLE public.notification_presentation_overrides');
    expect(migration).toContain('CREATE TABLE public.notification_presentation_audit');
    expect(migration).toContain(
      'ALTER TABLE public.notification_presentation_overrides FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'ALTER TABLE public.notification_presentation_audit FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).not.toMatch(/\b(?:DROP|RENAME)\b/i);
  });

  it('gives browser roles no table or mutation-function access', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.notification_presentation_overrides\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.notification_presentation_audit\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.mutate_notification_presentation\([\s\S]*?\)\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mutate_notification_presentation\([\s\S]*?\)\s+TO service_role;/,
    );
  });

  it('pins the definer boundary and repeats literal internal-admin authorization', () => {
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain(
      "current_setting('request.jwt.claim.role', true), '') <> 'service_role'",
    );
    expect(migration).toContain("e.role::text = 'admin'");
    expect(migration).toContain('e.is_active IS TRUE');
    expect(migration).toContain('e.is_external IS FALSE');
  });

  it('keeps current state, history, idempotency, and optimistic concurrency atomic', () => {
    expect(migration).toContain('request_id uuid NOT NULL UNIQUE');
    expect(migration).toContain('UNIQUE (type_key, surface, revision)');
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('REVISION_CONFLICT');
    expect(migration).toContain('INSERT INTO public.notification_presentation_audit');
    expect(migration).toContain("'replayed', true");
  });

  it('creates explicit service-only read policies while browser grants stay revoked', () => {
    expect(migration).toMatch(
      /CREATE POLICY notification_presentation_overrides_service_read[\s\S]*?TO service_role[\s\S]*?USING \(true\);/,
    );
    expect(migration).toMatch(
      /CREATE POLICY notification_presentation_audit_service_read[\s\S]*?TO service_role[\s\S]*?USING \(true\);/,
    );
  });

  it('stores templates and route ids, never rendered people/provider payloads or secrets', () => {
    const storageDdl = migration.slice(
      migration.indexOf('CREATE TABLE public.notification_presentation_overrides'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.mutate_notification_presentation'),
    );
    expect(migration).toContain('title_template text');
    expect(migration).toContain('body_template text');
    expect(migration).toContain('route_id text');
    expect(storageDdl).not.toMatch(/\b(?:customer_name|phone|email|address|secret|token|provider_payload)\b/i);
  });

  it('ships the exact paired rollback', () => {
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.mutate_notification_presentation');
    expect(rollback).toContain('DROP TABLE IF EXISTS public.notification_presentation_audit;');
    expect(rollback).toContain('DROP TABLE IF EXISTS public.notification_presentation_overrides;');
  });
});
