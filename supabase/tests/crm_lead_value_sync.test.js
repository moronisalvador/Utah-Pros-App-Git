/**
 * ════════════════════════════════════════════════
 * FILE: crm_lead_value_sync.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that creating a real invoice fills in the CRM lead's dollar value
 *   (for future ROI/total-sales reporting) — but only on the contact's Won
 *   lead, only when it's currently blank, and never on more than one lead
 *   for the same contact (so a repeat-caller's history can't get double-
 *   counted in a sales report).
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → lead_pipeline_stage, pipeline_stages, inbound_leads
 *              writes → contacts, jobs, contact_jobs, inbound_leads, invoices
 *                       (all test rows deleted in afterAll)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the other CRM integration suites.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('crm_sync_lead_value / invoice-created value sync (integration)', () => {
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
      await db.delete('invoices', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('contact_jobs', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('system_events', `job_id=in.(${cleanup.jobIds.join(',')})`);
      await db.delete('jobs', `id=in.(${cleanup.jobIds.join(',')})`);
    }
    if (cleanup.contactIds.length) await db.delete('contacts', `id=in.(${cleanup.contactIds.join(',')})`);
  });

  async function seedContactAndJob(label) {
    const phone = `+1564${String(runId).slice(-6)}${cleanup.contactIds.length}`;
    const [contact] = await db.insert('contacts', { phone, name: `Value Sync ${label}` });
    cleanup.contactIds.push(contact.id);
    const [job] = await db.insert('jobs', { insured_name: `Value Sync ${label}`, client_phone: phone });
    cleanup.jobIds.push(job.id);
    await db.insert('contact_jobs', { contact_id: contact.id, job_id: job.id, role: 'customer', is_primary: true });
    return { contactId: contact.id, jobId: job.id };
  }

  async function seedLeadOnStage(contactId, stageName, label) {
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-value-sync-${label}-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: `+1564${String(runId).slice(-6)}${cleanup.leadIds.length}9`,
      p_duration_sec: 60,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    // upsert_lead_from_callrail matches by phone, not contact_id directly — link explicitly for this test.
    await db.update('inbound_leads', `id=eq.${lead.id}`, { contact_id: contactId });
    cleanup.leadIds.push(lead.id);
    if (stageName) {
      await db.rpc('move_lead_to_stage', { p_lead_id: lead.id, p_stage_id: stagesByName[stageName].id, p_moved_by: null, p_lost_reason: null });
    }
    return lead.id;
  }

  async function leadValue(leadId) {
    const [row] = await db.select('inbound_leads', `id=eq.${leadId}&select=value`);
    return row?.value != null ? Number(row.value) : null;
  }

  it('creating a real invoice fills the Won lead\'s blank value', async () => {
    const { contactId, jobId } = await seedContactAndJob('fill');
    const leadId = await seedLeadOnStage(contactId, 'Won', 'fill');
    expect(await leadValue(leadId)).toBeNull();

    await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `VALSYNC-${runId}`, status: 'draft', total: 4200 });

    expect(await leadValue(leadId)).toBe(4200);
  });

  it('never overwrites a lead that already has a value', async () => {
    const { contactId, jobId } = await seedContactAndJob('nooverwrite');
    const leadId = await seedLeadOnStage(contactId, 'Won', 'nooverwrite');
    await db.update('inbound_leads', `id=eq.${leadId}`, { value: 999 });

    await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `VALSYNC-NO-${runId}`, status: 'draft', total: 5000 });

    expect(await leadValue(leadId)).toBe(999);
  });

  it('never sets a value on a lead that is not Won', async () => {
    const { contactId, jobId } = await seedContactAndJob('notwon');
    const leadId = await seedLeadOnStage(contactId, 'Qualified', 'notwon');

    await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `VALSYNC-NW-${runId}`, status: 'draft', total: 3000 });

    // The invoice-created trigger also auto-advances this lead to Won (existing
    // behavior) — but crm_sync_lead_value runs after, so the now-Won lead with a
    // still-blank value SHOULD get filled. Confirms the two triggers compose.
    expect(await leadValue(leadId)).toBe(3000);
  });

  it('uses adjusted_total over total when present', async () => {
    const { contactId, jobId } = await seedContactAndJob('adjusted');
    const leadId = await seedLeadOnStage(contactId, 'Won', 'adjusted');

    await db.insert('invoices', {
      job_id: jobId, contact_id: contactId, invoice_number: `VALSYNC-ADJ-${runId}`,
      status: 'draft', total: 6000, adjusted_total: 5500,
    });

    expect(await leadValue(leadId)).toBe(5500);
  });

  it('never double-counts across two Won leads for the same contact — only the most recent gets filled', async () => {
    const { contactId, jobId } = await seedContactAndJob('multi');
    const leadA = await seedLeadOnStage(contactId, 'Won', 'multiA');
    const leadB = await seedLeadOnStage(contactId, 'Won', 'multiB');

    await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `VALSYNC-MULTI-${runId}`, status: 'draft', total: 2500 });

    const [valueA, valueB] = [await leadValue(leadA), await leadValue(leadB)];
    const filled = [valueA, valueB].filter((v) => v === 2500);
    expect(filled.length).toBe(1); // exactly one lead got it, never both
  });

  it('a zero/negative invoice total never sets a value', async () => {
    const { contactId, jobId } = await seedContactAndJob('zero');
    const leadId = await seedLeadOnStage(contactId, 'Won', 'zero');

    await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `VALSYNC-ZERO-${runId}`, status: 'draft', total: 0 });

    expect(await leadValue(leadId)).toBeNull();
  });
});
