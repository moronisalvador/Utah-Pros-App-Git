/**
 * ════════════════════════════════════════════════
 * FILE: crm_lead_activity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves two fixes to the CRM's activity timeline. First, a brand-new
 *   function (get_lead_activity) that lets an unlinked lead (no matching
 *   customer record yet) show its own call, its own tasks, and its own
 *   stage-move history — instead of a permanently empty timeline. Second,
 *   that the existing per-contact function (get_contact_activity) now also
 *   shows stage moves, and shows a task that was added while a lead was still
 *   unlinked even after that lead later gets matched to a contact.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → get_lead_activity, get_contact_activity RPCs
 *              writes → contacts, crm_tasks, lead_stage_history (all via
 *              upsert_lead_from_callrail / direct insert); all test rows
 *              deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the sibling crm_contact_activity.test.js suite.
 *   - Same known local-dev limitation as every other integration suite in
 *     this directory (CLAUDE.md "Local Dev & UI Verification"): the db
 *     client here runs as the anon Supabase role, so even with creds present
 *     this suite only proves the RPC/RLS behavior when run somewhere the
 *     anon role can actually reach these tables (e.g. against the live
 *     project via the Supabase MCP, not a local devLogin session). Verify
 *     with direct SQL fixtures via the Supabase MCP when this self-skips.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('get_lead_activity + get_contact_activity — unlinked-lead activity (integration)', () => {
  const runId = Date.now();
  const phone = `+1558${String(runId).slice(-7)}`;
  let testOrgId;
  let stageAId;
  let stageBId;
  let leadId;
  let taskId;
  let stageHistoryId;
  let contactId;

  beforeAll(async () => {
    const [testOrg] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    testOrgId = testOrg.id;

    const [stages] = await Promise.all([
      db.select('pipeline_stages', `org_id=eq.${testOrgId}&select=id&order=sort_order.asc&limit=2`),
    ]);
    stageAId = stages[0].id;
    stageBId = stages[1]?.id || stages[0].id;

    // An unlinked lead — no contact_id, the common pre-qualification state.
    const lead = await db.rpc('upsert_lead_from_callrail', {
      p_callrail_id: `test-lead-activity-${runId}`,
      p_source_type: 'call',
      p_org_id: testOrgId,
      p_caller_number: phone,
      p_duration_sec: 45,
      p_spam_flag: false,
      p_occurred_at: new Date().toISOString(),
      p_raw_payload: { test: true },
    });
    leadId = lead.id;

    // A task added directly against the lead (lead_id set, contact_id NULL —
    // the shape the quick-add-task composer produces for an unlinked lead).
    const [task] = await db.insert('crm_tasks', {
      org_id: testOrgId,
      title: `Test follow-up ${runId}`,
      lead_id: leadId,
      status: 'open',
    });
    taskId = task.id;

    // A stage move for this lead (lead_stage_history has no contact_id column
    // at all — this is the only key it can be looked up by).
    const [history] = await db.insert('lead_stage_history', {
      org_id: testOrgId,
      lead_id: leadId,
      stage_id: stageBId,
      from_stage_id: stageAId,
    });
    stageHistoryId = history.id;
  });

  afterAll(async () => {
    await db.delete('lead_stage_history', `id=eq.${stageHistoryId}`);
    await db.delete('crm_tasks', `id=eq.${taskId}`);
    await db.delete('inbound_leads', `id=eq.${leadId}`);
    if (contactId) await db.delete('contacts', `id=eq.${contactId}`);
  });

  it('get_lead_activity returns the lead, its task, and its stage move with no contact required', async () => {
    const rows = await db.rpc('get_lead_activity', { p_lead_id: leadId });
    const byType = (t) => rows.find((r) => r.activity_type === t);

    expect(byType('lead')).toBeTruthy();

    const task = byType('task');
    expect(task).toBeTruthy();
    expect(task.title).toBe(`Test follow-up ${runId}`);
    expect(task.meta.task_id).toBe(taskId);

    const stageChange = byType('stage_change');
    expect(stageChange).toBeTruthy();
    expect(stageChange.title).toMatch(/^Moved to /);
    expect(stageChange.meta.stage_id).toBe(stageBId);
    expect(stageChange.meta.from_stage_id).toBe(stageAId);
  });

  it('get_contact_activity picks up the stage move and the lead-scoped task once the lead links to a contact', async () => {
    const [contact] = await db.insert('contacts', { phone, name: 'Lead Activity Test Person' });
    contactId = contact.id;
    await db.update('inbound_leads', `id=eq.${leadId}`, { contact_id: contactId });

    const rows = await db.rpc('get_contact_activity', { p_contact_id: contactId });
    const byType = (t) => rows.find((r) => r.activity_type === t);

    const stageChange = byType('stage_change');
    expect(stageChange).toBeTruthy();
    expect(stageChange.meta.stage_id).toBe(stageBId);

    // The task's contact_id was never backfilled (only lead_id was set) — it
    // must still surface via the widened OR clause, not just contact_id.
    const task = byType('task');
    expect(task).toBeTruthy();
    expect(task.meta.task_id).toBe(taskId);
  });
});
