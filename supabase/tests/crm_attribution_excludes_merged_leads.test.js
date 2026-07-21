/**
 * ════════════════════════════════════════════════
 * FILE: crm_attribution_excludes_merged_leads.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves get_attribution_rollup's leads count excludes REPEAT-CALL
 *   duplicates the same way the Kanban board already does. When a caller
 *   phones twice while their first lead is still open, the merge system
 *   (crm_merge_repeat_call_leads) keeps the second call as its own
 *   inbound_leads row for history but sets merged_into_lead_id so it never
 *   gets its own pipeline card — the board query already filters
 *   merged_into_lead_id=is.null, but get_attribution_rollup's leads_agg had
 *   not, so the headline "Leads" count silently double-counted these. This
 *   test proves a merged duplicate no longer moves the count.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs (via RPC's own org lookup)
 *              writes → inbound_leads (two TEST-org referral-channel leads),
 *              best-effort deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - Uses a before/after delta on the 'referral' channel (same deterministic
 *     channel choice as crm_pipeline_spam_filter.test.js), never an absolute
 *     count, so it is safe to run against live production data.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('get_attribution_rollup excludes merged-duplicate leads (integration)', () => {
  const runId = Date.now();
  let orgId;
  const leadIds = [];

  afterAll(async () => {
    for (const id of leadIds) await db.delete('inbound_leads', `id=eq.${id}`);
  });

  it('a merged-into duplicate never adds to the leads count (before/after delta)', async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    const rowsBefore = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const before = rowsBefore.find(r => r.channel === 'referral')?.leads || 0;

    // The original (real) lead.
    const [original] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Referral', source_type: 'call',
      spam_flag: false, occurred_at: new Date().toISOString(), notes: `zz-merged-rollup-orig-${runId}`,
    });
    leadIds.push(original.id);

    // A repeat call already merged into the original — the shape the merge
    // system produces: its own row, non-spam, but merged_into_lead_id set.
    const [duplicate] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Referral', source_type: 'call',
      spam_flag: false, merged_into_lead_id: original.id,
      occurred_at: new Date().toISOString(), notes: `zz-merged-rollup-dup-${runId}`,
    });
    leadIds.push(duplicate.id);

    const rowsAfter = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const after = rowsAfter.find(r => r.channel === 'referral')?.leads || 0;

    // +1 (the original), never +2 — the merged duplicate never counts.
    expect(after - before).toBe(1);
  });

  it('get_attribution_rollup keeps its shape after the replace', async () => {
    const rows = await db.rpc('get_attribution_rollup', {});
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r).toHaveProperty('channel');
      expect(r).toHaveProperty('leads');
      expect(r).toHaveProperty('spend');
      expect(r).toHaveProperty('estimates');
      expect(r).toHaveProperty('won_jobs');
      expect(r).toHaveProperty('revenue');
    }
  });
});
