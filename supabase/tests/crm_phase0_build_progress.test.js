/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase0_build_progress.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CRM build-progress tracker's database functions actually work
 *   against the real database, not just in theory. It creates a throwaway
 *   "phase" and "stage" row, marks them shipped/done through the real
 *   functions, checks the results, then deletes what it created.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_build_phases, crm_build_stages (via
 *                       get_crm_build_progress)
 *              writes → crm_build_phases, crm_build_stages (via insert, and
 *                       via set_crm_phase_status / set_crm_stage_status);
 *                       all test rows are deleted again in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - This is an INTEGRATION test against the live shared Supabase project
 *     (docs/crm-roadmap.md, "Testing, acceptance & review model" — a SQL RPC's
 *     behavior can't be verified as a pure unit test). It needs real
 *     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY credentials (see
 *     .env.example) to run.
 *   - CI's `npm test` step does not currently pass those secrets (only the
 *     Build step does — see .github/workflows/ci.yml), so this suite
 *     self-skips via `describe.skipIf` rather than failing CI red for a
 *     missing-credentials reason. Run it locally with a populated `.env` to
 *     exercise it for real; it was run for real (against the shared dev
 *     database) during CRM Phase 0 development to verify this behavior.
 *   - Uses a `phase_key` unique per run (`test-phase0-<timestamp>`) so
 *     concurrent runs never collide, and cleans up after itself — it never
 *     touches a real numbered phase row (0, 1, 2, 3, 4a-4d, 5).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 0 build-progress tracker (integration)', () => {
  const phaseKey = `test-phase0-${Date.now()}`;
  let stageId;

  beforeAll(async () => {
    await db.insert('crm_build_phases', { phase_key: phaseKey, title: 'Test phase (disposable)', sort_order: 999 });
    const [stage] = await db.insert('crm_build_stages', { phase_key: phaseKey, title: 'Test stage', sort_order: 0 });
    stageId = stage.id;
  });

  afterAll(async () => {
    await db.delete('crm_build_stages', `phase_key=eq.${phaseKey}`);
    await db.delete('crm_build_phases', `phase_key=eq.${phaseKey}`);
  });

  it('set_crm_phase_status stamps shipped_at when moved to shipped', async () => {
    const [before] = await db.select('crm_build_phases', `phase_key=eq.${phaseKey}&select=shipped_at`);
    expect(before.shipped_at).toBeNull();

    const after = await db.rpc('set_crm_phase_status', { p_phase_key: phaseKey, p_status: 'shipped' });
    expect(after.status).toBe('shipped');
    expect(after.shipped_at).not.toBeNull();
  });

  it('set_crm_stage_status marks a stage done', async () => {
    const updated = await db.rpc('set_crm_stage_status', { p_stage_id: stageId, p_status: 'done' });
    expect(updated.status).toBe('done');
  });

  it('get_crm_build_progress rolls up done/total stage counts for the phase', async () => {
    const progress = await db.rpc('get_crm_build_progress');
    const phase = progress.phases.find(p => p.phase_key === phaseKey);
    expect(phase).toBeTruthy();
    expect(phase.total_count).toBe(1);
    expect(phase.done_count).toBe(1);
    expect(phase.stages).toHaveLength(1);
    expect(phase.stages[0].status).toBe('done');
  });

  it('rejects an invalid phase status', async () => {
    await expect(
      db.rpc('set_crm_phase_status', { p_phase_key: phaseKey, p_status: 'bogus' })
    ).rejects.toThrow();
  });
});
