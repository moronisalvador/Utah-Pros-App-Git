import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(fileURLToPath(new URL(
  '../migrations/20260724001500_message_notification_outbox_scheduler.sql',
  import.meta.url,
)), 'utf8');
const rollback = readFileSync(fileURLToPath(new URL(
  '../rollbacks/20260724001500_message_notification_outbox_scheduler.rollback.sql',
  import.meta.url,
)), 'utf8');

describe('message notification outbox scheduler migration', () => {
  it('seeds only the non-secret worker URL without replacing an owner value', () => {
    expect(migration).toContain("'message_notification_outbox_worker_url'");
    expect(migration).toContain(
      "'https://dev.utahpros.app/api/process-message-notification-outbox'",
    );
    expect(migration).toContain('ON CONFLICT (key) DO NOTHING');
    expect(migration).not.toMatch(/cron_worker_secret'\s*,\s*'[^']+'/);
  });

  it('fails closed unless URL and existing cron secret are usable', () => {
    expect(migration).toContain(
      "'https://utahpros.app/api/process-message-notification-outbox'",
    );
    expect(migration).toContain("WHERE key = 'cron_worker_secret'");
    expect(migration).toContain('v_worker_url IS NULL');
    expect(migration).toContain("NULLIF(btrim(v_secret), '') IS NULL");
    expect(migration).toContain('RETURN NULL');
  });

  it('wakes only for due or stale outbox work', () => {
    expect(migration).toContain("o.delivery_state IN ('pending', 'retryable')");
    expect(migration).toContain('o.next_attempt_at <= v_now');
    expect(migration).toContain("o.delivery_state = 'processing'");
    expect(migration).toContain("o.claimed_at < v_now - interval '5 minutes'");
  });

  it('uses a statement trigger plus a five-minute safety net', () => {
    expect(migration).toContain(
      'CREATE TRIGGER message_notification_outbox_dispatch',
    );
    expect(migration).toMatch(
      /AFTER INSERT ON public\.message_notification_outbox\s+FOR EACH STATEMENT/,
    );
    expect(migration).toContain("'upr_message_notification_outbox'");
    expect(migration).toContain("'*/5 * * * *'");
  });

  it('contains trigger wake failures so inbound persistence still commits', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.trigger_message_notification_outbox_worker\(\)[\s\S]+BEGIN\s+PERFORM public\.wake_message_notification_outbox_worker\(\);\s+EXCEPTION WHEN OTHERS THEN[\s\S]+RETURN NULL;/,
    );
  });

  it('keeps the trigger helper unavailable to browser and service roles', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.wake_message_notification_outbox_worker\(\)[\s\S]+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.trigger_message_notification_outbox_worker\(\)[\s\S]+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).not.toMatch(/\bGRANT\s+EXECUTE\b/i);
  });

  it('ships a rollback that preserves durable notification jobs', () => {
    expect(rollback).toContain("cron.unschedule('upr_message_notification_outbox')");
    expect(rollback).toContain(
      'DROP TRIGGER IF EXISTS message_notification_outbox_dispatch',
    );
    expect(rollback).toContain(
      'DROP FUNCTION IF EXISTS public.trigger_message_notification_outbox_worker()',
    );
    expect(rollback).toContain(
      'DROP FUNCTION IF EXISTS public.wake_message_notification_outbox_worker()',
    );
    expect(rollback).not.toMatch(/DELETE FROM public\.integration_config/i);
    expect(rollback).not.toMatch(/DELETE FROM public\.message_notification_outbox/i);
  });
});
