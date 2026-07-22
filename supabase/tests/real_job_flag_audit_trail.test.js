/**
 * ════════════════════════════════════════════════
 * FILE: real_job_flag_audit_trail.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the new audit trail for the company's canonical sale flag
 *   (jobs.is_real_job). Three things must be true after the
 *   20260722_real_job_flag_audit_trail migration: (a) promoting a job to
 *   "real" through set_job_real_job writes a history row recording the
 *   before/after values; (b) DEMOTING a job through set_job_real_job no
 *   longer destroys the evidence — real_job_source and real_job_marked_at
 *   survive on the job row (the old body overwrote them with
 *   'manual'/now(), which is how a 2026-07-03 bulk demotion silently
 *   erased what originally proved 13 sales) — and the demotion itself
 *   lands in history; (c) even a RAW database update that flips
 *   is_real_job (bypassing every function) still lands in history,
 *   because a trigger on the jobs table — not the RPC — is what writes it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → jobs, job_real_flag_history
 *              writes → jobs (one throwaway TEST fixture row via insert +
 *                       set_job_real_job RPC + a direct update); deleted in
 *                       afterAll — job_real_flag_history rows cascade away
 *                       with the job (ON DELETE CASCADE), no separate
 *                       history cleanup needed.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the other CRM integration suites.
 *   - History assertions are scoped to THIS run's fixture job_id (run-unique
 *     insured_name + fresh uuid), never absolute table counts — safe against
 *     live data and concurrent runs.
 *   - The fixture job is inserted with is_real_job=false, so the INSERT
 *     trigger (which only fires when a job is born already-real) writes
 *     nothing — history starts empty for this job, making the per-step
 *     deltas exact.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('real-job flag audit trail (integration)', () => {
  const runId = Date.now();
  const jobIds = [];
  let jobId;
  let promotedSource;
  let promotedMarkedAt;

  const historyFor = (id) =>
    db.select('job_real_flag_history', `job_id=eq.${id}&order=changed_at.asc,id.asc`);

  beforeAll(async () => {
    const [job] = await db.insert('jobs', {
      insured_name: `zz-real-flag-audit-${runId}`,
      phase: 'job_received',
      status: 'active',
      is_real_job: false, // born not-sold → no INSERT-trigger history row
    });
    jobId = job.id;
    jobIds.push(job.id);
  });

  afterAll(async () => {
    // History rows cascade with the job (ON DELETE CASCADE).
    if (jobIds.length) await db.delete('jobs', `id=in.(${jobIds.join(',')})`);
  });

  it('(a) promote via set_job_real_job writes a history row with old/new values', async () => {
    const before = await historyFor(jobId);
    expect(before).toHaveLength(0); // inserted false → nothing recorded yet

    const promoted = await db.rpc('set_job_real_job', {
      p_job_id: jobId,
      p_is_real: true,
      p_actor: null,
    });
    expect(promoted.is_real_job).toBe(true);
    expect(promoted.real_job_source).toBe('manual');
    expect(promoted.real_job_marked_at).toBeTruthy();
    promotedSource = promoted.real_job_source;
    promotedMarkedAt = promoted.real_job_marked_at;

    const after = await historyFor(jobId);
    expect(after).toHaveLength(before.length + 1);
    const row = after[after.length - 1];
    expect(row.old_is_real).toBe(false);
    expect(row.new_is_real).toBe(true);
    expect(row.old_source).toBeNull();
    expect(row.new_source).toBe('manual');
    expect(row.old_marked_at).toBeNull();
    expect(row.new_marked_at).toBeTruthy();
    expect(row.changed_at).toBeTruthy();
  });

  it('(b) demote PRESERVES real_job_source/marked_at on the job and writes a history row', async () => {
    const before = await historyFor(jobId);

    const demoted = await db.rpc('set_job_real_job', {
      p_job_id: jobId,
      p_is_real: false,
      p_actor: null,
    });

    // The whole point of the fix: the flag flips, the evidence survives.
    expect(demoted.is_real_job).toBe(false);
    expect(demoted.real_job_source).toBe(promotedSource);
    expect(new Date(demoted.real_job_marked_at).getTime())
      .toBe(new Date(promotedMarkedAt).getTime());

    const after = await historyFor(jobId);
    expect(after).toHaveLength(before.length + 1);
    const row = after[after.length - 1];
    expect(row.old_is_real).toBe(true);
    expect(row.new_is_real).toBe(false);
    // Source/marked_at unchanged across the demotion — old === new.
    expect(row.old_source).toBe('manual');
    expect(row.new_source).toBe('manual');
    expect(new Date(row.old_marked_at).getTime())
      .toBe(new Date(row.new_marked_at).getTime());
  });

  it('(c) a direct db.update flipping is_real_job (no function at all) also lands in history', async () => {
    const before = await historyFor(jobId);

    // The raw-write pattern that produced the untracked true/NULL/NULL jobs.
    await db.update('jobs', `id=eq.${jobId}`, { is_real_job: true });

    const after = await historyFor(jobId);
    expect(after).toHaveLength(before.length + 1);
    const row = after[after.length - 1];
    expect(row.old_is_real).toBe(false);
    expect(row.new_is_real).toBe(true);
    // Nothing else was touched by the raw write — source carried through.
    expect(row.old_source).toBe('manual');
    expect(row.new_source).toBe('manual');
  });
});
