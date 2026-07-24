import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(fileURLToPath(new URL(
  '../migrations/20260724002500_callrail_event_recovery_scheduler.sql',
  import.meta.url,
)), 'utf8');
const rollback = readFileSync(fileURLToPath(new URL(
  '../rollbacks/20260724002500_callrail_event_recovery_scheduler.rollback.sql',
  import.meta.url,
)), 'utf8');

describe('CallRail event recovery scheduler migration', () => {
  it('seeds only a non-secret worker URL without replacing an owner value', () => {
    expect(migration).toContain("'callrail_event_recovery_worker_url'");
    expect(migration).toContain(
      "'https://dev.utahpros.app/api/process-callrail-events'",
    );
    expect(migration).toContain('ON CONFLICT (key) DO NOTHING');
    expect(migration).not.toMatch(/cron_worker_secret'\s*,\s*'[^']+'/);
  });

  it('fails closed unless the URL and existing cron secret are usable', () => {
    expect(migration).toContain(
      "'https://utahpros.app/api/process-callrail-events'",
    );
    expect(migration).toContain("WHERE key = 'cron_worker_secret'");
    expect(migration).toContain('v_worker_url IS NULL');
    expect(migration).toContain("NULLIF(btrim(v_secret), '') IS NULL");
  });

  it('dispatches only when recoverable CallRail SMS or MMS work exists', () => {
    expect(migration).toContain("e.provider = 'callrail'");
    expect(migration).toContain("e.message_type IN ('sms', 'mms')");
    expect(migration).toContain("e.processing_state = 'received'");
    expect(migration).toContain("e.processing_state = 'retryable'");
    expect(migration).toContain('e.next_attempt_at <= v_now');
    expect(migration).toContain("e.processing_state = 'claimed'");
    expect(migration).toContain("e.claimed_at < v_now - interval '5 minutes'");
  });

  it('uses the protected POST contract and a five-minute schedule', () => {
    expect(migration).toContain("'x-webhook-secret', v_secret");
    expect(migration).toContain("'upr_callrail_event_recovery'");
    expect(migration).toContain("'*/5 * * * *'");
    expect(migration).toContain("body := '{}'::jsonb");
  });

  it('does not grant the helper to browser or service roles', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.wake_callrail_event_recovery_worker\(\)[\s\S]+FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).not.toMatch(/\bGRANT\s+EXECUTE\b/i);
  });

  it('ships a rollback that preserves retained provider events', () => {
    expect(rollback).toContain("cron.unschedule('upr_callrail_event_recovery')");
    expect(rollback).toContain(
      'DROP FUNCTION IF EXISTS public.wake_callrail_event_recovery_worker()',
    );
    expect(rollback).not.toMatch(/DELETE FROM public\.integration_config/i);
    expect(rollback).not.toMatch(/DELETE FROM public\.message_provider_events/i);
  });
});
