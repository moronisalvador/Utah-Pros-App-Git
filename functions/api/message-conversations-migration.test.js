/**
 * Static release guard for the service-only direct-conversation RPC hardening.
 * Live catalog verification remains a separate shared-Supabase apply step.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724173000_harden_find_or_create_conversation.sql',
  import.meta.url,
)), 'utf8');

describe('find_or_create_conversation hardening migration', () => {
  it('preserves the signature and pins the SECURITY INVOKER boundary', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.find_or_create_conversation(p_contact_id uuid)',
    );
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).toContain("SET search_path TO 'pg_catalog', 'public'");
    expect(migration).toContain("current_user <> 'service_role'");
    expect(migration).toContain("ERRCODE = '42501'");
    expect(migration).toContain('RETURNS jsonb');
  });

  it('is callable only by service_role', () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.find_or_create_conversation\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.find_or_create_conversation\(uuid\)[\s\S]*TO service_role;/,
    );
    expect(migration).not.toMatch(/TO authenticated/);
  });

  it('reuses only an active, non-archived direct thread for one contact identity', () => {
    expect(migration).toContain("WHERE c.type = 'direct'");
    expect(migration).toContain("c.status <> 'archived'");
    expect(migration).toContain('cp.is_active = true');
    expect(migration).toContain('cp.removed_at IS NULL');
    expect(migration).toContain('other.contact_id IS DISTINCT FROM p_contact_id');
    expect(migration).toContain(
      "pg_advisory_xact_lock(hashtext('find_or_create_conversation:' || p_contact_id::text))",
    );
  });

  it('documents the exact rollback source and its security regression', () => {
    expect(migration).toContain('20260709_tech_msgs_v2_fm_conversation_rpcs.sql');
    expect(migration).toContain('re-grant EXECUTE to');
    expect(migration).toContain('authenticated, service_role');
  });
});
