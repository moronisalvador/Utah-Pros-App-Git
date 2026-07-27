/**
 * ════════════════════════════════════════════════
 * FILE: crm_contact_activity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the CRM's "contact activity timeline" database function
 *   (get_contact_activity) shows the right history for a customer. Two suites:
 *
 *   1. The original cross-system spot-check — appointments booked, invoices,
 *      and signed work-authorization documents show up alongside the CRM-side
 *      history (leads, texts, notes, estimates, jobs, tasks).
 *
 *   2. A DURABLE ALL-ARMS REGRESSION GUARD (added 2026-07-24). The function is
 *      a big stack of UNION ALL "arms", one per kind of history entry. It has
 *      been grown by a chain of function-body-only CREATE OR REPLACE migrations
 *      and now has 24 arms. On 2026-07-24 a migration nearly re-authored it from
 *      a stale 12-arm ancestor, which would have SILENTLY DROPPED 11 already-live
 *      arms (claim, phase_change, payment, document, owner/lifecycle events, the
 *      two work-auth arms, scope_sheet, invoice_sent, estimate_sent). The old
 *      spot-check would not have caught it. This guard seeds one contact wired to
 *      every arm and asserts all 24 come back — so any future body-only replace
 *      that forgets an arm fails loudly here.
 *
 *   The timeline UI (ActivityTimeline.jsx) is generic; this function is the only
 *   thing that decides what shows up.
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
 *              writes → contacts, jobs, contact_jobs, inbound_leads (via
 *                       upsert_lead_from_callrail), crm_lead_notes (via
 *                       add_lead_note), job_notes, crm_tasks, lead_stage_history,
 *                       appointments, estimates, invoices, payments, sign_requests,
 *                       job_documents, job_phase_history, forms, claims,
 *                       system_events, conversations, conversation_participants,
 *                       messages, email_campaigns, email_campaign_recipients,
 *                       pipeline_stages (read). ALL test rows deleted in afterAll
 *                       (crm_lead_notes cascades on the lead delete).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the Phase 1 CallRail suite.
 *   - get_contact_activity / add_lead_note are GRANTed to authenticated +
 *     service_role only (never anon — database-standard.md §1), and crm_lead_notes
 *     is RLS deny-all (RPC-only). So this suite only truly exercises when run
 *     where those roles can reach the RPCs (an authenticated harness, or the
 *     Supabase MCP as a privileged role) — NOT a plain anonymous browser session.
 *     The live 24-arm contract + every fixture column/enum here was verified
 *     read-only via the Supabase MCP against project glsmljpabrwonfiltiqm.
 *   - The two 'note' arms (job_notes vs crm_lead_notes) share activity_type
 *     'note'; the guard distinguishes them by meta.note_id (only the
 *     crm_lead_notes arm sets it), so dropping EITHER note arm is caught.
 *   - This is the durable guard flagged (recommended, not required) by
 *     migration-safety-checker for 20260724180000_crm_lead_notes.sql.
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

// ─── SECTION: all-arms durable regression guard ──────────────
// The load-bearing guard. Every entry below is one UNION ALL arm of
// get_contact_activity, in source order. A future function-body-only
// CREATE OR REPLACE that silently drops an arm (the 2026-07-24 near-miss)
// makes that arm's `match` return nothing and this test fails, naming it.
// The two 'note' arms share activity_type 'note' and are told apart by
// meta.note_id (only crm_lead_notes sets it) so dropping EITHER is caught.
const ACTIVITY_ARMS = [
  { arm: 'lead',                  match: (r) => r.activity_type === 'lead' },
  { arm: 'sms',                   match: (r) => r.activity_type === 'sms' },
  { arm: 'note (job_notes)',      match: (r) => r.activity_type === 'note' && r.meta && !('note_id' in r.meta) },
  { arm: 'note (crm_lead_notes)', match: (r) => r.activity_type === 'note' && r.meta && 'note_id' in r.meta },
  { arm: 'estimate',              match: (r) => r.activity_type === 'estimate' },
  { arm: 'email',                 match: (r) => r.activity_type === 'email' },
  { arm: 'job',                   match: (r) => r.activity_type === 'job' },
  { arm: 'task',                  match: (r) => r.activity_type === 'task' },
  { arm: 'appointment',           match: (r) => r.activity_type === 'appointment' },
  { arm: 'invoice',               match: (r) => r.activity_type === 'invoice' },
  { arm: 'work_authorization',    match: (r) => r.activity_type === 'work_authorization' },
  { arm: 'stage_change',          match: (r) => r.activity_type === 'stage_change' },
  { arm: 'follow_up_call',        match: (r) => r.activity_type === 'follow_up_call' },
  { arm: 'claim',                 match: (r) => r.activity_type === 'claim' },
  { arm: 'phase_change',          match: (r) => r.activity_type === 'phase_change' },
  { arm: 'payment',               match: (r) => r.activity_type === 'payment' },
  { arm: 'document',              match: (r) => r.activity_type === 'document' },
  { arm: 'contact_owner_set',     match: (r) => r.activity_type === 'contact_owner_set' },
  { arm: 'contact_lifecycle_set', match: (r) => r.activity_type === 'contact_lifecycle_set' },
  { arm: 'work_auth_sent',        match: (r) => r.activity_type === 'work_auth_sent' },
  { arm: 'work_auth_signed',      match: (r) => r.activity_type === 'work_auth_signed' },
  { arm: 'scope_sheet',           match: (r) => r.activity_type === 'scope_sheet' },
  { arm: 'invoice_sent',          match: (r) => r.activity_type === 'invoice_sent' },
  { arm: 'estimate_sent',         match: (r) => r.activity_type === 'estimate_sent' },
];

describe.skipIf(!hasCreds)('get_contact_activity — all 24 activity arms survive (durable regression guard)', () => {
  const runId = Date.now();
  const phone = `+1559${String(runId).slice(-7)}`;
  const followPhone = `+1560${String(runId).slice(-7)}`;

  let testOrgId;
  let contactId;
  let jobId;
  let leadId;        // primary lead — linked to the contact, merged_into IS NULL
  let followLeadId;  // follow-up lead — merged into the primary (drives follow_up_call)
  let campaignId;
  let conversationId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;

    // ── core identity: contact + job + link ──
    const [contact] = await db.insert('contacts', { phone, name: `All-Arms Test ${runId}` });
    contactId = contact.id;
    const [job] = await db.insert('jobs', { insured_name: `All-Arms Test ${runId}`, client_phone: phone });
    jobId = job.id;
    await db.insert('contact_jobs', { contact_id: contactId, job_id: jobId, role: 'customer', is_primary: true });

    const stages = await db.select('pipeline_stages', `org_id=eq.${testOrgId}&select=id&order=sort_order.asc&limit=2`);
    const stageAId = stages[0].id;
    const stageBId = stages[1]?.id || stages[0].id;

    // ── lead arm + the follow_up_call arm ──
    // Primary lead, then forced to the exact shape the arm needs (linked to the
    // contact, not itself a merge target) — deterministic regardless of any
    // repeat-caller auto-merge trigger.
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-arms-${runId}`, p_source_type: 'call', p_org_id: testOrgId,
      p_caller_number: phone, p_duration_sec: 30, p_spam_flag: false,
      p_occurred_at: new Date().toISOString(), p_raw_payload: { test: true },
    });
    leadId = lead.id;
    await db.update('inbound_leads', `id=eq.${leadId}`, { contact_id: contactId, merged_into_lead_id: null });

    // Follow-up lead (different number so no auto-merge fires), then pointed at
    // the primary — it is excluded from the 'lead' arm and surfaces as follow_up_call.
    const followLead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-arms-followup-${runId}`, p_source_type: 'call', p_org_id: testOrgId,
      p_caller_number: followPhone, p_duration_sec: 20, p_spam_flag: false,
      p_occurred_at: new Date().toISOString(), p_raw_payload: { test: true },
    });
    followLeadId = followLead.id;
    await db.update('inbound_leads', `id=eq.${followLeadId}`, { contact_id: contactId, merged_into_lead_id: leadId });

    // ── crm_lead_notes 'note' arm (RPC-only table; note_id distinguishes it) ──
    await db.rpc('add_lead_note', { p_lead_id: leadId, p_body: `Lead note ${runId}`, p_created_by: null });

    // ── job_notes 'note' arm ──
    await db.insert('job_notes', { job_id: jobId, body: `Job note ${runId}`, author_name: 'Tester' });

    // ── task arm ──
    await db.insert('crm_tasks', { org_id: testOrgId, title: `Task ${runId}`, contact_id: contactId, status: 'open' });

    // ── stage_change arm ──
    await db.insert('lead_stage_history', { org_id: testOrgId, lead_id: leadId, stage_id: stageBId, from_stage_id: stageAId });

    // ── appointment arm ──
    await db.insert('appointments', { job_id: jobId, date: '2026-07-20', title: `Inspection ${runId}`, status: 'scheduled', type: 'inspection' });

    // ── estimate arm + estimate_sent arm (one row: qbo_emailed_at drives estimate_sent) ──
    await db.insert('estimates', {
      job_id: jobId, contact_id: contactId, estimate_number: `EST-${runId}`, status: 'submitted', amount: 1200,
      qbo_emailed_at: new Date().toISOString(), sent_to_email: 'test@example.com', qbo_email_status: 'EmailSent',
    });

    // ── invoice arm + invoice_sent arm (one row: qbo_emailed_at drives invoice_sent) ──
    await db.insert('invoices', {
      job_id: jobId, contact_id: contactId, invoice_number: `INV-${runId}`, status: 'draft', total: 500,
      qbo_emailed_at: new Date().toISOString(), sent_to_email: 'test@example.com', qbo_email_status: 'EmailSent',
    });

    // ── payment arm ──
    await db.insert('payments', { job_id: jobId, contact_id: contactId, amount: 250, payment_method: 'check', payment_date: '2026-07-21' });

    // ── work_authorization + work_auth_sent + work_auth_signed arms (one signed work_auth request) ──
    await db.insert('sign_requests', {
      job_id: jobId, contact_id: contactId, doc_type: 'work_auth', status: 'signed',
      signer_name: 'Test Signer', signer_email: 'signer@example.com',
      sent_at: new Date().toISOString(), signed_at: new Date().toISOString(),
      signed_file_path: `signed/${runId}.pdf`,
    });

    // ── document arm ──
    await db.insert('job_documents', { job_id: jobId, name: `Report ${runId}`, file_path: `job-files/${jobId}/${runId}.pdf`, category: 'report' });

    // ── phase_change arm ──
    await db.insert('job_phase_history', { job_id: jobId, from_phase: 'lead', to_phase: 'production' });

    // ── scope_sheet arm (forms.form_type = 'demo_sheet') ──
    await db.insert('forms', { job_id: jobId, form_type: 'demo_sheet', technician_name: `Tech ${runId}`, form_date: '2026-07-20', status: 'submitted' });

    // ── claim arm ──
    await db.insert('claims', { contact_id: contactId, claim_number: `CLM-${runId}`, loss_type: 'water', insurance_carrier: 'Test Carrier', status: 'open', date_of_loss: '2026-07-10' });

    // ── contact_owner_set + contact_lifecycle_set arms (system_events) ──
    await db.insert('system_events', { event_type: 'crm_contact_owner_set', entity_type: 'contact', entity_id: contactId, payload: { note: `owner ${runId}` } });
    await db.insert('system_events', { event_type: 'crm_contact_lifecycle_set', entity_type: 'contact', entity_id: contactId, payload: { note: `lifecycle ${runId}` } });

    // ── sms arm (conversation + participant + message) ──
    const [conversation] = await db.insert('conversations', { type: 'direct' });
    conversationId = conversation.id;
    await db.insert('conversation_participants', { conversation_id: conversationId, contact_id: contactId, phone });
    await db.insert('messages', { conversation_id: conversationId, type: 'sms_outbound', body: `SMS ${runId}`, status: 'sent' });

    // ── email arm (campaign + recipient) ──
    const [campaign] = await db.insert('email_campaigns', { org_id: testOrgId, name: `Campaign ${runId}`, subject: `Subject ${runId}` });
    campaignId = campaign.id;
    await db.insert('email_campaign_recipients', { campaign_id: campaignId, contact_id: contactId, email: 'test@example.com', status: 'sent', sent_at: new Date().toISOString() });
  });

  afterAll(async () => {
    // Best-effort, children before parents; crm_lead_notes cascades on the lead delete.
    const del = (table, filter) => db.delete(table, filter).catch(() => {});
    if (campaignId) { await del('email_campaign_recipients', `campaign_id=eq.${campaignId}`); await del('email_campaigns', `id=eq.${campaignId}`); }
    if (conversationId) {
      await del('messages', `conversation_id=eq.${conversationId}`);
      await del('conversation_participants', `conversation_id=eq.${conversationId}`);
      await del('conversations', `id=eq.${conversationId}`);
    }
    if (jobId) {
      await del('job_documents', `job_id=eq.${jobId}`);
      await del('forms', `job_id=eq.${jobId}`);
      await del('job_phase_history', `job_id=eq.${jobId}`);
      await del('payments', `job_id=eq.${jobId}`);
      await del('sign_requests', `job_id=eq.${jobId}`);
      await del('invoices', `job_id=eq.${jobId}`);
      await del('estimates', `job_id=eq.${jobId}`);
      await del('appointments', `job_id=eq.${jobId}`);
      await del('job_notes', `job_id=eq.${jobId}`);
    }
    if (contactId) {
      await del('crm_tasks', `contact_id=eq.${contactId}`);
      await del('claims', `contact_id=eq.${contactId}`);
      await del('system_events', `entity_id=eq.${contactId}`);
    }
    if (leadId) await del('lead_stage_history', `lead_id=eq.${leadId}`);
    if (followLeadId) await del('inbound_leads', `id=eq.${followLeadId}`);
    if (leadId) await del('inbound_leads', `id=eq.${leadId}`);
    if (jobId) await del('contact_jobs', `job_id=eq.${jobId}`);
    if (jobId) await del('jobs', `id=eq.${jobId}`);
    if (contactId) await del('contacts', `id=eq.${contactId}`);
  });

  it('returns every one of the 24 activity arms for a fully-wired contact', async () => {
    const rows = await db.rpc('get_contact_activity', { p_contact_id: contactId });
    expect(Array.isArray(rows)).toBe(true);

    // The frozen RETURNS TABLE shape is intact (any consumer reads these keys).
    for (const key of ['activity_type', 'occurred_at', 'title', 'body', 'meta']) {
      expect(key in rows[0]).toBe(true);
    }

    // The load-bearing assertion: every arm produced at least one row. A missing
    // arm names itself in the failure message (the whole point of the guard).
    const missing = ACTIVITY_ARMS.filter(({ match }) => !rows.some(match)).map(({ arm }) => arm);
    expect(missing, `get_contact_activity dropped arm(s): ${missing.join(', ')}`).toEqual([]);

    // Sanity: 24 arms collapse to 23 distinct activity_type values (two 'note' arms).
    expect(ACTIVITY_ARMS.length).toBe(24);
    const distinctTypes = new Set(rows.map((r) => r.activity_type));
    for (const t of ['lead', 'sms', 'note', 'estimate', 'email', 'job', 'task', 'appointment',
      'invoice', 'work_authorization', 'stage_change', 'follow_up_call', 'claim', 'phase_change',
      'payment', 'document', 'contact_owner_set', 'contact_lifecycle_set', 'work_auth_sent',
      'work_auth_signed', 'scope_sheet', 'invoice_sent', 'estimate_sent']) {
      expect(distinctTypes.has(t), `expected activity_type '${t}' present`).toBe(true);
    }
  });
});
