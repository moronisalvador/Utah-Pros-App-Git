/**
 * ════════════════════════════════════════════════
 * FILE: notification-delivery-diagnostic-claims.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins the repository-visible database boundary that prevents an owner
 *   notification test retry from delivering the same logical test twice.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs/path
 *   Internal:  the paired 20260729181049 migration/rollback
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
  'supabase/migrations/20260729181049_notification_delivery_diagnostic_claims.sql',
), 'utf8');
const rollback = readFileSync(join(
  ROOT,
  'supabase/rollbacks/20260729181049_notification_delivery_diagnostic_claims.rollback.sql',
), 'utf8');

describe('notification delivery diagnostic claim migration contract', () => {
  it('adds one forced-RLS claim ledger with a stable employee/channel/request key', () => {
    expect(migration).toContain(
      'CREATE TABLE public.notification_delivery_diagnostic_claims',
    );
    expect(migration).toContain(
      'PRIMARY KEY (employee_id, channel, request_id)',
    );
    expect(migration).toMatch(
      /ALTER TABLE public\.notification_delivery_diagnostic_claims\s+FORCE ROW LEVEL SECURITY;/,
    );
    expect(migration).not.toMatch(/\b(?:ALTER COLUMN|RENAME)\b/i);
  });

  it('gives browser roles no table or function access', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.notification_delivery_diagnostic_claims\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.claim_notification_delivery_diagnostic\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.complete_notification_delivery_diagnostic\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.claim_notification_delivery_diagnostic\([\s\S]*?\) TO service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_notification_delivery_diagnostic\([\s\S]*?\) TO service_role;/,
    );
  });

  it('uses invoker functions with an empty path and repeated service-role checks', () => {
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(2);
    expect(migration.match(/SET search_path TO ''/g)).toHaveLength(2);
    expect(migration.match(/current_user <> 'service_role'/g)).toHaveLength(2);
  });

  it('claims before delivery and returns the stored result on replay', () => {
    expect(migration).toContain(
      'ON CONFLICT (employee_id, channel, request_id) DO NOTHING',
    );
    expect(migration).toContain("'claimed', false");
    expect(migration).toContain("'result', v_result");
    expect(migration).toContain("state = 'complete'");
    expect(migration).toContain('completed_at = now()');
  });

  it('bounds retained claim history and stored diagnostic fields', () => {
    expect(migration).toContain("interval '90 days'");
    expect(migration).toContain('LIMIT 1000');
    expect(migration).toContain("'channel',");
    expect(migration).toContain("'ok',");
    expect(migration).toContain("'sent',");
    expect(migration).toContain("'attempted',");
    expect(migration).toContain("'pruned',");
    expect(migration).toContain("'reason'");
    expect(migration).not.toMatch(
      /\b(?:recipient_email|recipient_phone|provider_payload|credential|secret|message_body)\s+(?:text|jsonb)\b/i,
    );
  });

  it('ships the exact paired rollback', () => {
    expect(rollback).toContain(
      'DROP FUNCTION IF EXISTS public.complete_notification_delivery_diagnostic',
    );
    expect(rollback).toContain(
      'DROP FUNCTION IF EXISTS public.claim_notification_delivery_diagnostic',
    );
    expect(rollback).toContain(
      'DROP TABLE IF EXISTS public.notification_delivery_diagnostic_claims;',
    );
  });
});
