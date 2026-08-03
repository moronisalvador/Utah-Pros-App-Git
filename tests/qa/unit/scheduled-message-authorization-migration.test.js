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
const isolatedProof = read('supabase/tests/scheduled_message_delivery.test.sql');

describe('scheduled-message authorization migration', () => {
  it('adds a fenced lease, immutable RPC provenance, and exactly-one durable attempt link', () => {
    expect(compatibility).toMatch(/ADD COLUMN claim_token uuid,[\s\S]*delivery_attempt_id uuid/);
    expect(compatibility).toMatch(/CREATE UNIQUE INDEX scheduled_messages_delivery_attempt_id_key[\s\S]*WHERE delivery_attempt_id IS NOT NULL/);
    expect(compatibility).toMatch(/CREATE TABLE public\.scheduled_message_creation_provenance[\s\S]*scheduled_message_id uuid PRIMARY KEY[\s\S]*created_by uuid NOT NULL[\s\S]*conversation_id uuid NOT NULL[\s\S]*recipient_contact_id uuid NOT NULL[\s\S]*recipient_address text NOT NULL[\s\S]*send_at timestamptz NOT NULL[\s\S]*body_fingerprint text NOT NULL/);
    expect(compatibility).toMatch(/ALTER TABLE public\.scheduled_message_creation_provenance ENABLE ROW LEVEL SECURITY;[\s\S]*ALTER TABLE public\.scheduled_message_creation_provenance FORCE ROW LEVEL SECURITY;[\s\S]*FOR ALL TO postgres USING \(true\) WITH CHECK \(true\);[\s\S]*FOR SELECT TO service_role USING \(true\)[\s\S]*REVOKE ALL ON TABLE public\.scheduled_message_creation_provenance[\s\S]*GRANT SELECT ON TABLE public\.scheduled_message_creation_provenance TO service_role/);
    expect(compatibility).toMatch(/ACCESS EXCLUSIVE lock[\s\S]*v_legacy_pending bigint[\s\S]*SELECT count\(\*\)[\s\S]*WHERE status = 'pending'[\s\S]*v_legacy_pending <> 0[\s\S]*owner-led resolution before apply[\s\S]*ERRCODE = '55000'/);
    expect(compatibility).not.toMatch(/UPDATE public\.scheduled_messages message\s+SET status = 'failed'/);
    expect(compatibility).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_scheduled_message\(p_id uuid\)[\s\S]*SECURITY INVOKER[\s\S]*RETURN false;/);
    expect(compatibility).not.toMatch(/CREATE OR REPLACE FUNCTION public\.claim_scheduled_message\(p_id uuid\)[\s\S]*UPDATE public\.scheduled_messages[\s\S]*REVOKE ALL ON FUNCTION public\.claim_scheduled_message\(uuid\)/);
    expect(compatibility).toMatch(/claim_scheduled_message_v2[\s\S]*delivery_attempt_id IS NULL/);
    expect(compatibility).toMatch(/claim_scheduled_message_v2[\s\S]*scheduled_message_creation_provenance provenance[\s\S]*provenance\.created_by = message\.created_by[\s\S]*provenance\.conversation_id = message\.conversation_id[\s\S]*provenance\.send_at = message\.send_at[\s\S]*provenance\.body_fingerprint/);
    expect(compatibility).toMatch(/reserve_scheduled_message_delivery[\s\S]*v_provenance\.recipient_contact_id[\s\S]*IS DISTINCT FROM p_recipient_contact_id[\s\S]*v_provenance\.recipient_address[\s\S]*IS DISTINCT FROM btrim\(p_recipient_address\)/);
    expect(compatibility).toMatch(/reserve_scheduled_message_delivery\([\s\S]*p_media_urls jsonb DEFAULT '\[\]'::jsonb[\s\S]*RETURNS TABLE\(outcome text, attempt_id uuid\)/);
    expect(compatibility).toMatch(/reserve_scheduled_message_delivery[\s\S]*FOR SHARE OF setting[\s\S]*COALESCE\(v_sms_sending_enabled, false\) IS NOT TRUE[\s\S]*'sms_disabled'::text, NULL::uuid/);
    expect(compatibility).toMatch(/reserve_scheduled_message_delivery[\s\S]*get_service_sms_consent_status\([\s\S]*v_consent_status->>'code' = 'DND_ACTIVE'[\s\S]*'dnd'::text, NULL::uuid[\s\S]*v_consent_status->>'code' IS DISTINCT FROM 'GLOBAL_OPT_IN'[\s\S]*'no_consent'::text, NULL::uuid[\s\S]*clock_timestamp\(\)[\s\S]*AT TIME ZONE 'America\/Denver'[\s\S]*time '08:00'[\s\S]*time '21:00'[\s\S]*'quiet_hours'::text, NULL::uuid[\s\S]*INSERT INTO public\.message_send_attempts/);
    expect(compatibility).toMatch(/current_setting\('upr\.isolated_test_database', true\) = 'on'[\s\S]*current_setting\('upr\.scheduled_delivery_test_now', true\)/);
    expect(compatibility).toMatch(/e6747ca478873d45faef76f7f3b2ff49[\s\S]*e106318eef49f04f16f295d881bc41fe[\s\S]*consent authority drifted/);
    expect(compatibility).toMatch(/extensions\.digest\(convert_to\(/);
    expect(compatibility).toMatch(/jsonb_array_length\(p_media_urls\) > 0 THEN 'mms' ELSE 'sms'/);
  });

  it('derives browser actors and preserves owner-only queue/cancel contracts', () => {
    expect(compatibility).toMatch(/employee\.auth_user_id = auth\.uid\(\)[\s\S]*employee\.is_active AND NOT employee\.is_external/);
    expect(compatibility).toMatch(/messaging_employee_has_conversations_capability[\s\S]*messaging_employee_can_access_conversation/);
    expect(compatibility).toMatch(/migration\.name = 'conversation_assignment_authority_containment'/);
    expect(compatibility).toMatch(/migration\.name = 'conversation_participant_policy_enforcement'/);
    expect(compatibility).toMatch(/participant write enforcement is absent/);
    expect(compatibility).toMatch(/participant policy enforcement drifted/);
    expect(compatibility).toMatch(/participant ACL enforcement drifted/);
    expect(compatibility).toMatch(/d10e6fa5fd127ed02aa39f8f926b413f/);
    expect(compatibility).toMatch(/procedure\.prosrc !~[\s\S]*appointment_crew[\s\S]*public\\?\.appointments[\s\S]*public\\?\.jobs[\s\S]*public\\?\.claims/);
    expect(compatibility).toMatch(/materialize_message_send_attempt\(uuid\)[\s\S]*58512aead8770fc0e7feec8547781c63/);
    expect(compatibility).toMatch(/v_recipients <> 1/);
    expect(compatibility).toMatch(/RETURNING id INTO v_inserted_id[\s\S]*INSERT INTO public\.scheduled_message_creation_provenance[\s\S]*scheduled message id was not created through the actor-derived RPC/);
    expect(compatibility).toMatch(/recipient_contact_id,[\s\S]*recipient_address,[\s\S]*v_recipient_contact_id,[\s\S]*v_recipient_address/);
    expect(compatibility).toMatch(/reserve_scheduled_message_delivery[\s\S]*p_id IS NULL OR p_claim_token IS NULL/);
    expect(compatibility).toMatch(/participant\.contact_id IS NOT NULL[\s\S]*NULLIF\(btrim\(participant\.phone\), ''\) IS NOT NULL/);
    expect(compatibility).not.toMatch(/role, 'customer'|role\) = 'customer'/);
    expect(compatibility).toMatch(/lower\(employee\.email\) = 'moroni@utah-pros\.com'/);
    expect(compatibility).toMatch(/scheduled queue is DevTools-owner only[\s\S]*RETURN QUERY[\s\S]*SELECT[\s\S]*sm\.id/);
    expect(compatibility).toMatch(/RETURNS TABLE\(id uuid, body text, send_at timestamptz, status text, contact_name text, contact_phone text, template_name text\)/);
    expect(compatibility).toMatch(/LEFT JOIN public\.scheduled_message_creation_provenance provenance[\s\S]*contact\.id = provenance\.recipient_contact_id/);
    expect(isolatedProof).toContain(
      'browser-forged appointment assignment cannot create scheduled provenance',
    );
    expect(isolatedProof).toContain(
      'browser-forged assignment created a scheduled row or provenance',
    );
    expect(isolatedProof).toContain(
      'crm_partner cannot create a scheduled message even with Conversations capability',
    );
    expect(isolatedProof).toContain(
      'crm_partner denial left scheduled-message residue',
    );
    expect(isolatedProof).toContain(
      'authenticated browser cannot insert raw scheduled queue rows',
    );
    expect(isolatedProof).toContain(
      'anonymous browser cannot insert raw scheduled queue rows',
    );
    expect(isolatedProof).toContain(
      'raw browser insert created scheduled-message residue',
    );
    expect(isolatedProof).toContain(
      'authenticated browser cannot rewrite a scheduled recipient',
    );
    expect(isolatedProof).toContain(
      'participant phone changed after scheduled creation',
    );
    expect(isolatedProof).toContain(
      'reservation requires a current non-null claim token',
    );
    expect(isolatedProof).toContain(
      'null-token reservation crossed the provider-attempt boundary',
    );
    expect(isolatedProof).toContain(
      'legacy authenticated claim did not remain a callable false no-op',
    );
    expect(isolatedProof).toContain(
      'legacy claim reclaimed a delivery-linked scheduled row',
    );
  });

  it('keeps every new send lifecycle RPC service-only and reconciliation provider-free', () => {
    expect(compatibility).toMatch(/ROLLOUT ORDER: deploy the hardened web\/Worker callers first; they fail closed/);
    expect(compatibility).toMatch(/REVOKE ALL ON FUNCTION public\.claim_scheduled_message\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_scheduled_message\(uuid\)[\s\S]*TO authenticated, service_role;/);
    expect(compatibility).toMatch(/REVOKE ALL ON FUNCTION public\.claim_scheduled_message_v2[\s\S]*public\.reconcile_scheduled_message_delivery\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(compatibility).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_scheduled_message_v2[\s\S]*public\.reconcile_scheduled_message_delivery\(uuid\) TO service_role;/);
    expect(compatibility).toMatch(/reconcile_scheduled_message_delivery\(p_id uuid\)/);
    expect(compatibility).toMatch(/materialize_message_send_attempt\(v_scheduled\.delivery_attempt_id\)/);
    expect(compatibility).toMatch(/status = 'waiting_on_client', status_changed_at = now\(\), updated_at = now\(\)/);
    expect(compatibility).toMatch(/v_scheduled\.claimed_at >= now\(\) - interval '10 minutes'[\s\S]*'status', 'in_flight'/);
    expect(compatibility).toMatch(/SCHEDULED_OUTCOME_UNKNOWN/);
    expect(compatibility).not.toMatch(/reconcile_scheduled_message_delivery\(\s*p_id uuid,[^)]/);
    expect(compatibility).toMatch(/Close the legacy browser table seam in this same transaction[\s\S]*REVOKE ALL ON TABLE public\.scheduled_messages FROM PUBLIC, authenticated, anon, service_role;[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.scheduled_messages TO service_role;[\s\S]*ALTER POLICY allow_anon_read_scheduled_messages[\s\S]*USING \(false\);[\s\S]*ALTER POLICY allow_anon_insert_scheduled_messages[\s\S]*WITH CHECK \(false\);[\s\S]*ALTER POLICY allow_authenticated_scheduled_messages[\s\S]*USING \(false\)[\s\S]*WITH CHECK \(false\);/);
  });

  it('preflights then removes direct authenticated access without dropping legacy policies', () => {
    expect(enforcement).toMatch(/legacy policy or ACL baseline drifted/);
    expect(enforcement).toMatch(/has_table_privilege\('authenticated', 'public\.scheduled_messages', 'INSERT'\)[\s\S]*OR NOT has_table_privilege\('service_role', 'public\.scheduled_messages', 'INSERT'\)/);
    expect(enforcement).not.toMatch(/DROP POLICY/);
    expect(enforcement).toMatch(/Historical policy objects remain as fail-closed catalog records/);
    expect(enforcement).toMatch(/fail-closed policy postcondition failed/);
    expect(enforcement).toMatch(/SELECT count\(\*\)[\s\S]*tablename = 'scheduled_messages'[\s\S]*<> 3/);
    expect(enforcement).toMatch(/REVOKE ALL ON TABLE public\.scheduled_messages FROM PUBLIC, authenticated, anon, service_role/);
    expect(enforcement).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.scheduled_messages TO service_role/);
    expect(enforcement).toMatch(/REVOKE ALL ON TABLE public\.scheduled_message_creation_provenance[\s\S]*GRANT SELECT ON TABLE public\.scheduled_message_creation_provenance TO service_role/);
    expect(enforcement).toMatch(/has_table_privilege\('authenticated', 'public\.scheduled_message_creation_provenance', 'INSERT'\)[\s\S]*has_table_privilege\('service_role', 'public\.scheduled_message_creation_provenance', 'INSERT'\)/);
    expect(enforcement).toMatch(/has_table_privilege\('anon', 'public\.scheduled_messages', 'TRUNCATE'\)/);
    expect(enforcement).toMatch(/has_table_privilege\('service_role', 'public\.scheduled_messages', 'TRIGGER'\)/);
    expect(enforcement).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_scheduled_message\(p_id uuid\)[\s\S]*SECURITY INVOKER[\s\S]*RETURN false;/);
    expect(enforcement).toMatch(/REVOKE ALL ON FUNCTION public\.claim_scheduled_message\(uuid\) FROM PUBLIC, anon, authenticated, service_role;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_scheduled_message\(uuid\)[\s\S]*TO authenticated, service_role;/);
    expect(enforcement).toMatch(/has_function_privilege\('service_role', 'public\.claim_scheduled_message\(uuid\)', 'EXECUTE'\)/);
  });

  it('keeps both rollbacks paused on the provenance-safe recovery seam', () => {
    expect(compatibilityRollback).toMatch(/unresolved provider reservations require owner reconciliation/);
    expect(compatibilityRollback).not.toMatch(/DROP COLUMN IF EXISTS delivery_attempt_id/);
    expect(compatibilityRollback).not.toMatch(/DROP TABLE IF EXISTS public\.scheduled_message_creation_provenance/);
    expect(compatibilityRollback).not.toMatch(/DROP FUNCTION IF EXISTS public\.claim_scheduled_message_v2/);
    expect(compatibilityRollback).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL)[^;]*scheduled_messages TO authenticated/i);
    expect(compatibilityRollback).toMatch(/REVOKE ALL ON TABLE public\.scheduled_messages[\s\S]*FROM PUBLIC, authenticated, anon, service_role;[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.scheduled_messages[\s\S]*TO service_role;/);
    expect(compatibilityRollback).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*public\.create_scheduled_message[\s\S]*public\.claim_scheduled_message_v2[\s\S]*public\.reconcile_scheduled_message_delivery\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role;/);
    expect(compatibilityRollback).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_scheduled_message\(p_id uuid\)[\s\S]*SECURITY INVOKER[\s\S]*RETURN false;/);
    expect(compatibilityRollback).not.toMatch(/UPDATE public\.scheduled_messages[\s\S]*SET claimed_at = now\(\)/);
    expect(compatibilityRollback).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_scheduled_message\(uuid\)[\s\S]*TO authenticated, service_role;/);
    expect(compatibilityRollback).toMatch(/paused ACL postcondition failed/);
    expect(enforcementRollback).not.toMatch(/CREATE POLICY allow_anon_read_scheduled_messages/);
    expect(enforcementRollback).not.toMatch(/CREATE POLICY allow_anon_insert_scheduled_messages/);
    expect(enforcementRollback).not.toMatch(/CREATE POLICY allow_authenticated_scheduled_messages/);
    expect(enforcementRollback).toMatch(/REVOKE ALL ON TABLE public\.scheduled_messages FROM PUBLIC, authenticated, anon, service_role;[\s\S]*GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.scheduled_messages TO service_role;/);
    expect(enforcementRollback).toMatch(/REVOKE ALL ON TABLE public\.scheduled_message_creation_provenance[\s\S]*GRANT SELECT ON TABLE public\.scheduled_message_creation_provenance TO service_role;/);
    expect(enforcementRollback).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_scheduled_message\(p_id uuid\)[\s\S]*SECURITY INVOKER[\s\S]*RETURN false;/);
    expect(enforcementRollback).not.toMatch(/UPDATE public\.scheduled_messages SET claimed_at = now\(\)/);
    expect(enforcementRollback).toMatch(/REVOKE ALL ON FUNCTION public\.claim_scheduled_message\(uuid\) FROM PUBLIC, anon, authenticated, service_role;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_scheduled_message\(uuid\)[\s\S]*TO authenticated, service_role;/);
    expect(enforcementRollback).toMatch(/safe compatibility ACL postcondition failed/);
    expect(isolatedProof).toMatch(/SAVEPOINT scheduled_full_rollback_chain[\s\S]*20260731220100_scheduled_message_delivery_enforcement\.rollback\.sql[\s\S]*20260731220000_scheduled_message_delivery_compatibility\.rollback\.sql[\s\S]*20260731213100_conversation_participant_policy_enforcement\.rollback\.sql[\s\S]*20260731213000_conversation_assignment_authority_containment\.rollback\.sql[\s\S]*20260731040338_conversation_unread_state_compatibility\.rollback\.sql[\s\S]*20260731040337_conversation_participant_scoping\.rollback\.sql/);
    expect(isolatedProof).toContain('full rollback chain blocks raw conversation reads');
    expect(isolatedProof).toContain('full rollback chain blocks unscoped inbox execution');
    expect(isolatedProof).toContain('full rollback chain blocks scheduled creation');
  });
});
