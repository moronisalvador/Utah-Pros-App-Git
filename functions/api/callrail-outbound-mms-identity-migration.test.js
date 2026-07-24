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
 *   Internal:  CallRail outbound MMS identity migrations and rollbacks
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
const frozenShapeMigration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724195802_accept_frozen_callrail_mms_media_shape.sql',
  import.meta.url,
)), 'utf8');
const frozenShapeRollback = readFileSync(fileURLToPath(new URL(
  '../../supabase/rollbacks/20260724195802_accept_frozen_callrail_mms_media_shape.rollback.sql',
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

  it('normalizes the frozen canonical JSON-string media shape before validation', () => {
    expect(frozenShapeMigration).toContain(
      "IF jsonb_typeof(v_existing_media) = 'string' THEN",
    );
    expect(frozenShapeMigration).toContain(
      "v_existing_media := (v_existing_media #>> '{}')::jsonb",
    );
    expect(frozenShapeMigration).toContain(
      "WHEN invalid_text_representation THEN",
    );
    expect(frozenShapeMigration).toContain(
      "v_existing_media := '[]'::jsonb",
    );
    expect(frozenShapeMigration.indexOf(
      "IF jsonb_typeof(v_existing_media) = 'string' THEN",
    )).toBeLessThan(frozenShapeMigration.indexOf(
      "jsonb_array_length(v_existing_media) = 0",
    ));
  });

  it('keeps the same private-reference guard and service-only ACL in the follow-up', () => {
    expect(frozenShapeMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_outbound_event(',
    );
    expect(frozenShapeMigration).toContain('p_event_id uuid');
    expect(frozenShapeMigration).toContain('p_attempt_id uuid DEFAULT NULL');
    expect(frozenShapeMigration).toMatch(
      /RETURNS TABLE \(\s*outcome text,\s*message_id uuid,\s*send_attempt_id uuid\s*\)/,
    );
    expect(frozenShapeMigration).toContain(
      'upr-storage://message-attachments/outbound/',
    );
    expect(frozenShapeMigration).toContain(
      'v_attempt.requested_channel IS DISTINCT FROM v_event.message_type',
    );
    expect(frozenShapeMigration).toContain('SECURITY INVOKER');
    expect(frozenShapeMigration).toContain('SET search_path = pg_catalog, public');
    expect(frozenShapeMigration).toContain("current_user <> 'service_role'");
    expect(frozenShapeMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.project_callrail_outbound_event\(uuid, uuid\)[\s\S]+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(frozenShapeMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.project_callrail_outbound_event\(uuid, uuid\)[\s\S]+TO service_role/,
    );
  });

  it('rolls the follow-up back to the exact prior function body', () => {
    const priorBody = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION'),
      migration.lastIndexOf(';') + 1,
    );
    const rollbackBody = frozenShapeRollback.slice(
      frozenShapeRollback.indexOf('CREATE OR REPLACE FUNCTION'),
      frozenShapeRollback.lastIndexOf(';') + 1,
    );
    expect(rollbackBody).toBe(priorBody);
  });
});
