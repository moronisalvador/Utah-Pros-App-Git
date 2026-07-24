/**
 * ════════════════════════════════════════════════
 * FILE: callrail-outbound-mms-identity-migration.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the database change keeps CallRail image confirmations tied
 *   to the correct message type and an attachment already owned by UPR.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:url, vitest
 *   Internal:  CallRail outbound MMS identity migration and rollback
 *   Data:      reads  → migration source files
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These source checks run in the normal worker lane.
 *   - Live database behavior and role checks remain a separate apply step.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724193628_bind_callrail_outbound_mms_identity.sql',
  import.meta.url,
)), 'utf8');
const rollback = readFileSync(fileURLToPath(new URL(
  '../../supabase/rollbacks/20260724193628_bind_callrail_outbound_mms_identity.rollback.sql',
  import.meta.url,
)), 'utf8');

describe('CallRail outbound MMS identity migration', () => {
  it('preserves the RPC signature, invoker mode, and service-only execution', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_outbound_event(',
    );
    expect(migration).toContain('p_event_id uuid');
    expect(migration).toContain('p_attempt_id uuid DEFAULT NULL');
    expect(migration).toMatch(
      /RETURNS TABLE \(\s*outcome text,\s*message_id uuid,\s*send_attempt_id uuid\s*\)/,
    );
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain("current_user <> 'service_role'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.project_callrail_outbound_event\(uuid, uuid\)[\s\S]+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.project_callrail_outbound_event\(uuid, uuid\)[\s\S]+TO service_role/,
    );
  });

  it('refuses channel mismatches before confirming an attempt', () => {
    expect(migration).toContain(
      'v_attempt.requested_channel IS DISTINCT FROM v_event.message_type',
    );
    expect(migration.indexOf(
      'v_attempt.requested_channel IS DISTINCT FROM v_event.message_type',
    )).toBeLessThan(migration.indexOf('UPDATE public.message_send_attempts'));
  });

  it('requires a non-empty private outbound media array for MMS', () => {
    expect(migration).toContain("v_event.message_type = 'mms'");
    expect(migration).toContain('jsonb_array_length');
    expect(migration).toContain(
      'upr-storage://message-attachments/outbound/',
    );
  });

  it('reuses the deployed fail-closed outcome for rollout compatibility', () => {
    expect(migration).toContain("'outbound_unmatched'::text");
    expect(migration).not.toContain('outbound_channel_mismatch');
    expect(migration).not.toContain('outbound_media_unowned');
  });

  it('ships an exact prior-body rollback without widening grants', () => {
    expect(rollback).toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_outbound_event(',
    );
    expect(rollback).not.toContain('outbound_channel_mismatch');
    expect(rollback).not.toContain('outbound_media_unowned');
    expect(rollback).toMatch(
      /REVOKE ALL ON FUNCTION public\.project_callrail_outbound_event\(uuid, uuid\)[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(rollback).not.toMatch(/\bTO\s+(?:PUBLIC|anon|authenticated)\b/i);
  });
});
