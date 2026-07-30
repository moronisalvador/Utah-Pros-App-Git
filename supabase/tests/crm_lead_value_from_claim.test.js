/**
 * ════════════════════════════════════════════════
 * FILE: crm_lead_value_from_claim.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the dollar value on a CRM lead card actually behaves: it adds up
 *   every billed invoice across ALL the jobs under the lead's claim (not just
 *   the first job), it leaves a number alone once a person typed it in, and
 *   running the same billing event twice does not change the answer.
 *
 *   The multi-job case is the important one. Measured live on 2026-07-30, 88 of
 *   157 claims already have more than one job under them, so "add up every
 *   job's invoice" is the normal case — and the previous implementation could
 *   only ever record one invoice.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — db lane; see NOTES, it does NOT run in `npm test`
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js; the 20260730120000_crm_lead_value_from_claim
 *              migration
 *   Data:      reads  → inbound_leads, claims, jobs, invoices
 *              writes → its own fixture rows only, all removed in cleanup
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test. Trigger behaviour cannot be proven as a pure unit test.
 *     Self-skips without credentials, like the other CRM suites.
 *   - This is the `db` lane, which `npm test` does NOT run (no isolated
 *     database target exists yet — close-out-standard.md §2b, backlog 6.1).
 *     The CI-visible guard is tests/qa/unit/crm-lead-value-from-claim.test.js.
 *     Never present a pass here as CI coverage.
 *   - Uses the is_test org and dedicated fixture ids, and NEVER asserts on live
 *     row counts — other sessions write to this shared project (tech-v2 §6).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('lead value = sum of committed invoices under the claim (integration)', () => {
  const runId = Date.now();
  const tag = `test-leadvalue-${runId}`;

  let orgId;
  let contactId;
  let claimId;
  let leadId;
  let jobA;
  let jobB;
  const invoiceIds = [];

  const readLead = async () => {
    const [row] = await db.select(
      'inbound_leads',
      `id=eq.${leadId}&select=value,value_source,claim_id`,
    );
    return row;
  };

  const addInvoice = async (jobId, total, extra = {}) => {
    const rows = await db.insert('invoices', {
      job_id: jobId,
      contact_id: contactId,
      invoice_number: `${tag}-${invoiceIds.length}`,
      status: 'draft',
      invoice_type: 'standard',
      total,
      ...extra,
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    invoiceIds.push(row.id);
    return row;
  };

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;

    const contacts = await db.insert('contacts', {
      name: `${tag} contact`,
      phone: `+1801${String(runId).slice(-7)}`,
    });
    contactId = (Array.isArray(contacts) ? contacts[0] : contacts).id;

    // The lead must PREDATE the claim — that is the attach rule.
    const leads = await db.insert('inbound_leads', {
      org_id: orgId,
      contact_id: contactId,
      source_type: 'call',
      callrail_id: `${tag}-call`,
      occurred_at: new Date(runId - 86400000).toISOString(),
    });
    leadId = (Array.isArray(leads) ? leads[0] : leads).id;

    // Creating the claim should attach it to that lead via the trigger.
    const claims = await db.insert('claims', {
      claim_number: `${tag}-C`,
      contact_id: contactId,
      status: 'open',
    });
    claimId = (Array.isArray(claims) ? claims[0] : claims).id;

    const j1 = await db.insert('jobs', {
      job_number: `${tag}-J1`, claim_id: claimId,
      primary_contact_id: contactId, division: 'water', phase: 'job_received',
    });
    const j2 = await db.insert('jobs', {
      job_number: `${tag}-J2`, claim_id: claimId,
      primary_contact_id: contactId, division: 'recon', phase: 'job_received',
    });
    jobA = (Array.isArray(j1) ? j1[0] : j1).id;
    jobB = (Array.isArray(j2) ? j2[0] : j2).id;
  });

  afterAll(async () => {
    // Children first — invoices/jobs reference the claim.
    if (invoiceIds.length) await db.delete('invoices', `id=in.(${invoiceIds.join(',')})`).catch(() => {});
    if (jobA || jobB) await db.delete('jobs', `id=in.(${[jobA, jobB].filter(Boolean).join(',')})`).catch(() => {});
    if (leadId) await db.delete('inbound_leads', `id=eq.${leadId}`).catch(() => {});
    if (claimId) await db.delete('claims', `id=eq.${claimId}`).catch(() => {});
    if (contactId) await db.delete('contacts', `id=eq.${contactId}`).catch(() => {});
  });

  it('attaches the new claim to the call it came from', async () => {
    expect((await readLead()).claim_id).toBe(claimId);
  });

  it('ignores a draft invoice that was never sent or paid', async () => {
    await addInvoice(jobA, 1000);
    // A bare draft is not a commitment — the card stays blank (owner rule).
    expect((await readLead()).value).toBeNull();
  });

  it('counts an invoice once it is sent', async () => {
    await addInvoice(jobB, 2500, { sent_at: new Date().toISOString() });
    const lead = await readLead();
    expect(Number(lead.value)).toBe(2500);
    expect(lead.value_source).toBe('auto');
  });

  it('SUMS across every job under the claim, not just one', async () => {
    // Commit job A's invoice too; now both jobs count.
    const [first] = await db.select('invoices', `job_id=eq.${jobA}&select=id`);
    await db.update('invoices', `id=eq.${first.id}`, { sent_at: new Date().toISOString() });
    // 1000 (job A) + 2500 (job B) — the whole point of the feature.
    expect(Number((await readLead()).value)).toBe(3500);
  });

  it('is idempotent — re-touching an invoice does not change the total', async () => {
    const before = Number((await readLead()).value);
    const [inv] = await db.select('invoices', `job_id=eq.${jobB}&select=id&limit=1`);
    // Simulate a re-send / webhook replay.
    await db.update('invoices', `id=eq.${inv.id}`, { sent_at: new Date().toISOString() });
    expect(Number((await readLead()).value)).toBe(before);
  });

  it('never overwrites a value a person typed in', async () => {
    await db.update('inbound_leads', `id=eq.${leadId}`, { value: 9999, value_source: 'manual' });
    // A new billing event that would otherwise recompute the total.
    await addInvoice(jobA, 777, { sent_at: new Date().toISOString() });
    const lead = await readLead();
    expect(Number(lead.value)).toBe(9999);
    expect(lead.value_source).toBe('manual');
  });

  it('shrinks the total when a committed invoice is deleted', async () => {
    // Back onto automatic first, so the manual guard above isn't what we measure.
    await db.update('inbound_leads', `id=eq.${leadId}`, { value_source: 'auto' });
    const [inv] = await db.select('invoices', `job_id=eq.${jobB}&select=id&limit=1`);
    await db.delete('invoices', `id=eq.${inv.id}`);
    const idx = invoiceIds.indexOf(inv.id);
    if (idx >= 0) invoiceIds.splice(idx, 1);
    const after = Number((await readLead()).value);
    expect(after).toBeLessThan(3500);
    expect(after).toBeGreaterThan(0);
  });
});
