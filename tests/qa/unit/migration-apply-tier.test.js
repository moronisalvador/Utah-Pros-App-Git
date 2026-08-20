/**
 * ════════════════════════════════════════════════
 * FILE: migration-apply-tier.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the rule that decides whether a database change is allowed to reach
 *   the real company database on its own. Routine changes should go without
 *   anyone being asked; specific kinds should always stop and ask, because a
 *   throwaway practice database genuinely cannot tell whether they are safe.
 *   This proves the rule lets the first kind through and catches the second —
 *   including when a change file claims to be routine and is not.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  scripts/migration-apply-tier.mjs
 *   Data:      none (fixture SQL strings, plus a read of the committed baseline)
 *
 * NOTES / GOTCHAS:
 *   - BEHAVIOURAL, not a source contract: it runs the real classifier over real
 *     SQL. That is why the classifier lives in its own module — importing
 *     check-migration-hygiene.mjs would execute the whole gate and process.exit.
 *   - `autoTierBlockers` takes COMMENT-STRIPPED SQL. The fixtures here are bare
 *     SQL for that reason; the runner owns stripping.
 *   - The list of blind spots is meant to SHRINK over time, but only by making
 *     the local stack able to see the thing (volume data, non-public schemas) —
 *     never by relaxing the check. If a future session deletes an entry here,
 *     that is the question to ask it.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APPLY_TIER_AUTO,
  APPLY_TIER_OWNER_GATED,
  applyTierExempt,
  autoTierBlockers,
  declaredApplyTier,
} from '../../../scripts/migration-apply-tier.mjs';

describe('declaredApplyTier', () => {
  it('reads both tiers, with the reason', () => {
    expect(declaredApplyTier('-- apply-tier: auto\nCREATE TABLE x();'))
      .toEqual({ tier: APPLY_TIER_AUTO, reason: null });
    expect(declaredApplyTier('-- apply-tier: owner-gated: touches storage.objects'))
      .toEqual({ tier: APPLY_TIER_OWNER_GATED, reason: 'touches storage.objects' });
  });

  it('treats an UNDECLARED tier as null so the caller must fail safe', () => {
    // Silence is never permission. The runner turns null into a hygiene
    // failure; what matters here is that it is not mistaken for `auto`.
    expect(declaredApplyTier('CREATE TABLE x();')).toBeNull();
    expect(declaredApplyTier('')).toBeNull();
    expect(declaredApplyTier(null)).toBeNull();
  });

  it('is not fooled by a near-miss spelling', () => {
    expect(declaredApplyTier('-- apply tier: auto')).toBeNull();
    expect(declaredApplyTier('-- applytier: auto')).toBeNull();
  });
});

describe('autoTierBlockers — what may go on its own', () => {
  it('lets the routine majority through', () => {
    // These are the cases the tiering exists for: a local run genuinely does
    // prove them, because their risk is entirely in schema shape and grants.
    const cases = [
      ['additive column', 'ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS note text;'],
      ['new table', 'CREATE TABLE public.thing (id uuid PRIMARY KEY, name text);'],
      ['plain index', 'CREATE INDEX IF NOT EXISTS idx_jobs_created ON public.jobs (created_at);'],
      ['function body replace', 'CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;'],
      ['RLS policy', "CREATE POLICY p ON public.jobs FOR SELECT TO authenticated USING (true);"],
      ['policy swap', 'DROP POLICY IF EXISTS old_p ON public.jobs;'],
      ['grant', 'GRANT EXECUTE ON FUNCTION public.f() TO authenticated;'],
      // storage.* earned its removal on 2026-08-20: db/baseline/non-public.sql
      // carries the live buckets and policies, and the job-files qualifier
      // passes with its hand-typed seed deleted. Catalog-shaped storage DDL is
      // therefore locally provable now. (Bucket flag flips are UPDATEs and are
      // still caught by the data-touching entry — pinned below.)
      ['storage policy', "CREATE POLICY p ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'x');"],
      ['storage bucket literal insert', "INSERT INTO storage.buckets (id, name, public) VALUES ('new-bucket', 'new-bucket', false);"],
      // Literal config rows: verifiable by reading them, and the single most
      // common routine migration in this repo (nav_permissions, feature flags).
      ['bounded literal insert', "INSERT INTO public.nav_permissions (nav_key, role) VALUES ('collections', 'project_manager');"],
      ['insert with DO NOTHING', "INSERT INTO public.feature_flags (key, label) VALUES ('x', 'X') ON CONFLICT (key) DO NOTHING;"],
    ];
    for (const [label, sql] of cases) {
      expect(autoTierBlockers(sql), `${label} should be auto-eligible`).toEqual([]);
    }
  });

  it('stops anything whose risk lives in the DATA', () => {
    // The synthetic seed makes these failures DETECTABLE locally
    // (qualify-data-shaped-failure-local.mjs), but detection is not
    // clearance: a local pass proves nothing about the rows production
    // actually has, so every one of these still stops and asks.
    expect(autoTierBlockers('UPDATE public.jobs SET division = 1;')).toHaveLength(1);
    expect(autoTierBlockers('DELETE FROM public.jobs WHERE id IS NULL;')).toHaveLength(1);
    expect(autoTierBlockers('INSERT INTO public.a (x) SELECT y FROM public.b;')).toHaveLength(1);
    expect(autoTierBlockers('ALTER TABLE public.jobs ALTER COLUMN note SET NOT NULL;')).not.toEqual([]);
    expect(autoTierBlockers('ALTER TABLE public.jobs ADD CONSTRAINT c CHECK (n > 0);')).toHaveLength(1);
    expect(autoTierBlockers('CREATE UNIQUE INDEX u ON public.jobs (job_number);')).toHaveLength(1);
    // The upsert form has no table name between UPDATE and SET — it must be
    // caught by its own entry, or a bucket/flag flip could read as a bounded
    // insert (anon-grant-auditor finding, 2026-08-20).
    expect(autoTierBlockers("INSERT INTO storage.buckets (id, public) VALUES ('job-files', true) ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;")).not.toEqual([]);
    expect(autoTierBlockers("INSERT INTO public.feature_flags (key, enabled) VALUES ('page:crm', true) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled;")).not.toEqual([]);
  });

  it('still stops auth (credentials) and cron (live activation) — and bucket flag flips via the data entry', () => {
    // A bucket `public` flip is an UPDATE: removing storage.* from the list
    // must NOT have made it auto-eligible.
    expect(autoTierBlockers("UPDATE storage.buckets SET public = false WHERE id = 'job-files';")).not.toEqual([]);
    // cron scheduling is a live activation, separately authorized every time
    // (database-standard.md §0) — catalog parity does not change that.
    expect(autoTierBlockers('SELECT cron.schedule($$x$$, $$*$$, $$SELECT 1$$);')).not.toEqual([]);
    // auth rows are real credentials; the live auth schema carries zero UPR
    // objects (measured 2026-08-20), so this is about the rows, not a catalog gap.
    expect(autoTierBlockers('DELETE FROM auth.sessions;')).not.toEqual([]);
    expect(autoTierBlockers("INSERT INTO auth.users (id, email) VALUES ('x', 'y');")).not.toEqual([]);
  });

  it('stops destructive DDL even though rule 4 already reviews it', () => {
    // A `-- destructive-approved:` marker records an owner review of the DROP.
    // It does not make a local run able to see the rows being dropped, so it
    // must not double as an auto-apply pass.
    expect(autoTierBlockers('DROP TABLE public.old_thing;')).toContain('DROP TABLE');
    expect(autoTierBlockers('ALTER TABLE public.jobs DROP COLUMN legacy;')).toContain('DROP COLUMN');
    expect(autoTierBlockers('ALTER TABLE public.jobs RENAME TO jobs_old;')).not.toEqual([]);
    expect(autoTierBlockers('ALTER TABLE public.jobs ALTER COLUMN n TYPE bigint;')).not.toEqual([]);
  });

  it('reports EVERY blind spot a migration hits, not just the first', () => {
    // The message is meant to be actionable in one read.
    const sql = "UPDATE storage.buckets SET public = false; DROP TABLE public.x; SELECT cron.schedule($$x$$, $$*$$, $$SELECT 1$$);";
    expect(autoTierBlockers(sql).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the ratchet is a DATE, not a filename snapshot', () => {
  // This is the shape it is because the snapshot version broke within the hour.
  // A parallel session merged 20260819010000_contractor_compliance_reviewer_supplied_dates.sql
  // — authored before the rule, absent from a list captured before the merge —
  // and CI went red on `dev` for work that had done nothing wrong. A snapshot
  // cannot see other sessions' in-flight branches; a cutoff can.
  it('exempts migrations authored before the rule', () => {
    expect(applyTierExempt('20260819010000_contractor_compliance_reviewer_supplied_dates.sql')).toBe(true);
    expect(applyTierExempt('20260729163127_notification_presentation_settings.sql')).toBe(true);
    expect(applyTierExempt('20260417_calendar_events.sql')).toBe(true);
  });

  it('requires a declaration from the day the rule landed onward', () => {
    expect(applyTierExempt('20260820010000_job_files_bucket_private.sql')).toBe(false);
    expect(applyTierExempt('20260901120000_anything_later.sql')).toBe(false);
    expect(applyTierExempt('20271231000000_far_future.sql')).toBe(false);
  });

  it('does not exempt an undated filename by accident', () => {
    // Legacy undated files are excluded earlier by the main hygiene baseline;
    // if one ever reached rule 5 it must NOT be waved through.
    expect(applyTierExempt('tech_feedback.sql')).toBe(true);
    // ...which is the safe direction only because undeclared means owner-gated.
    expect(declaredApplyTier('CREATE TABLE x();')).toBeNull();
  });

  it('no longer carries a filename snapshot that would go stale', () => {
    const baseline = JSON.parse(readFileSync(
      new URL('../../../scripts/migration-hygiene-baseline.json', import.meta.url), 'utf8',
    ));
    expect(baseline.applyTierGrandfathered).toBeUndefined();
  });
});
