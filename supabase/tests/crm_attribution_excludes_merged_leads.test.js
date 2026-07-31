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
 *   Internal:  functions/lib/supabase.js (branch-gated service client for
 *              disposable fixture writes), src/lib/supabase.js (REST client
 *              bound to the QA admin token for read/RPC assertions),
 *              ./helpers/qaFixtures.mjs (standing QA identity)
 *   Data:      reads  → get_attribution_rollup as the signed-in QA admin
 *              writes → inbound_leads through the branch-gated service client
 *              (two TEST-org referral-channel leads), best-effort deleted in
 *              afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the qa-staging Supabase branch; self-skips
 *     without branch creds like the other CRM suites.
 *   - Uses a before/after delta on the 'referral' channel (same deterministic
 *     channel choice as crm_pipeline_spam_filter.test.js), never an absolute
 *     count, so it remains stable when other QA fixtures exist.
 * ════════════════════════════════════════════════
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { supabase } from '../../functions/lib/supabase.js';
import { createSupabaseClient } from '../../src/lib/supabase.js';
import { signInFixture } from './helpers/qaFixtures.mjs';
import {
  QA_BRANCH_PROJECT_REF,
  QA_BRANCH_SENTINEL,
  assertQaBranchTarget,
} from '../../tests/qa/lib/target-policy.mjs';

const QA_CRM_ORG_ID = 'aaaaaaaa-0000-4000-8000-000000000203';
const env = globalThis.process?.env || {};
const url = env.SUPABASE_URL || '';
const anonKey = env.SUPABASE_ANON_KEY || '';
const serviceKeyName = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const serviceKey = env[serviceKeyName] || '';
const confirmed = env.UPR_QA_CONFIRMED_QA_BRANCH === QA_BRANCH_SENTINEL;
const projectRef = (() => {
  try { return new URL(url).hostname.split('.')[0]; } catch { return ''; }
})();
const hasCreds = !!(confirmed && anonKey && serviceKey && (() => {
  try {
    assertQaBranchTarget({ mode: 'qa-branch', projectRef, supabaseUrl: url });
    return true;
  } catch {
    return false;
  }
})());

if ((url || anonKey || serviceKey || confirmed) && !hasCreds) {
  throw new Error('CRM attribution integration test refused: exact qa-staging branch credentials are required; production is never a test target');
}

describe.skipIf(!hasCreds)('get_attribution_rollup excludes merged-duplicate leads (integration)', () => {
  const runId = Date.now();
  const orgId = QA_CRM_ORG_ID;
  const fixtureDb = hasCreds
    ? supabase({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey })
    : null;
  let adminDb;
  const leadIds = [];

  beforeAll(async () => {
    expect(projectRef).toBe(QA_BRANCH_PROJECT_REF);
    const admin = await signInFixture('admin');
    adminDb = createSupabaseClient(admin.token);
  });

  afterAll(async () => {
    if (fixtureDb) {
      for (const id of leadIds.slice().reverse()) {
        await fixtureDb.delete('inbound_leads', `id=eq.${id}`).catch(() => {});
      }
    }
  });

  it('denies a direct inbound_leads insert even to the signed-in QA admin', async () => {
    await expect(adminDb.insert('inbound_leads', {
      org_id: orgId,
      callrail_id: `qa-attribution-browser-denied-${runId}`,
      source_type: 'call',
      occurred_at: new Date().toISOString(),
      raw_payload: { qa: true },
    })).rejects.toMatchObject({ status: 403 });
  });

  it('a merged-into duplicate never adds to the leads count (before/after delta)', async () => {
    const rowsBefore = await adminDb.rpc('get_attribution_rollup', { p_org_id: orgId });
    const before = rowsBefore.find(r => r.channel === 'referral')?.leads || 0;

    // The original (real) lead.
    const [original] = await fixtureDb.insert('inbound_leads', {
      org_id: orgId, callrail_id: `qa-attribution-original-${runId}`, source: 'Referral', source_type: 'call',
      spam_flag: false, occurred_at: new Date().toISOString(), notes: `zz-merged-rollup-orig-${runId}`,
    });
    leadIds.push(original.id);

    // A repeat call already merged into the original — the shape the merge
    // system produces: its own row, non-spam, but merged_into_lead_id set.
    const [duplicate] = await fixtureDb.insert('inbound_leads', {
      org_id: orgId, callrail_id: `qa-attribution-duplicate-${runId}`, source: 'Referral', source_type: 'call',
      spam_flag: false, merged_into_lead_id: original.id,
      occurred_at: new Date().toISOString(), notes: `zz-merged-rollup-dup-${runId}`,
    });
    leadIds.push(duplicate.id);

    const rowsAfter = await adminDb.rpc('get_attribution_rollup', { p_org_id: orgId });
    const after = rowsAfter.find(r => r.channel === 'referral')?.leads || 0;

    // +1 (the original), never +2 — the merged duplicate never counts.
    expect(after - before).toBe(1);
  });

  it('get_attribution_rollup keeps its shape after the replace', async () => {
    const rows = await adminDb.rpc('get_attribution_rollup', {});
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
