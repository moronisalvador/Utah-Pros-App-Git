/**
 * ════════════════════════════════════════════════
 * FILE: native-push-delivery-guardrails.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the focused Push preference, durable-claim, and stale-token cleanup
 *   boundary visible in credential-free CI.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  messaging foundation plus focused migration and rollback source
 *   Data:      reads → repository files; writes → none
 *
 * NOTES / GOTCHAS:
 *   - Runtime authorization and compare-and-delete behavior are separately
 *     qualified against the disposable local Supabase stack.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260728224000_native_push_delivery_guardrails.sql',
  'utf8',
);
const messagingFoundation = readFileSync(
  'supabase/migrations/20260723215926_messaging_transport_foundation.sql',
  'utf8',
);
const rollback = readFileSync(
  'supabase/rollbacks/20260728224000_native_push_delivery_guardrails.rollback.sql',
  'utf8',
);
const grants = (sql) => sql.match(/\bGRANT\b[^;]*;/gi) || [];
const source = (path) => readFileSync(path, 'utf8');

describe('native Push delivery guardrails migration', () => {
  it('preserves preference RPC signatures while denying cross-owner callers', () => {
    for (const name of [
      'get_effective_notification_prefs',
      'get_my_notification_prefs',
      'set_my_notification_pref',
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
    }
    expect(migration).toContain(
      'NOT public.is_current_native_push_preferences_employee(p_employee_id)',
    );
    expect(migration).not.toContain(
      'CREATE OR REPLACE FUNCTION public.is_current_active_internal_employee(',
    );
    expect(migration).toContain(
      "'NOT_AUTHORIZED: own notification preferences only'",
    );
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.notification_prefs',
    );
    expect(migration).toContain(
      'ALTER POLICY notification_prefs_all',
    );
    expect(migration).toContain(
      'USING (false)\n  WITH CHECK (false);',
    );
    expect(migration).not.toMatch(
      /DROP POLICY(?: IF EXISTS)? notification_prefs_all/i,
    );
  });

  it('keeps delivery claims private and service-role only', () => {
    expect(migration).toContain(
      'CREATE TABLE public.native_push_delivery_claims',
    );
    expect(migration).toContain(
      'ALTER TABLE public.native_push_delivery_claims\n  FORCE ROW LEVEL SECURITY;',
    );
    expect(migration).toContain(
      'CREATE POLICY native_push_delivery_claims_service_role',
    );
    expect(migration).toContain(
      'TO service_role\n  USING (true)\n  WITH CHECK (true);',
    );
    expect(migration).toContain(
      "IF current_user <> 'service_role' THEN",
    );
    expect(migration).toContain(
      'ON CONFLICT (delivery_key) DO NOTHING',
    );
    expect(migration).toContain('device_fingerprint uuid NOT NULL');
    expect(migration).not.toMatch(
      /device_token_id uuid NOT NULL\s+REFERENCES public\.device_tokens/,
    );
    expect(migration).toContain('RETURNS boolean');
    expect(migration).toContain(
      'CREATE INDEX native_push_delivery_claims_claimed_at_idx',
    );
    expect(migration).toContain(
      "existing_claim.claimed_at < now() - interval '90 days'",
    );
    expect(migration).toContain(
      "ORDER BY existing_claim.claimed_at\n    LIMIT 1000",
    );
    expect(migration).toContain(
      'public.claim_native_push_delivery(\n  uuid,\n  uuid,\n  uuid,\n  uuid',
    );
    const privateGrantStatements = grants(migration).filter((statement) =>
      /native_push_delivery_claims|claim_native_push_delivery|release_native_push_delivery_claim|prune_stale_native_device_token/i.test(statement));
    expect(privateGrantStatements.join('\n')).not.toMatch(
      /\bTO\s+(?:PUBLIC|anon|authenticated)\b/i,
    );
  });

  it('binds cleanup to the observed token version and Apple invalidation time', () => {
    expect(migration).toContain(
      'token_row.updated_at = p_observed_updated_at',
    );
    expect(migration).toContain(
      'token_row.updated_at <= p_invalidated_at',
    );
    expect(migration).toContain(
      'token_row.apns_environment = p_apns_environment',
    );
  });

  it('adds a real source-event occurrence before the trigger calls the worker', () => {
    expect(migration).toContain(
      "'notification_event_id',\n      gen_random_uuid()",
    );
    expect(migration).toContain(
      "'27d638e9e2681bf74f17fa255c7eaf04'",
    );
    expect(migration).toContain(
      'public.notify_emit(text,jsonb)',
    );
  });

  it('requires every direct production dispatcher to pass a durable occurrence id', () => {
    const expected = new Map([
      [
        'functions/lib/messaging-inbound-notifications.js',
        'notification_event_id: notificationEventId',
      ],
      ['functions/api/form-submit.js', 'notification_event_id: lead.id || null'],
      ['functions/api/callrail-webhook.js', 'notification_event_id: lead.id || null'],
      ['functions/api/feedback-notify.js', 'notification_event_id: feedbackId'],
      ['functions/api/feedback-resolved-notify.js', 'notification_event_id: feedbackId'],
      ['functions/api/inbound-meld.js', 'notification_event_id: m.meldNumber || null'],
      ['functions/lib/qbo-payment-sync.js', 'notification_event_id: paymentEventId || null'],
      ['functions/api/submit-esign.js', 'notification_event_id: jobDocumentId || null'],
      ['functions/api/ops-health.js', 'notification_event_id: dedupeKey'],
      [
        'functions/lib/message-notification-outbox.js',
        'notification_event_id: row.id',
      ],
    ]);

    for (const [path, contract] of expected) {
      expect(source(path), path).toContain(contract);
    }

    const notify = source('functions/api/notify.js');
    expect(notify).toContain("reason: 'missing_notification_event_id'");
    expect(notify).not.toContain('body?.title ||');

    const claimStart = messagingFoundation.indexOf(
      'CREATE OR REPLACE FUNCTION public.claim_message_notification_outbox(',
    );
    const claimEnd = messagingFoundation.indexOf(
      'COMMENT ON FUNCTION public.claim_message_notification_outbox(',
      claimStart,
    );
    const claimContract = messagingFoundation.slice(claimStart, claimEnd);
    expect(claimStart).toBeGreaterThan(-1);
    expect(claimEnd).toBeGreaterThan(claimStart);
    expect(claimContract).toContain('RETURNS TABLE (\n  id uuid,');
    expect(claimContract).not.toContain('provider_event_id');
  });

  it('guards the unsafe exact-contract rollback and disables delivery', () => {
    expect(rollback).toContain(
      'upr.allow_unsafe_native_push_delivery_rollback',
    );
    expect(rollback).toContain(
      'REVOKE EXECUTE ON FUNCTION public.claim_native_push_delivery',
    );
    expect(rollback).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.notification_prefs',
    );
    expect(rollback).toContain(
      "'26265649c566f96b9609665bdcb9b681'",
    );
    expect(rollback).toContain(
      "'74a2cde903e4065bf77a5ee7e91136d3'",
    );
    expect(rollback).toContain(
      "'ab61d17bdc3ee21db918ba630c84833d'",
    );
    expect(rollback).toContain(
      "'27d638e9e2681bf74f17fa255c7eaf04'",
    );
    expect(grants(rollback).join('\n')).not.toMatch(
      /\bTO\s+(?:PUBLIC|anon)\b/i,
    );
  });
});
