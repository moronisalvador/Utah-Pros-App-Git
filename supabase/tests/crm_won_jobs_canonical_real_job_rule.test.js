/**
 * ════════════════════════════════════════════════
 * FILE: crm_won_jobs_canonical_real_job_rule.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks in THE canonical company-wide rule for what counts as a sale, so
 *   the CRM can never drift away from it again. UPR-Web-Context.md states it
 *   plainly ("What counts as a SALE / REAL JOB (THE canonical rule — all
 *   reporting must use this)"): a job is a real sale when
 *   `jobs.is_real_job = true`, and it says "never reinvent it". The CRM's
 *   five reporting RPCs had reinvented it anyway as `phase <> 'lead'`, which
 *   counts `job_received` — the phase a job enters the moment work is booked,
 *   INCLUDING a free inspection. Verified live 2026-07-22: a 7-day window
 *   reported 12 "won jobs", every one of them `job_received` with null/$0
 *   invoiced value; the honest number was 1.
 *
 *   These tests create a job that is deliberately NOT a real sale (a booked
 *   inspection: phase='job_received', is_real_job=false) and assert it does
 *   NOT move the won-jobs count, then flip ONLY `is_real_job` to true and
 *   assert it now does. That is the whole rule, pinned.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs, jobs (via the RPCs' own lookups)
 *              writes → contacts, inbound_leads, jobs (TEST-org fixtures),
 *              best-effort deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - Uses before/after DELTAS, never absolute counts — safe against live data.
 *   - The fixture contact gets a real inbound_leads row so it passes
 *     crm_contact_is_traced(), which these RPCs also (correctly) require.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM won-jobs uses the canonical is_real_job rule (integration)', () => {
  const runId = Date.now();
  let orgId;
  let contactId;
  const jobIds = [];
  const leadIds = [];
  const contactIds = [];

  const wonTotal = (rows) => (rows || []).reduce((sum, r) => sum + Number(r.won_jobs || 0), 0);

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    const [contact] = await db.insert('contacts', {
      name: `zz Real Job Rule ${runId}`,
      phone: `+1801${String(runId).slice(-7)}`,
    });
    contactId = contact.id;
    contactIds.push(contact.id);

    // A real CRM lead link so crm_contact_is_traced() passes — otherwise the
    // RPCs correctly exclude this contact for an unrelated reason and the test
    // would pass vacuously.
    const [lead] = await db.insert('inbound_leads', {
      org_id: orgId, source_type: 'call', contact_id: contactId,
      duration_sec: 120, spam_flag: false, raw_payload: { answered: true },
      occurred_at: new Date().toISOString(),
    });
    leadIds.push(lead.id);
  });

  afterAll(async () => {
    if (jobIds.length) await db.delete('jobs', `id=in.(${jobIds.join(',')})`);
    if (leadIds.length) await db.delete('inbound_leads', `id=in.(${leadIds.join(',')})`);
    if (contactIds.length) await db.delete('contacts', `id=in.(${contactIds.join(',')})`);
  });

  it('a booked-but-not-sold job (job_received, is_real_job=false) is NOT a won job', async () => {
    const before = wonTotal(await db.rpc('get_attribution_rollup', {}));

    const [job] = await db.insert('jobs', {
      primary_contact_id: contactId,
      phase: 'job_received',      // past 'lead' — the OLD rule would count this
      status: 'active',
      is_real_job: false,         // but the CANONICAL rule says: not a sale
      division: 'water',
    });
    jobIds.push(job.id);

    const after = wonTotal(await db.rpc('get_attribution_rollup', {}));
    expect(after).toBe(before);
  });

  it('flipping ONLY is_real_job to true makes the same job a won job', async () => {
    const before = wonTotal(await db.rpc('get_attribution_rollup', {}));

    // Nothing else changes — same phase, same status, same contact.
    await db.update('jobs', `id=eq.${jobIds[0]}`, {
      is_real_job: true,
      real_job_source: 'manual',
      real_job_marked_at: new Date().toISOString(),
    });

    const after = wonTotal(await db.rpc('get_attribution_rollup', {}));
    expect(after).toBe(before + 1);
  });

  it('get_crm_revenue_by_division applies the same rule', async () => {
    const rows = await db.rpc('get_crm_revenue_by_division', {});
    const water = (rows || []).find((r) => r.division === 'water');
    expect(water).toBeTruthy(); // our now-real water job must be represented

    // A second booked-but-not-sold job must not inflate the division count.
    const beforeCount = Number(water.won_jobs || 0);
    const [job2] = await db.insert('jobs', {
      primary_contact_id: contactId,
      phase: 'job_received', status: 'active', is_real_job: false, division: 'water',
    });
    jobIds.push(job2.id);

    const after = await db.rpc('get_crm_revenue_by_division', {});
    const waterAfter = (after || []).find((r) => r.division === 'water');
    expect(Number(waterAfter.won_jobs || 0)).toBe(beforeCount);
  });
});
