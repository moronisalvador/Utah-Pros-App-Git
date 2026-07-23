import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migrationPath = fileURLToPath(new URL(
  '../migrations/20260723215926_messaging_transport_foundation.sql',
  import.meta.url,
));
const migration = readFileSync(migrationPath, 'utf8');
const followupMigration = readFileSync(fileURLToPath(new URL(
  '../migrations/20260723220207_messaging_transport_foundation_indexes.sql',
  import.meta.url,
)), 'utf8');
const activeSql = migration.split('-- OPERATIONAL ROLLBACK (owner-approved; no schema or ACL reversal)')[0];
const activeStatements = activeSql.split(';').map((statement) => statement.trim());

describe('messaging transport foundation migration contract', () => {
  it('declares the full existing-schema dependency and apply-preflight contract', () => {
    for (const dependency of [
      'public.messages',
      'public.conversations',
      'public.contacts',
      'public.conversation_participants',
      'public.employees',
      'public.employee_page_access',
      'public.feature_flags',
      'public.nav_permissions',
      'public.sms_consent_log',
    ]) {
      expect(migration).toContain(dependency);
    }
    expect(migration).toContain('gen_random_uuid()');
    expect(migration).toContain(
      'docs/audit/2026-07/evidence/messaging-transport-2026-07-23.md',
    );
  });

  it('is additive and creates generic identity and durable ledgers', () => {
    expect(activeSql).toContain('ADD COLUMN IF NOT EXISTS provider text');
    expect(activeSql).toContain('ADD COLUMN IF NOT EXISTS client_request_id uuid');
    expect(activeSql).toContain('CREATE TABLE public.message_send_attempts');
    expect(activeSql).toContain('CREATE TABLE public.message_provider_events');
    expect(activeSql).toContain('CREATE TABLE public.message_notification_outbox');
    expect(activeSql).toContain('parent_attempt_id uuid REFERENCES public.message_send_attempts');
    expect(activeSql).toContain('canonical_body text');
    expect(activeSql).toContain("media_urls jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(activeSql).toContain('message_send_attempts_parent_recipient_key');
    expect(activeSql).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_message_recipient_attempt(',
    );
    expect(activeSql).toContain("AND state = 'prepared'");
    expect(activeSql).toContain('RETURN FOUND');
    expect(activeSql).toContain('processing_attempts integer NOT NULL DEFAULT 0');
    expect(activeSql).toContain('next_attempt_at timestamptz');
    expect(activeSql).toContain('submitted_body text');
    expect(activeSql).toContain("requested_channel text NOT NULL DEFAULT 'sms'");
    expect(activeSql).toContain('actual_channel text');
    expect(activeSql).toContain('channel_fallback_reason text');
    expect(activeSql).toContain('provider_status text');
    expect(activeSql).toContain(
      "CHECK (requested_channel IN ('sms', 'mms', 'rcs'))",
    );
    expect(activeSql).toContain(
      "CHECK (actual_channel IS NULL OR actual_channel IN ('sms', 'mms', 'rcs'))",
    );
    expect(activeSql).toContain(
      "message_type IS NULL OR message_type IN ('sms', 'mms', 'rcs')",
    );
    expect(activeSql).toContain('content text');
    expect(activeSql).toContain('media_count integer NOT NULL DEFAULT 0');
    expect(activeSql).toContain("owned_media jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(activeSql).toContain("CHECK (jsonb_typeof(owned_media) = 'array')");
    expect(activeSql).toContain('message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL');
    expect(activeSql).toContain('contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL');
    expect(activeSql).toContain('conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL');
    expect(activeSql).toContain('ADD COLUMN IF NOT EXISTS provider_event_id uuid');
    expect(activeSql).toContain('sms_consent_log_provider_event_action_key');
    expect(activeSql).toContain('message_send_attempts_conversation_idx');
    expect(activeSql).toContain('message_send_attempts_actor_employee_idx');
    expect(followupMigration).toContain('message_notification_outbox_contact_idx');
    expect(followupMigration).toContain('message_notification_outbox_conversation_idx');
  });

  it('keeps new ledgers service-only with RLS and explicit grants', () => {
    expect(activeSql).toContain('ALTER TABLE public.message_send_attempts ENABLE ROW LEVEL SECURITY');
    expect(activeSql).toContain('ALTER TABLE public.message_provider_events ENABLE ROW LEVEL SECURITY');
    expect(activeSql).toContain('ALTER TABLE public.message_notification_outbox ENABLE ROW LEVEL SECURITY');
    expect(activeSql).toContain('REVOKE ALL ON TABLE public.message_send_attempts FROM PUBLIC, anon, authenticated');
    expect(activeSql).toContain('REVOKE ALL ON TABLE public.message_provider_events FROM PUBLIC, anon, authenticated');
    expect(activeSql).toContain('REVOKE ALL ON TABLE public.message_notification_outbox FROM PUBLIC, anon, authenticated');
    expect(activeSql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]+TO service_role;/);
    const browserLedgerGrant = activeStatements.find((statement) => (
      /^GRANT\b/i.test(statement)
      && /message_(?:send_attempts|provider_events)/i.test(statement)
      && /\bTO\s+(?:PUBLIC|anon|authenticated)\b/i.test(statement)
    ));
    expect(browserLedgerGrant).toBeUndefined();
  });

  it('enforces worker-only message writes while retaining authenticated reads', () => {
    expect(activeSql).toContain('REVOKE ALL ON TABLE public.messages FROM anon');
    expect(activeSql).toContain('REVOKE ALL ON TABLE public.messages FROM authenticated');
    expect(activeSql).toContain('GRANT SELECT ON TABLE public.messages TO authenticated');
    expect(activeSql).toMatch(/CREATE POLICY messages_authenticated_select[\s\S]+FOR SELECT[\s\S]+TO authenticated/);
    expect(activeSql).toContain('USING (public.messaging_can_access_conversations())');
    expect(activeSql).toContain('COALESCE(is_external, false) = false');
    expect(activeSql).toContain('np.role = actor.role::text');
    expect(activeSql).toContain('REVOKE ALL ON FUNCTION public.messaging_can_access_conversations() FROM PUBLIC, anon');
  });

  it('uses code-disable rollback, retains additive history, and never restores browser writes', () => {
    const rollback = migration.slice(activeSql.length);
    expect(rollback).toContain('MESSAGING_SEND_MODE=disabled');
    expect(rollback).toContain('Leave the additive columns, ledgers, indexes, RPCs');
    expect(rollback).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|FUNCTION|POLICY|INDEX)\b/i);
    expect(rollback).not.toMatch(/\bGRANT\s+(?:ALL|INSERT|UPDATE|DELETE)\b[\s\S]*\bTO\s+(?:anon|authenticated)\b/i);
    expect(activeSql).not.toMatch(/MESSAGING_SEND_MODE|CALLRAIL_API_KEY|TWILIO_AUTH_TOKEN/);
  });

  it('projects one durable CallRail inbound event atomically and service-role-only', () => {
    expect(activeSql).toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_inbound_event(',
    );
    expect(activeSql).toMatch(
      /project_callrail_inbound_event\([\s\S]+p_event_id uuid,[\s\S]+p_consent_only boolean DEFAULT false[\s\S]+\)[\s\S]+SECURITY INVOKER/,
    );
    expect(activeSql).toContain('FOR UPDATE');
    expect(activeSql).toContain('pg_advisory_xact_lock');
    expect(activeSql).toContain("current_user <> 'service_role'");
    expect(activeSql).toContain(
      'REVOKE ALL ON FUNCTION public.project_callrail_inbound_event(uuid, boolean)',
    );
    expect(activeSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.project_callrail_inbound_event\(uuid, boolean\)[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(activeSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.project_callrail_inbound_event\(uuid, boolean\)[\s\S]+TO service_role/,
    );
    expect(activeSql).toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_reconcile_outcome(',
    );
    expect(activeSql).toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_outbound_event(',
    );
    expect(activeSql).toContain(
      'CREATE OR REPLACE FUNCTION public.materialize_message_send_attempt(',
    );
    expect(activeSql).toMatch(
      /project_callrail_reconcile_outcome\([\s\S]+SECURITY INVOKER/,
    );
    expect(activeSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.project_callrail_reconcile_outcome\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(activeSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.project_callrail_reconcile_outcome\([\s\S]+TO service_role/,
    );
  });

  it('atomically enqueues and leases durable inbound notifications', () => {
    expect(activeSql).toContain('INSERT INTO public.message_notification_outbox');
    expect(activeSql).toContain('ON CONFLICT (provider_event_id) DO NOTHING');
    expect(activeSql).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_message_notification_outbox(',
    );
    expect(activeSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(activeSql).toContain("delivery_state = 'processing'");
    expect(activeSql).toContain('claim_token = p_claim_token');
    expect(activeSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.claim_message_notification_outbox\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
  });

  it('materializes accepted provider outcomes without a second provider submission', () => {
    expect(activeSql).toContain('Existing message conflicts with provider attempt identity');
    expect(activeSql).toContain('Cross-channel fallback cannot be materialized');
    expect(activeSql).toContain("'message_materialized'::text");
    expect(activeSql).toContain("'message_already_materialized'::text");
    expect(activeSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.materialize_message_send_attempt\(uuid\)[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
  });

  it('makes consent replay-safe and prevents a stale START from undoing STOP', () => {
    expect(activeSql).toContain(
      'ON CONFLICT (provider_event_id, contact_id, event_type)',
    );
    expect(activeSql).toContain("scl.event_type = 'stop_keyword'");
    expect(activeSql).toContain('stop_event.occurred_at >= v_event.occurred_at');
    expect(activeSql).toContain("WHEN v_keyword = 'start' AND v_start_stale");
    expect(activeSql).toContain("'inbound_start_stale'");
  });

  it('classifies consent keywords before unknown-contact consent creation', () => {
    const classify = activeSql.indexOf('v_keyword := CASE');
    const contactInsert = activeSql.indexOf('INSERT INTO public.contacts', classify);
    const impliedConsent = activeSql.indexOf('IF v_keyword IS NULL THEN', contactInsert);
    expect(classify).toBeGreaterThan(-1);
    expect(contactInsert).toBeGreaterThan(classify);
    expect(impliedConsent).toBeGreaterThan(contactInsert);
    expect(activeSql).toContain("v_keyword IN ('start') OR v_keyword IS NULL");
    expect(activeSql).toContain("CASE WHEN v_keyword = 'stop' THEN 'stop_keyword' ELSE NULL END");
    expect(activeSql).toContain("COALESCE(v_keyword = 'stop', false)");
  });

  it('persists provider status only when it agrees with confirmed', () => {
    expect(activeSql).toContain(
      "v_provider_status NOT IN ('sent', 'failed', 'error')",
    );
    expect(activeSql).toContain(
      "p_confirmed IS DISTINCT FROM (v_provider_status = 'sent')",
    );
    expect(activeSql).toMatch(
      /INSERT INTO public\.message_provider_events \([\s\S]+provider_status,[\s\S]+v_provider_status,/,
    );
  });

  it('allows a terminal failed reconciliation without fabricating a canonical row', () => {
    expect(activeSql).toContain('IF v_message_id IS NOT NULL THEN');
    expect(activeSql).toMatch(
      /IF v_message_id IS NOT NULL THEN[\s\S]+UPDATE public\.messages[\s\S]+IF NOT FOUND THEN/,
    );
  });

  it('updates unread and preview only when provider-message insertion wins', () => {
    const insertion = activeSql.indexOf('ON CONFLICT (provider, provider_message_id)');
    const insertionWon = activeSql.indexOf('IF NOT v_inserted THEN', insertion);
    const conversationUpdate = activeSql.indexOf('UPDATE public.conversations c', insertionWon);
    expect(insertion).toBeGreaterThan(-1);
    expect(insertionWon).toBeGreaterThan(insertion);
    expect(conversationUpdate).toBeGreaterThan(insertionWon);
    expect(activeSql).toContain('unread_count = c.unread_count + 1');
    expect(activeSql).toContain('v_event.occurred_at >= c.last_message_at');
  });
});
