/**
 * ════════════════════════════════════════════════
 * FILE: crm_contact_activity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CRM's "contact activity timeline" database function
 *   (get_contact_activity) shows the UPR job-management/invoicing-side history
 *   — appointments booked, invoices, and signed work-authorization documents —
 *   alongside the CRM-side history it already showed (leads, texts, notes,
 *   estimates, jobs, tasks). The timeline UI itself (ActivityTimeline.jsx) is
 *   generic and needs no changes — this is the only thing that decides what
 *   shows up.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → get_contact_activity RPC
 *              writes → contacts, jobs, contact_jobs, appointments, invoices,
 *                       sign_requests; all test rows deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the Phase 1 CallRail suite.
 *   - Backward-compat check: also seeds a lead so the pre-existing 'lead'
 *     activity type still comes back unchanged alongside the three new ones.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('get_contact_activity — cross-system history (integration)', () => {
  const runId = Date.now();
  const phone = `+1557${String(runId).slice(-7)}`;
  let contactId;
  let jobId;
  let testOrgId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;

    const [contact] = await db.insert('contacts', { phone, name: 'Activity Test Person' });
    contactId = contact.id;

    // jobs has no org_id column — it's scoped via contact_jobs/contacts instead.
    const [job] = await db.insert('jobs', { insured_name: 'Activity Test Person', client_phone: phone });
    jobId = job.id;

    await db.insert('contact_jobs', { contact_id: contactId, job_id: jobId, role: 'customer', is_primary: true });
    await db.insert('appointments', { job_id: jobId, date: '2026-07-20', title: 'Test Inspection', status: 'scheduled', type: 'inspection' });
    await db.insert('invoices', { job_id: jobId, contact_id: contactId, invoice_number: `TEST-${runId}`, status: 'draft', total: 500 });
    await db.insert('sign_requests', { job_id: jobId, contact_id: contactId, doc_type: 'work_authorization', status: 'signed', signer_name: 'Activity Test Person' });
    await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-activity-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 30,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
  });

  afterAll(async () => {
    await db.delete('inbound_leads', `callrail_id=eq.test-activity-${runId}`);
    await db.delete('sign_requests', `job_id=eq.${jobId}`);
    await db.delete('invoices', `job_id=eq.${jobId}`);
    await db.delete('appointments', `job_id=eq.${jobId}`);
    await db.delete('contact_jobs', `job_id=eq.${jobId}`);
    await db.delete('jobs', `id=eq.${jobId}`);
    await db.delete('contacts', `id=eq.${contactId}`);
  });

  it('returns appointment, invoice, and work_authorization rows alongside the pre-existing lead row', async () => {
    const rows = await db.rpc('get_contact_activity', { p_contact_id: contactId });
    const byType = (t) => rows.find((r) => r.activity_type === t);

    const appointment = byType('appointment');
    expect(appointment).toBeTruthy();
    expect(appointment.title).toBe('Test Inspection');
    expect(appointment.meta.status).toBe('scheduled');

    const invoice = byType('invoice');
    expect(invoice).toBeTruthy();
    expect(invoice.title).toContain(`TEST-${runId}`);
    expect(invoice.meta.total).toBe(500);

    const workAuth = byType('work_authorization');
    expect(workAuth).toBeTruthy();
    expect(workAuth.meta.doc_type).toBe('work_authorization');
    expect(workAuth.meta.status).toBe('signed');

    // Backward-compat: the pre-existing types still work unchanged.
    const lead = byType('lead');
    expect(lead).toBeTruthy();
  });
});
