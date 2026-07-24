/**
 * Static release guard for CallRail sent-event NANP identity reconciliation.
 * Live catalog/behavior verification is a separate shared-Supabase apply step.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  '../../supabase/migrations/20260724174000_fix_callrail_outbound_phone_identity.sql',
  import.meta.url,
)), 'utf8');

describe('CallRail outbound phone identity migration', () => {
  it('preserves the RPC signature and service-role-only boundary', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_outbound_event(',
    );
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain("current_user <> 'service_role'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.project_callrail_outbound_event\(uuid, uuid\)[\s\S]*FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.project_callrail_outbound_event\(uuid, uuid\)[\s\S]*TO service_role;/,
    );
  });

  it('accepts only exact or validated NANP 10/+1 identity', () => {
    expect(migration).toContain(
      'v_attempt.recipient_address IS NOT DISTINCT FROM v_event.recipient_address',
    );
    expect(migration).toContain("v_attempt_digits ~ '^[2-9][0-9]{9}$'");
    expect(migration).toContain("v_attempt_digits ~ '^1[2-9][0-9]{9}$'");
    expect(migration).toContain("v_event_digits ~ '^[2-9][0-9]{9}$'");
    expect(migration).toContain("v_event_digits ~ '^1[2-9][0-9]{9}$'");
    expect(migration).toContain(
      'right(v_attempt_digits, 10) = right(v_event_digits, 10)',
    );
  });

  it('keeps body, provider message, and conversation identity checks', () => {
    expect(migration).toContain(
      'v_attempt.submitted_body IS DISTINCT FROM v_event.content',
    );
    expect(migration).toContain(
      'v_attempt.provider_message_id <> v_event.provider_message_id',
    );
    expect(migration).toContain(
      'v_attempt.provider_conversation_id <> v_event.provider_conversation_id',
    );
  });

  it('documents rollback to raw equality and never deletes retained events', () => {
    expect(migration).toContain(
      '20260723215926_messaging_transport_foundation.sql',
    );
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
