/**
 * ════════════════════════════════════════════════
 * FILE: twilio-inbound-notification-parity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the inactive Twilio migration and worker source to prove the expected
 *   safety boundaries are present. It does not claim that a database changed.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  Twilio worker, migration, rollback, isolated SQL proof,
 *              notification outbox and presentation source
 *   Data:      reads  → repository files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - A green source contract is not hosted or local database behavior evidence.
 * ════════════════════════════════════════════════
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const MIGRATION =
  'supabase/migrations/20260729211728_twilio_inbound_notification_parity.sql';
const ROLLBACK =
  'supabase/rollbacks/20260729211728_twilio_inbound_notification_parity.rollback.sql';
const ISOLATED =
  'supabase/tests/twilio_inbound_notification_parity_isolated.sql';

describe('Twilio inbound notification parity migration source', () => {
  const sql = read(MIGRATION);

  it('adds only the inactive service-side projection and leaves CallRail untouched', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.project_twilio_inbound_event(',
    );
    expect(sql).not.toContain(
      'CREATE OR REPLACE FUNCTION public.project_callrail_inbound_event(',
    );
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+(TRIGGER|POLICY)\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\s+public\.integration_config\b/i);
  });

  it('pins service-role execution and revokes browser/public access before granting', () => {
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('SET search_path = pg_catalog, public');
    expect(sql).toContain("IF current_user <> 'service_role'");
    const revokeAt = sql.indexOf(
      'REVOKE ALL ON FUNCTION public.project_twilio_inbound_event',
    );
    const grantAt = sql.indexOf(
      'GRANT EXECUTE ON FUNCTION public.project_twilio_inbound_event',
    );
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
    expect(sql).toMatch(/FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/TO service_role/);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*(?:PUBLIC|anon|authenticated)/i);
  });

  it('shares CallRail per-phone serialization and MessageSid idempotency', () => {
    expect(sql).toContain(
      "pg_advisory_xact_lock(hashtextextended('messaging-phone:' || v_phone_key, 0))",
    );
    expect(sql).toContain("v_event.provider <> 'twilio'");
    expect(sql).toContain('twilio_sid');
    expect(sql).toContain('provider_message_id');
    expect(sql).toContain('ON CONFLICT DO NOTHING');
    expect(sql).toMatch(/m\.twilio_sid = v_event\.provider_message_id/);
  });

  it('keeps consent, canonical persistence, unread, and outbox in one transaction', () => {
    const lockAt = sql.indexOf('pg_advisory_xact_lock');
    const stopAt = sql.indexOf("IF v_keyword = 'stop'");
    const messageAt = sql.indexOf('INSERT INTO public.messages');
    const unreadAt = sql.indexOf('unread_count = c.unread_count + 1');
    const outboxAt = sql.indexOf('INSERT INTO public.message_notification_outbox');
    const processedAt = sql.lastIndexOf("processing_state = 'processed'");
    expect(lockAt).toBeGreaterThan(-1);
    expect(stopAt).toBeGreaterThan(lockAt);
    expect(messageAt).toBeGreaterThan(stopAt);
    expect(unreadAt).toBeGreaterThan(messageAt);
    expect(outboxAt).toBeGreaterThan(unreadAt);
    expect(processedAt).toBeGreaterThan(outboxAt);
    expect(sql).toContain('ON CONFLICT (provider_event_id) DO NOTHING');
  });

  it('requires private Twilio media and retains legacy provider identity', () => {
    expect(sql).toContain(
      "'^upr-storage://message-attachments/twilio/'",
    );
    expect(sql).toContain(
      'Twilio MMS must be copied to UPR-owned storage before projection',
    );
    expect(sql).toMatch(/'twilio',\s+v_event\.provider_message_id,\s+NULL,/);
  });

  it('preserves assigned-recipient/fallback and canonical deep-link payload facts', () => {
    expect(sql).toContain('SELECT c.assigned_to');
    expect(sql).toContain("'recipient_ids'");
    expect(sql).toContain("'link', '/conversations'");
    expect(sql).toContain("'conversation_id', v_conversation_id");
    expect(sql).toContain("'route', '/conversations'");
    expect(sql).toContain("'message.inbound'");
  });

  it('ships a concrete code-first rollback without deleting durable history', () => {
    const rollback = read(ROLLBACK);
    expect(rollback).toContain(
      'DROP FUNCTION IF EXISTS public.project_twilio_inbound_event(uuid, boolean)',
    );
    expect(rollback).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(rollback).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(rollback).toContain('Roll back compatible Worker code first');
  });

  it('ships rollback-only behavioral coverage for replay, consent, MMS, and audience', () => {
    const isolated = read(ISOLATED);
    expect(isolated).toContain('BEGIN;');
    expect(isolated).toContain('ROLLBACK;');
    expect(isolated).toContain('MessageSid replay duplicated a durable effect');
    expect(isolated).toContain('STOP did not win across duplicate phone contacts');
    expect(isolated).toContain('inbound_start_stale');
    expect(isolated).toContain('HELP/MMS projection drifted');
    expect(isolated).toContain('MMS did not retain only its private owned reference');
    expect(isolated).toContain('assigned SMS outbox payload drifted');
    expect(isolated).toContain('unassigned inbound did not retain office/admin fallback');
  });
});

describe('Twilio inbound Worker source boundary', () => {
  const worker = read('functions/api/twilio-webhook.js');
  const outbox = read('functions/lib/message-notification-outbox.js');
  const notify = read('functions/api/notify.js');

  it('retains first, projects atomically, and never directly dispatches message.inbound', () => {
    expect(worker).toContain("db.insert('message_provider_events'");
    expect(worker).toContain('processTwilioInboundEvent');
    expect(worker).not.toContain('notifyInboundMessage');
    expect(worker).not.toContain('dispatchEvent');
    expect(worker).not.toContain('waitUntil');
    expect(worker).not.toContain("db.insert('messages'");
    expect(worker).not.toContain('increment_conversation_unread');
  });

  it('uses exact signed form parameters and never persists Twilio MediaUrl values', () => {
    expect(worker).toContain('validateTwilioFormSignature');
    expect(worker).toContain('request.url');
    expect(worker).toContain('sameTwilioInboundEvent');
    expect(worker).toContain('ingestTwilioMms');
    expect(worker).not.toMatch(/media_urls:\s*event\.ephemeralMedia/i);
  });

  it('uses the outbox id as the stable native occurrence across retries', () => {
    expect(outbox).toContain('notification_event_id: row.id');
    expect(outbox).toContain('nativeRetryOnly');
  });

  it('derives exact office and field thread links from the canonical conversation id', () => {
    expect(notify).toContain('`?c=${encodeURIComponent(conversationId)}`');
    expect(notify).toContain('`/conversations${suffix}`');
    expect(notify).toContain('`/tech/conversations${suffix}`');
  });

  it('has no remaining direct notifier module or import', () => {
    expect(() => read('functions/lib/messaging-inbound-notifications.js')).toThrow();
    for (const path of [
      'functions/api/twilio-webhook.js',
      'functions/api/twilio-webhook.test.js',
    ]) {
      expect(read(path)).not.toContain('messaging-inbound-notifications');
    }
  });
});
