/**
 * ════════════════════════════════════════════════
 * FILE: scheduled-message-authorization-migration.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the two scheduled-text database changes keep browser access
 *   narrow, reserve only one delivery, and ship a safe two-step rollback.
 *
 * DEPENDS ON:
 *   Packages: vitest, node:fs, node:path
 *   Internal: the scheduled-message migrations and rollbacks
 *   Data:     reads  → migration source files
 *             writes → none
 *
 * NOTES / GOTCHAS:
 *   - This checks source intent only. The guarded database test proves behavior
 *     on an isolated local clone and is not represented as credential-free CI.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const compatibility = read('supabase/migrations/20260731220000_scheduled_message_delivery_compatibility.sql');
const enforcement = read('supabase/migrations/20260731220100_scheduled_message_delivery_enforcement.sql');
const compatibilityRollback = read('supabase/rollbacks/20260731220000_scheduled_message_delivery_compatibility.rollback.sql');
const enforcementRollback = read('supabase/rollbacks/20260731220100_scheduled_message_delivery_enforcement.rollback.sql');

describe('scheduled-message authorization migration', () => {
  it('adds a fenced lease and exactly-one durable attempt link without altering legacy columns', () => {
    expect(compatibility).toMatch(/ADD COLUMN claim_token uuid,[\s\S]*delivery_attempt_id uuid/);
    expect(compatibility).toMatch(/CREATE UNIQUE INDEX scheduled_messages_delivery_attempt_id_key[\s\S]*WHERE delivery_attempt_id IS NOT NULL/);
    expect(compatibility).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_scheduled_message\(p_id uuid\)[\s\S]*delivery_attempt_id IS NULL/);
    expect(compatibility).toMatch(/claim_scheduled_message_v2[\s\S]*delivery_attempt_id IS NULL/);
    expect(compatibility).toMatch(/reserve_scheduled_message_delivery\([\s\S]*p_media_urls jsonb DEFAULT '\[\]'::jsonb[\s\S]*RETURNS TABLE\(outcome text, attempt_id uuid\)/);
    expect(compatibility).toMatch(/extensions\.digest\(convert_to\(/);
    expect(compatibility).toMatch(/jsonb_array_length\(p_media_urls\) > 0 THEN 'mms' ELSE 'sms'/);
  });

  it('derives browser actors and preserves owner-only queue/cancel contracts', () => {
    expect(compatibility).toMatch(/employee\.auth_user_id = auth\.uid\(\)[\s\S]*employee\.is_active AND NOT employee\.is_external/);
    expect(compatibility).toMatch(/messaging_employee_has_conversations_capability[\s\S]*messaging_employee_can_access_conversation/);
    expect(compatibility).toMatch(/v_recipients <> 1/);
    expect(compatibility).toMatch(/participant\.contact_id IS NOT NULL[\s\S]*NULLIF\(btrim\(participant\.phone\), ''\) IS NOT NULL/);
    expect(compatibility).not.toMatch(/role, 'customer'|role\) = 'customer'/);
    expect(compatibility).toMatch(/lower\(employee\.email\) = 'moroni@utah-pros\.com'/);
    expect(compatibility).toMatch(/scheduled queue is DevTools-owner only[\s\S]*RETURN QUERY[\s\S]*SELECT[\s\S]*sm\.id/);
    expect(compatibility).toMatch(/RETURNS TABLE\(id uuid, body text, send_at timestamptz, status text, contact_name text, contact_phone text, template_name text\)/);
    expect(compatibility).toMatch(/LEFT JOIN LATERAL \([\s\S]*WHEN count\(\*\) > 1 THEN count\(\*\)::text \|\| ' recipients'[\s\S]*\) recipient ON true/);
  });

  it('keeps every new send lifecycle RPC service-only and reconciliation provider-free', () => {
    expect(compatibility).toMatch(/REVOKE ALL ON FUNCTION public\.claim_scheduled_message\(uuid\) FROM PUBLIC, anon, authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_scheduled_message\(uuid\) TO service_role;/);
    expect(compatibility).toMatch(/REVOKE ALL ON FUNCTION public\.claim_scheduled_message_v2[\s\S]*public\.reconcile_scheduled_message_delivery\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(compatibility).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_scheduled_message_v2[\s\S]*public\.reconcile_scheduled_message_delivery\(uuid\) TO service_role;/);
    expect(compatibility).toMatch(/reconcile_scheduled_message_delivery\(p_id uuid\)/);
    expect(compatibility).toMatch(/materialize_message_send_attempt\(v_scheduled\.delivery_attempt_id\)/);
    expect(compatibility).toMatch(/status = 'waiting_on_client', status_changed_at = now\(\), updated_at = now\(\)/);
    expect(compatibility).toMatch(/v_scheduled\.claimed_at >= now\(\) - interval '10 minutes'[\s\S]*'status', 'in_flight'/);
    expect(compatibility).toMatch(/SCHEDULED_OUTCOME_UNKNOWN/);
    expect(compatibility).not.toMatch(/reconcile_scheduled_message_delivery\(\s*p_id uuid,[^)]/);
  });

  it('preflights then removes direct authenticated access and retires the legacy claim', () => {
    expect(enforcement).toMatch(/legacy policy or ACL baseline drifted/);
    expect(enforcement).toMatch(/DROP POLICY allow_anon_read_scheduled_messages[\s\S]*DROP POLICY allow_anon_insert_scheduled_messages[\s\S]*DROP POLICY allow_authenticated_scheduled_messages/);
    expect(enforcement).toMatch(/REVOKE ALL ON TABLE public\.scheduled_messages FROM PUBLIC, authenticated, anon, service_role/);
    expect(enforcement).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.scheduled_messages TO service_role/);
    expect(enforcement).toMatch(/has_table_privilege\('anon', 'public\.scheduled_messages', 'TRUNCATE'\)/);
    expect(enforcement).toMatch(/has_table_privilege\('service_role', 'public\.scheduled_messages', 'TRIGGER'\)/);
    expect(enforcement).toMatch(/claim_scheduled_message is retired; use claim_scheduled_message_v2/);
    expect(enforcement).toMatch(/REVOKE ALL ON FUNCTION public\.claim_scheduled_message\(uuid\) FROM PUBLIC, anon, authenticated, service_role/);
    expect(enforcement).toMatch(/has_function_privilege\('service_role', 'public\.claim_scheduled_message\(uuid\)', 'EXECUTE'\)/);
  });

  it('ships paired rollback bodies for the exact broad legacy posture', () => {
    expect(compatibilityRollback).toMatch(/unresolved provider reservations require owner reconciliation/);
    expect(compatibilityRollback).not.toMatch(/DROP COLUMN IF EXISTS delivery_attempt_id/);
    expect(compatibilityRollback).toMatch(/CREATE OR REPLACE FUNCTION public\.get_scheduled_queue/);
    expect(enforcementRollback).toMatch(/CREATE POLICY allow_anon_read_scheduled_messages[\s\S]*USING \(true\)/);
    expect(enforcementRollback).toMatch(/CREATE POLICY allow_authenticated_scheduled_messages[\s\S]*USING \(true\) WITH CHECK \(true\)/);
    expect(enforcementRollback).toMatch(/UPDATE public\.scheduled_messages SET claimed_at = now\(\)/);
  });
});
