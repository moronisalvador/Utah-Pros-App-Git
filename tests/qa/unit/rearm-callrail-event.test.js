/**
 * ════════════════════════════════════════════════
 * FILE: rearm-callrail-event.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the message-retry migration as text and checks it stayed narrow.
 *
 *   The danger with a "retry this failed message" tool is that it quietly turns
 *   into a "reset everything" tool. These checks pin the guard rails: one exact
 *   record at a time, only if it is in the exact error state you say it is,
 *   only CallRail text messages, only from the server, and never touching a
 *   message that is still being worked on.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260726230000_rearm_callrail_provider_event.sql
 *              + its rollback
 *   Data:      reads  → migration source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Proves INTENT, not EFFECT (close-out-standard.md step 2b). The behavioral
 *     proof is the sequenced drain during the apply window.
 *   - Assertions read comment-stripped SQL; the header quotes state names in
 *     prose and a whole-file match would pass on those.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIG = join(ROOT, 'supabase/migrations/20260726230000_rearm_callrail_provider_event.sql');
const RB = join(ROOT, 'supabase/rollbacks/20260726230000_rearm_callrail_provider_event.rollback.sql');

const code = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

describe('rearm_callrail_provider_event — stays a scalpel', () => {
  const sql = code(MIG);
  const where = sql.slice(sql.indexOf('where event.id = p_event_id'), sql.indexOf('returning event.*'));

  it('ships with a rollback', () => {
    expect(existsSync(MIG)).toBe(true);
    expect(existsSync(RB)).toBe(true);
  });

  it('is service-role only, and says so in the body not just the grant', () => {
    expect(sql).toContain("if auth.role() <> 'service_role' then");
    expect(sql).toContain('is service-role only');
  });

  it('grants EXECUTE to service_role alone — no browser role', () => {
    expect(sql).toContain('revoke execute on function public.rearm_callrail_provider_event(uuid, text, timestamptz) from public, anon, authenticated');
    const grant = sql.slice(sql.indexOf('grant execute on function public.rearm_callrail_provider_event'));
    const stmt = grant.slice(0, grant.indexOf(';'));
    expect(stmt).toContain('to service_role');
    expect(stmt).not.toContain('authenticated');
    expect(stmt).not.toContain('anon');
  });

  it('prefers SECURITY INVOKER over definer, per database-standard §1', () => {
    expect(sql).not.toContain('security definer');
    expect(sql).toContain("set search_path to ''");
  });

  it('targets ONE record — never a bulk reset', () => {
    expect(where).toContain('event.id = p_event_id');
    // A retry keyed only on state would sweep every failure at once.
    expect(where).toContain('event.error_code = p_expect_error_code');
  });

  it('refuses a blank expected error code rather than matching loosely', () => {
    expect(sql).toContain("p_expect_error_code is null or btrim(p_expect_error_code) = ''");
  });

  it('only touches terminally-failed CallRail text messages', () => {
    expect(where).toContain("event.provider = 'callrail'");
    expect(where).toContain("event.message_type in ('sms', 'mms')");
    expect(where).toContain("event.processing_state = 'failed'");
  });

  it('cannot disturb an in-flight message', () => {
    // Anything claimed / received / retryable must be out of reach: the WHERE
    // pins processing_state to 'failed' exactly, not a set or an inequality.
    expect(where).not.toContain("'claimed'");
    expect(where).not.toContain("'retryable'");
    expect(where).not.toContain('processing_state <>');
    expect(where).not.toContain('processing_state in');
  });

  it('re-queues cleanly: received, attempts zeroed, claim cleared', () => {
    expect(sql).toContain("processing_state = 'received'");
    expect(sql).toContain('processing_attempts = 0');
    expect(sql).toContain('next_attempt_at = null');
    expect(sql).toContain('claimed_at = null');
  });

  it('preserves the failure audit trail', () => {
    // Clearing these would make a repeat failure undiagnosable.
    const set = sql.slice(sql.indexOf('set processing_state'), sql.indexOf('where event.id'));
    expect(set).not.toContain('error_code = null');
    expect(set).not.toContain('error_message = null');
  });

  it('returns only the row it actually changed', () => {
    // An empty result is how the caller learns nothing matched, which is what
    // makes a sequenced one-at-a-time drain verifiable.
    expect(sql).toContain('returning event.*');
  });

  it('adds nothing but the function', () => {
    for (const forbidden of ['create table', 'alter table', 'drop table', 'create policy', 'drop policy']) {
      expect(sql).not.toContain(forbidden);
    }
  });
});

describe('rearm_callrail_provider_event — rollback', () => {
  it('drops the function and nothing else', () => {
    const rb = code(RB);
    expect(rb).toContain('drop function if exists public.rearm_callrail_provider_event(uuid, text, timestamptz)');
    expect(rb).not.toContain('delete from');
    expect(rb).not.toContain('update ');
  });
});
