/**
 * ════════════════════════════════════════════════
 * FILE: crm_pipeline_auto_advance.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the four milestone-driven pipeline auto-moves work: signing a work
 *   authorization, creating a real invoice, receiving a payment, and
 *   submitting an estimate each automatically push a customer's open leads
 *   forward on the CRM board — without anyone dragging a card.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → lead_pipeline_stage, pipeline_stages
 *              writes → contacts, jobs, contact_jobs, inbound_leads,
 *                       sign_requests, invoices, estimates; all test rows
 *                       deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the other CRM integration suites.
 *   - Each `it` uses its own fresh contact+job+lead so the four triggers
 *     don't interfere with each other's "already Won, don't downgrade" guard.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM pipeline auto-advance triggers (integration)', () => {
  const runId = Date.now();
  let testOrgId;
  let stagesByName;
  const cleanup = { contactIds: [], jobIds: [], leadIds: [] };

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;
    const stages = await db.select('pipeline_stages', `org_id=eq.${testOrgId}`);
    stagesByName = Object.fromEntries(stages.map((s) => [s.name, s]));
  });

  afterAll(async () => {
    if (cleanup.leadIds.length) await db.delete('inbound_leads', `id=in.(${cleanup.leadIds.join(',')})`);
    if (cleanup.jobIds.length) {
      await db.delete('sign_requests', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('invoices', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('estimates', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('contact_jobs', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('system_events', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('jobs', `id=in.(${cleanup.jobIds.join(',')})`);
    }
    if (cleanup.contactIds.length) await db.delete('contacts', `id=in.(${cleanup.contactIds.join(',')})`);
  });

  // Seeds a fresh contact + job + contact_jobs link + one open (New-stage) lead
  // for that contact, and returns the ids. Tracks everything for cleanup.
  async function seedOpenLead(label) {
    const phone = `+1558${String(runId).slice(-6)}${cleanup.contactIds.length}`;
    const [contact] = await db.insert('contacts', { phone, name: `Auto-Advance ${label}` });
    cleanup.contactIds.push(contact.id);

    const [job] = await db.insert('jobs', { insured_name: `Auto-Advance ${label}`, client_phone: phone });
    cleanup.jobIds.push(job.id);

    await db.insert('contact_jobs', { contact_id: contact.id, job_id: job.id, role: 'customer', is_primary: true });

    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-auto-advance-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 60,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    cleanup.leadIds.push(lead.id);
    expect(lead.contact_id).toBe(contact.id); // sanity: the link fix from the prior migration

    return { contactId: contact.id, jobId: job.id, leadId: lead.id };
  }

  async function currentStageName(leadId) {
    const [row] = await db.select('lead_pipeline_stage', `lead_id=eq.${leadId}`);
    if (!row) return null;
    const stage = Object.values(stagesByName).find((s) => s.id === row.stage_id);
    return stage?.name ?? null;
  }

  it('signing a work_auth document moves the lead to Won', async () => {
    const { contactId, jobId, leadId } = await seedOpenLead('workauth');
    await db.insert('sign_requests', { job_id: jobId, contact_id: contactId, doc_type: 'work_auth', status: 'pending', signer_name: 'Test' });
    await db.update('sign_requests', `job_id=eq.${jobId}`, { status: 'signed' });

    expect(await currentStageName(leadId)).toBe('Won');
  });

  it('creating an invoice with a real amount moves the lead to Won', async () => {
    const { jobId, contactId, leadId } = await seedOpenLead('invoice');
    await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `AUTOADV-${runId}`, status: 'draft', total: 750 });

    expect(await currentStageName(leadId)).toBe('Won');
  });

  it('receiving a payment moves the lead to Won', async () => {
    const { jobId, contactId, leadId } = await seedOpenLead('payment');
    const [invoice] = await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `AUTOADV-PAY-${runId}`, status: 'draft', total: 0 });
    // total=0 above so the "invoice created with an amount" trigger doesn't
    // already win this test — isolates the payment trigger specifically.
    await db.update('invoices', `id=eq.${invoice.id}`, { amount_paid: 400 });

    expect(await currentStageName(leadId)).toBe('Won');
  });

  it('submitting an estimate moves the lead to Estimate Sent', async () => {
    const { jobId, contactId, leadId } = await seedOpenLead('estimate');
    await db.insert('estimates', { job_id: jobId, contact_id: contactId, status: 'draft', amount: 1200 });
    await db.update('estimates', `job_id=eq.${jobId}`, { status: 'submitted' });

    expect(await currentStageName(leadId)).toBe('Estimate Sent');
  });

  it('never downgrades a lead already marked Won', async () => {
    const { jobId, contactId, leadId } = await seedOpenLead('nodowngrade');
    await db.insert('sign_requests', { job_id: jobId, contact_id: contactId, doc_type: 'work_auth', status: 'signed', signer_name: 'Test' });
    expect(await currentStageName(leadId)).toBe('Won');

    // A later estimate (e.g. a change order) must NOT pull an already-Won lead backward.
    await db.insert('estimates', { job_id: jobId, contact_id: contactId, status: 'submitted', amount: 300 });
    expect(await currentStageName(leadId)).toBe('Won');
  });
});
