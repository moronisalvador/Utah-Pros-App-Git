/**
 * ════════════════════════════════════════════════
 * FILE: crm_attribution_scoped_to_traced_contacts.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CRM's attribution RPCs (get_attribution_rollup,
 *   get_crm_revenue_by_division, get_conversion_trend,
 *   get_estimator_leaderboard) now count a job/estimate ONLY when its
 *   contact can be traced to an actual CRM lead (a lead_attribution row, or
 *   a direct inbound_leads.contact_id link) — not every job/estimate in the
 *   whole company. A live check found only 24% of won jobs and 6% of
 *   revenue trace to a CRM lead at all; counting the rest made "won jobs"
 *   exceed "leads," which read as a broken/unreliable funnel. Each test
 *   creates one TRACED contact (with a real inbound_leads link) and one
 *   UNTRACED contact (no CRM link at all), gives both an identical
 *   job/estimate, and asserts only the traced one's numbers show up.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs (via RPC's own org lookup)
 *              writes → contacts, inbound_leads, jobs, estimates (TEST-org /
 *              run-unique fixtures), best-effort deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - Uses before/after deltas on a deterministic 'referral' channel (same
 *     convention as crm_pipeline_spam_filter.test.js / crm_attribution_
 *     excludes_merged_leads.test.js) and a run-unique estimator name, never
 *     an absolute count — safe against live production data.
 *   - get_contact_ltv and get_estimate_aging are DELIBERATELY NOT covered
 *     here — they were not rescoped (see the migration's own NOTES for why).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM attribution RPCs scope to CRM-traced contacts only (integration)', () => {
  const runId = Date.now();
  let orgId;
  let tracedContactId;
  let untracedContactId;
  const contactIds = [];
  const leadIds = [];
  const jobIds = [];
  const estimateIds = [];

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    // Traced: a real contact with an inbound_leads link (a genuine CRM touch).
    const [traced] = await db.insert('contacts', { name: `zz-traced-${runId}`, phone: `555${runId}`.slice(0, 10) });
    tracedContactId = traced.id;
    contactIds.push(traced.id);
    const [lead] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Referral', source_type: 'call', spam_flag: false,
      contact_id: tracedContactId, occurred_at: new Date().toISOString(), notes: `zz-traced-lead-${runId}`,
    });
    leadIds.push(lead.id);

    // Untraced: a real contact with NO CRM link at all — a job/estimate
    // entered directly, never touching the lead pipeline.
    const [untraced] = await db.insert('contacts', { name: `zz-untraced-${runId}`, phone: `555${runId + 1}`.slice(0, 10) });
    untracedContactId = untraced.id;
    contactIds.push(untraced.id);
  });

  afterAll(async () => {
    for (const id of estimateIds) await db.delete('estimates', `id=eq.${id}`);
    for (const id of jobIds) await db.delete('jobs', `id=eq.${id}`);
    for (const id of leadIds) await db.delete('inbound_leads', `id=eq.${id}`);
    for (const id of contactIds) await db.delete('contacts', `id=eq.${id}`);
  });

  it('get_attribution_rollup: only the traced contact\'s won job + estimate count (before/after delta)', async () => {
    const before = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const beforeRow = before.find(r => r.channel === 'referral') || { estimates: 0, won_jobs: 0, revenue: 0 };

    const [tracedJob] = await db.insert('jobs', {
      primary_contact_id: tracedContactId, phase: 'job_received', status: 'active',
      invoiced_value: 1000, insured_name: `zz-traced-${runId}`,
    });
    jobIds.push(tracedJob.id);
    const [untracedJob] = await db.insert('jobs', {
      primary_contact_id: untracedContactId, phase: 'job_received', status: 'active',
      invoiced_value: 1000, insured_name: `zz-untraced-${runId}`,
    });
    jobIds.push(untracedJob.id);

    const [tracedEst] = await db.insert('estimates', {
      contact_id: tracedContactId, estimate_type: 'water', status: 'submitted', amount: 500, subtotal: 500,
    });
    estimateIds.push(tracedEst.id);
    const [untracedEst] = await db.insert('estimates', {
      contact_id: untracedContactId, estimate_type: 'water', status: 'submitted', amount: 500, subtotal: 500,
    });
    estimateIds.push(untracedEst.id);

    const after = await db.rpc('get_attribution_rollup', { p_org_id: orgId });
    const afterRow = after.find(r => r.channel === 'referral');
    expect(afterRow).toBeTruthy();

    // +1 each (the traced contact's job/estimate), never +2.
    expect(afterRow.won_jobs - beforeRow.won_jobs).toBe(1);
    expect(afterRow.estimates - beforeRow.estimates).toBe(1);
    expect(afterRow.revenue - beforeRow.revenue).toBe(1000);
  });

  it('get_crm_revenue_by_division: only the traced contact\'s won job counts (before/after delta)', async () => {
    const before = await db.rpc('get_crm_revenue_by_division', {});
    const beforeRow = before.find(r => r.division === 'contents') || { won_jobs: 0, revenue: 0 };

    const [tracedJob] = await db.insert('jobs', {
      primary_contact_id: tracedContactId, phase: 'job_received', status: 'active',
      division: 'contents', invoiced_value: 300, insured_name: `zz-div-traced-${runId}`,
    });
    jobIds.push(tracedJob.id);
    const [untracedJob] = await db.insert('jobs', {
      primary_contact_id: untracedContactId, phase: 'job_received', status: 'active',
      division: 'contents', invoiced_value: 300, insured_name: `zz-div-untraced-${runId}`,
    });
    jobIds.push(untracedJob.id);

    const after = await db.rpc('get_crm_revenue_by_division', {});
    const afterRow = after.find(r => r.division === 'contents');
    expect(afterRow).toBeTruthy();

    // +1 (the traced contact's job), never +2.
    expect(afterRow.won_jobs - beforeRow.won_jobs).toBe(1);
    expect(afterRow.revenue - beforeRow.revenue).toBe(300);
  });

  it('get_conversion_trend: this month\'s won_jobs/estimates only include the traced contact (before/after delta)', async () => {
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM

    const before = await db.rpc('get_conversion_trend', { p_org_id: orgId });
    const beforeRow = before.find(r => r.period === monthKey) || { estimates: 0, won_jobs: 0, revenue: 0 };

    // Fresh inserts, created NOW — proves THIS test's own delta, independent
    // of any fixture another test already committed.
    const [tracedJob] = await db.insert('jobs', {
      primary_contact_id: tracedContactId, phase: 'job_received', status: 'active',
      invoiced_value: 400, insured_name: `zz-trend-traced-${runId}`,
    });
    jobIds.push(tracedJob.id);
    const [untracedJob] = await db.insert('jobs', {
      primary_contact_id: untracedContactId, phase: 'job_received', status: 'active',
      invoiced_value: 400, insured_name: `zz-trend-untraced-${runId}`,
    });
    jobIds.push(untracedJob.id);
    const [tracedEst] = await db.insert('estimates', {
      contact_id: tracedContactId, estimate_type: 'water', status: 'submitted', amount: 150, subtotal: 150,
    });
    estimateIds.push(tracedEst.id);
    const [untracedEst] = await db.insert('estimates', {
      contact_id: untracedContactId, estimate_type: 'water', status: 'submitted', amount: 150, subtotal: 150,
    });
    estimateIds.push(untracedEst.id);

    const after = await db.rpc('get_conversion_trend', { p_org_id: orgId });
    const afterRow = after.find(r => r.period === monthKey);
    expect(afterRow).toBeTruthy();

    // +1 each (the traced contact's job/estimate), never +2.
    expect(afterRow.won_jobs - beforeRow.won_jobs).toBe(1);
    expect(afterRow.estimates - beforeRow.estimates).toBe(1);
    expect(afterRow.revenue - beforeRow.revenue).toBe(400);
  });

  it('get_estimator_leaderboard: only the traced contact\'s job counts toward a run-unique estimator', async () => {
    const estimatorName = `zz-estimator-${runId}`;

    const [tracedJob] = await db.insert('jobs', {
      primary_contact_id: tracedContactId, phase: 'job_received', status: 'active',
      invoiced_value: 250, estimator: estimatorName, insured_name: `zz-est-traced-${runId}`,
    });
    jobIds.push(tracedJob.id);
    const [untracedJob] = await db.insert('jobs', {
      primary_contact_id: untracedContactId, phase: 'job_received', status: 'active',
      invoiced_value: 250, estimator: estimatorName, insured_name: `zz-est-untraced-${runId}`,
    });
    jobIds.push(untracedJob.id);

    const rows = await db.rpc('get_estimator_leaderboard', { p_org_id: orgId });
    const row = rows.find(r => r.estimator === estimatorName);
    expect(row).toBeTruthy();

    // Only the traced job counts — both total_jobs AND won_jobs, since the
    // whole WHERE clause is scoped (a distorted win-rate denominator would
    // be worse than not scoping at all).
    expect(row.total_jobs).toBe(1);
    expect(row.won_jobs).toBe(1);
    expect(row.revenue).toBe(250);
  });

  it('crm_contact_is_traced: true for the traced contact, false for the untraced one and for null', async () => {
    const tracedResult = await db.rpc('crm_contact_is_traced', { p_contact_id: tracedContactId });
    const untracedResult = await db.rpc('crm_contact_is_traced', { p_contact_id: untracedContactId });
    const nullResult = await db.rpc('crm_contact_is_traced', { p_contact_id: null });

    expect(tracedResult).toBe(true);
    expect(untracedResult).toBe(false);
    expect(nullResult).toBe(false);
  });

  it('crm_contact_is_traced: a spam-flagged-ONLY lead does not count as a legitimate CRM touch', async () => {
    const [spamOnlyContact] = await db.insert('contacts', { name: `zz-spamonly-${runId}`, phone: `555${runId + 2}`.slice(0, 10) });
    contactIds.push(spamOnlyContact.id);
    const [spamLead] = await db.insert('inbound_leads', {
      org_id: orgId, source: 'Referral', source_type: 'call', spam_flag: true,
      contact_id: spamOnlyContact.id, occurred_at: new Date().toISOString(), notes: `zz-spamonly-lead-${runId}`,
    });
    leadIds.push(spamLead.id);

    const result = await db.rpc('crm_contact_is_traced', { p_contact_id: spamOnlyContact.id });
    expect(result).toBe(false);
  });
});
