/**
 * ════════════════════════════════════════════════
 * FILE: migration-apply-tier.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the rule that decides whether a database change is allowed to reach
 *   the real company database on its own. Routine changes should go without
 *   anyone being asked; three specific kinds should always stop and ask,
 *   because the throwaway practice database genuinely cannot tell whether they
 *   are safe. This proves the rule lets the first kind through and catches the
 *   second — including when a change file claims to be routine and is not.
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
      // Literal config rows: verifiable by reading them, and the single most
      // common routine migration in this repo (nav_permissions, feature flags).
      ['bounded literal insert', "INSERT INTO public.nav_permissions (nav_key, role) VALUES ('collections', 'project_manager');"],
    ];
    for (const [label, sql] of cases) {
      expect(autoTierBlockers(sql), `${label} should be auto-eligible`).toEqual([]);
    }
  });

  it('stops anything whose risk lives in the DATA', () => {
    // The baseline has ZERO rows, so each of these passes locally in
    // milliseconds and proves nothing about 100k real rows.
    expect(autoTierBlockers('UPDATE public.jobs SET division = 1;')).toHaveLength(1);
    expect(autoTierBlockers('DELETE FROM public.jobs WHERE id IS NULL;')).toHaveLength(1);
    expect(autoTierBlockers('INSERT INTO public.a (x) SELECT y FROM public.b;')).toHaveLength(1);
    expect(autoTierBlockers('ALTER TABLE public.jobs ALTER COLUMN note SET NOT NULL;')).not.toEqual([]);
    expect(autoTierBlockers('ALTER TABLE public.jobs ADD CONSTRAINT c CHECK (n > 0);')).toHaveLength(1);
    expect(autoTierBlockers('CREATE UNIQUE INDEX u ON public.jobs (job_number);')).toHaveLength(1);
  });

  it('stops anything outside the public schema, which the baseline does not contain', () => {
    expect(autoTierBlockers("UPDATE storage.buckets SET public = false WHERE id = 'job-files';")).not.toEqual([]);
    expect(autoTierBlockers("CREATE POLICY p ON storage.objects FOR SELECT TO authenticated USING (true);")).not.toEqual([]);
    expect(autoTierBlockers('SELECT cron.schedule($$x$$, $$*$$, $$SELECT 1$$);')).not.toEqual([]);
    expect(autoTierBlockers('DELETE FROM auth.sessions;')).not.toEqual([]);
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
    const sql = "UPDATE storage.buckets SET public = false; DROP TABLE public.x;";
    expect(autoTierBlockers(sql).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the ratchet', () => {
  it('grandfathers only migrations that predate the rule, and never grows', () => {
    // Pre-2026-08-20 migrations carry no marker and are therefore owner-gated
    // by default — the safe direction. Adding to this list would let a NEW
    // migration skip the declaration entirely, which is the one move that
    // defeats the whole mechanism.
    const baseline = JSON.parse(readFileSync(
      new URL('../../../scripts/migration-hygiene-baseline.json', import.meta.url), 'utf8',
    ));
    expect(baseline.applyTierGrandfathered).toHaveLength(66);
    expect(baseline.applyTierGrandfathered)
      .not.toContain('20260820010000_job_files_bucket_private.sql');
    for (const name of baseline.applyTierGrandfathered) {
      expect(name < '20260820', `${name} postdates the rule and must declare its own tier`).toBe(true);
    }
  });
});
