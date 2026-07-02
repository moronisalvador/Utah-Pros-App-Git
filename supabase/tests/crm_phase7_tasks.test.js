/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase7_tasks.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Exercises the Phase 7 task functions against the real shared database:
 *   create a task, read it back, mark it done and reopen it, delete it — and,
 *   most importantly, proves get_overdue_tasks uses Utah's calendar day
 *   (Mountain Time) to decide "overdue," not the server's UTC clock. A task
 *   due earlier the same Denver day is NOT overdue; a task due a prior Denver
 *   day IS. Everything runs in the TEST org and is cleaned up afterward.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → crm_orgs · writes → crm_tasks via upsert_crm_task /
 *              set_task_status / delete_crm_task (all TEST-org, cleaned up)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites.
 *   - get_overdue_tasks predicate mirrors functions/lib/date-mt.js: overdue when
 *     the MT calendar date of due_at is strictly before the MT date of p_now.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 7 — task RPCs + MT-day overdue predicate (integration)', () => {
  const tag = `phase7-${Date.now()}`;
  let orgId;
  const createdIds = [];

  const mkTask = async (title, dueAt, status) => {
    const row = await db.rpc('upsert_crm_task', {
      p_title: `${tag} ${title}`, p_due_at: dueAt, p_org_id: orgId,
    });
    createdIds.push(row.id);
    if (status && status !== 'open') await db.rpc('set_task_status', { p_task_id: row.id, p_status: status });
    return row;
  };

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      try { await db.rpc('delete_crm_task', { p_task_id: id }); } catch { /* best-effort */ }
    }
  });

  it('upsert_crm_task requires a title', async () => {
    await expect(db.rpc('upsert_crm_task', { p_title: '   ', p_org_id: orgId })).rejects.toBeTruthy();
  });

  it('upsert creates, then get_crm_tasks returns the row with joined fields', async () => {
    const created = await mkTask('roundtrip', '2026-07-10T18:00:00Z', 'open');
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('open');

    const rows = await db.rpc('get_crm_tasks', { p_org_id: orgId, p_status: 'open' });
    const found = rows.find(r => r.id === created.id);
    expect(found).toBeTruthy();
    expect(found.title).toContain('roundtrip');
    // Shape contract consumed by the Tasks page + Overview widget.
    for (const key of ['id', 'title', 'due_at', 'status', 'assignee_id', 'assignee_name', 'contact_id', 'lead_id']) {
      expect(key in found).toBe(true);
    }
  });

  it('set_task_status completes then reopens, tracking completed_at', async () => {
    const t = await mkTask('status', '2026-07-10T18:00:00Z', 'open');
    const done = await db.rpc('set_task_status', { p_task_id: t.id, p_status: 'completed' });
    expect(done.status).toBe('completed');
    expect(done.completed_at).toBeTruthy();
    const reopened = await db.rpc('set_task_status', { p_task_id: t.id, p_status: 'open' });
    expect(reopened.status).toBe('open');
    expect(reopened.completed_at).toBeNull();
  });

  it('get_overdue_tasks uses the MT calendar-day boundary', async () => {
    // now = 2026-07-02T18:00:00Z == 12:00 MDT July 2 in Denver.
    const now = '2026-07-02T18:00:00Z';
    const prior = await mkTask('overdue-prior-day', '2026-07-01T18:00:00Z', 'open'); // July 1 MDT — overdue
    const earlierToday = await mkTask('overdue-earlier-today', '2026-07-02T13:30:00Z', 'open'); // 07:30 MDT July 2 — NOT overdue
    const future = await mkTask('overdue-future', '2026-07-03T06:30:00Z', 'open'); // July 3 MDT — not overdue
    const doneOld = await mkTask('overdue-done', '2026-06-01T18:00:00Z', 'completed'); // old but completed — excluded

    const overdue = await db.rpc('get_overdue_tasks', { p_org_id: orgId, p_now: now });
    const ids = overdue.map(r => r.id);

    expect(ids).toContain(prior.id);
    expect(ids).not.toContain(earlierToday.id);
    expect(ids).not.toContain(future.id);
    expect(ids).not.toContain(doneOld.id);
  });
});
