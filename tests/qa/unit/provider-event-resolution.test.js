/**
 * ════════════════════════════════════════════════
 * FILE: provider-event-resolution.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the "mark a failed message as seen" migration as text and checks it
 *   stayed additive and narrow.
 *
 *   The risk being guarded here is subtle: this feature exists to make a noisy
 *   alert quiet, so a sloppy version of it makes alerts quiet in cases where
 *   they should still be shouting. These checks pin that it can only silence a
 *   failure that has already happened and not been acknowledged, never one that
 *   is still being worked on.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260726240000_provider_event_resolution.sql
 *              + its rollback
 *   Data:      reads  → migration source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Proves INTENT, not EFFECT (close-out-standard.md step 2b).
 *   - The escalation behaviour is covered separately, as real unit tests, in
 *     functions/lib/ops-health.test.js — that logic is pure and needs no DB.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIG = join(ROOT, 'supabase/migrations/20260726240000_provider_event_resolution.sql');
const RB = join(ROOT, 'supabase/rollbacks/20260726240000_provider_event_resolution.rollback.sql');

const code = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

describe('provider event resolution — additive and narrow', () => {
  const sql = code(MIG);

  it('ships with a rollback', () => {
    expect(existsSync(MIG)).toBe(true);
    expect(existsSync(RB)).toBe(true);
  });

  it('adds columns without touching anything existing', () => {
    expect(sql).toContain('add column if not exists resolved_at timestamptz');
    expect(sql).toContain('add column if not exists resolved_by uuid');
    expect(sql).not.toContain('drop column');
    expect(sql).not.toContain('alter column');
    expect(sql).not.toContain('set not null');
  });

  it('indexes only the question the probe actually asks', () => {
    expect(sql).toContain('create index if not exists message_provider_events_unresolved_failures_idx');
    expect(sql).toContain("where processing_state = 'failed' and resolved_at is null");
  });

  it('the setter is service-role only', () => {
    expect(sql).toContain("if auth.role() <> 'service_role' then");
    expect(sql).toContain('revoke execute on function public.resolve_provider_event(uuid, uuid, timestamptz) from public, anon, authenticated');
    const grant = sql.slice(sql.indexOf('grant execute on function public.resolve_provider_event'));
    expect(grant.slice(0, grant.indexOf(';'))).toContain('to service_role');
  });

  it('prefers SECURITY INVOKER, per database-standard §1', () => {
    expect(sql).not.toContain('security definer');
    expect(sql).toContain("set search_path to ''");
  });

  it('can only silence an ALREADY-FAILED, not-yet-acknowledged event', () => {
    const where = sql.slice(sql.indexOf('where event.id = p_event_id'), sql.indexOf('returning event.*'));
    expect(where).toContain("event.processing_state = 'failed'");
    expect(where).toContain('event.resolved_at is null');
    // Nothing in flight may be silenced.
    expect(where).not.toContain("'claimed'");
    expect(where).not.toContain("'retryable'");
    expect(where).not.toContain("'received'");
  });

  it('is idempotent and reports what it changed', () => {
    // resolved_at IS NULL in the predicate makes a second call a no-op, and the
    // empty return is how the caller knows.
    expect(sql).toContain('returning event.*');
  });

  it('does not change the message state itself', () => {
    // Acknowledging is not the same as fixing: the failure stays failed, with
    // its error_code intact, so history and diagnosis survive.
    const set = sql.slice(sql.indexOf('set resolved_at'), sql.indexOf('where event.id'));
    expect(set).not.toContain('processing_state');
    expect(set).not.toContain('error_code');
  });
});

describe('provider event resolution — rollback', () => {
  const rb = code(RB);

  it('drops in dependency order: function, index, then columns', () => {
    const fn = rb.indexOf('drop function if exists public.resolve_provider_event');
    const idx = rb.indexOf('drop index if exists');
    const col = rb.indexOf('drop column if exists resolved_at');
    expect(fn).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(fn);
    expect(col).toBeGreaterThan(idx);
  });

  it('touches no message data', () => {
    expect(rb).not.toContain('delete from');
    expect(rb).not.toContain('update public.message_provider_events set');
  });
});
