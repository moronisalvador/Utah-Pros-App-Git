import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../../supabase/migrations/20260724051500_claim_callrail_provider_event.sql',
    import.meta.url,
  ),
  'utf8',
);
const rollback = readFileSync(
  new URL(
    '../../supabase/rollbacks/20260724051500_claim_callrail_provider_event.rollback.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('CallRail provider-event atomic claim migration', () => {
  it('returns only a successfully fenced due claim', () => {
    expect(migration).toContain('RETURNS SETOF public.message_provider_events');
    expect(migration).toContain('RETURN QUERY');
    expect(migration).toContain("event.provider = 'callrail'");
    expect(migration).toContain("event.message_type IN ('sms', 'mms')");
    expect(migration).toContain("event.processing_state = 'received'");
    expect(migration).toContain('event.next_attempt_at <= p_now');
    expect(migration).toContain('event.claimed_at < p_stale_before');
    expect(migration).toContain('RETURNING event.*');
  });

  it('is invoker-mode and callable only by service_role', () => {
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain(
      ') FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(migration).toContain(') TO service_role;');
  });

  it('has an explicit rollback for the additive RPC', () => {
    expect(rollback).toContain(
      'DROP FUNCTION public.claim_callrail_provider_event(',
    );
  });
});
