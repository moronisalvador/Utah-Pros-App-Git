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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const migration = read('supabase/migrations/20260726183409_inbound_lead_recording_source_boundary.sql');
const rollback = read('supabase/rollbacks/20260726183409_inbound_lead_recording_source_boundary.rollback.sql');

describe('S1e recording-source migration CI contract', () => {
  it('removes browser writes and raw recording-source storage', () => {
    expect(migration).toContain('REVOKE ALL ON TABLE public.inbound_leads FROM anon');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER');
    expect(migration).toContain('CREATE TABLE public.inbound_lead_recording_sources');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain("WHERE e.key NOT IN ('recording', 'recording_url')");
    expect(migration).toContain("SET recording_url = 'upr-recording://available'");
  });

  it('keeps source reads and ingestion service-only', () => {
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.inbound_lead_recording_sources FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain('ON TABLE public.inbound_lead_recording_sources TO service_role');
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
});
