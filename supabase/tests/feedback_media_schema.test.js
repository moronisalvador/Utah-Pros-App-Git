/**
 * ════════════════════════════════════════════════
 * FILE: feedback_media_schema.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the Feedback Media foundation (Phase F) is safe to ship on the one
 *   shared database. The feedback form that techs already use in production
 *   calls the insert function the OLD way (five inputs) — this test makes that
 *   exact call and checks it still works after the upgrade (if the upgrade had
 *   accidentally left two versions of the function, every live submit would
 *   break instantly). It also checks the new pieces: rich attachments are
 *   mirrored into the old screenshots list so the current admin page keeps
 *   showing images, resolve/dismiss stamps a "resolved on" date exactly once,
 *   and old media only becomes eligible for cleanup after at least 30 days no
 *   matter what the caller asks for.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client)
 *   Data:      reads  → tech_feedback (get_tech_feedback,
 *                       get_purgeable_feedback_media), employees (one id)
 *              writes → tech_feedback (insert_tech_feedback,
 *                       update_tech_feedback, mark_feedback_attachments_purged);
 *              all test rows deleted in afterAll.
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the CRM suites.
 *   - Committed FAILING before supabase/migrations/20260702_feedback_media.sql
 *     existed (test-first): the old 5-arg insert succeeded but returned no
 *     `attachments`/`source` keys, and the new RPCs 404'd.
 *   - Attachment paths in this test are plain strings — no storage objects are
 *     ever uploaded, so cleanup is only the tech_feedback rows.
 *   - The 5-arg call passes p_screenshots as a JSON.stringify'd string, because
 *     that is byte-for-byte how the live TechFeedback.jsx calls it today.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('Feedback Media — Phase F schema + RPC cutover (integration)', () => {
  const runId = Date.now();
  const createdIds = [];
  let employeeId;

  beforeAll(async () => {
    const [emp] = await db.select('employees', 'select=id&limit=1');
    employeeId = emp.id;
  });

  afterAll(async () => {
    for (const id of createdIds) {
      try { await db.delete('tech_feedback', `id=eq.${id}`); } catch { /* best-effort cleanup */ }
    }
  });

  it('the shipped 5-arg insert call still succeeds through PostgREST (proves no ambiguous overload) and mirrors screenshots → attachments', async () => {
    // Exactly how the live TechFeedback.jsx calls it today — five params,
    // screenshots as a JSON string, paths carrying the job-files/ bucket prefix.
    const legacyPath = `job-files/feedback/${employeeId}/${runId}-legacy.jpg`;
    const row = await db.rpc('insert_tech_feedback', {
      p_employee_id: employeeId,
      p_type: 'bug',
      p_title: `[test ${runId}] legacy caller`,
      p_description: 'Phase F compat check — safe to delete',
      p_screenshots: JSON.stringify([legacyPath]),
    });
    createdIds.push(row.id);

    expect(row.screenshots).toEqual([legacyPath]);
    // New columns exist and the old-style call fills them:
    expect(row.source).toBe('tech');
    // Mirrored attachments are {path}-only records with the bucket prefix stripped.
    expect(row.attachments).toEqual([
      { path: `feedback/${employeeId}/${runId}-legacy.jpg` },
    ]);
    expect(row.resolved_at).toBeNull();
    expect(row.attachments_purged_at).toBeNull();
  });

  it('a new 7-arg desktop submission mirrors image attachments → screenshots (video excluded, bucket prefix added)', async () => {
    const imagePath = `feedback/${employeeId}/${runId}-photo.jpg`;
    const videoPath = `feedback/${employeeId}/${runId}-clip.mp4`;
    const attachments = [
      { path: imagePath, name: 'photo.jpg', mime: 'image/jpeg', size: 120000, original_size: 480000, width: 1920, height: 1080 },
      { path: videoPath, name: 'clip.mp4', mime: 'video/mp4', size: 900000, original_size: 900000, duration: 12.5 },
    ];
    const row = await db.rpc('insert_tech_feedback', {
      p_employee_id: employeeId,
      p_type: 'feature',
      p_title: `[test ${runId}] desktop caller`,
      p_description: null,
      p_attachments: attachments,
      p_source: 'desktop',
    });
    createdIds.push(row.id);

    expect(row.source).toBe('desktop');
    expect(row.attachments).toEqual(attachments);
    // Only the image is mirrored, with the job-files/ prefix the live
    // AdminFeedback.jsx needs to render it — the video is not a screenshot.
    expect(row.screenshots).toEqual([`job-files/${imagePath}`]);
  });

  it('get_tech_feedback returns the new columns for every row', async () => {
    const rows = await db.rpc('get_tech_feedback');
    const mine = rows.find(r => r.id === createdIds[0]);
    expect(mine).toBeTruthy();
    for (const key of ['attachments', 'source', 'resolved_at', 'attachments_purged_at']) {
      expect(key in mine).toBe(true);
    }
    expect(mine.source).toBe('tech');
    expect(mine.resolved_at).toBeNull();
  });

  it('update_tech_feedback stamps resolved_at once, keeps it terminal↔terminal, and clears it on reopen', async () => {
    const id = createdIds[0];

    const resolved = await db.rpc('update_tech_feedback', { p_id: id, p_status: 'resolved' });
    expect(resolved.resolved_at).toBeTruthy();
    const firstStamp = resolved.resolved_at;

    // terminal → terminal keeps the original stamp
    const dismissed = await db.rpc('update_tech_feedback', { p_id: id, p_status: 'dismissed' });
    expect(dismissed.resolved_at).toBe(firstStamp);

    // reopen clears it
    const reopened = await db.rpc('update_tech_feedback', { p_id: id, p_status: 'reviewed' });
    expect(reopened.resolved_at).toBeNull();

    // a later re-resolve stamps fresh
    const reResolved = await db.rpc('update_tech_feedback', { p_id: id, p_status: 'resolved' });
    expect(reResolved.resolved_at).toBeTruthy();
  });

  it('get_purgeable_feedback_media clamps eligibility to ≥30 days — a freshly resolved row is never purgeable, even at p_days=0', async () => {
    const rows = await db.rpc('get_purgeable_feedback_media', { p_days: 0 });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some(r => r.id === createdIds[0])).toBe(false);

    // default-arg call works too (the future cron endpoint calls it bare)
    const defaultRows = await db.rpc('get_purgeable_feedback_media');
    expect(Array.isArray(defaultRows)).toBe(true);
  });

  it('purge boundary: 91-day-old resolved row IS purgeable at the default 90, an 89-day-old one is NOT (own ids only)', async () => {
    const id = createdIds[0]; // currently resolved (from the resolved_at test above)
    const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();

    // RLS on tech_feedback is wide-open by design, so the anon client may age
    // the row directly — exactly what the purge worker's clock will see.
    await db.update('tech_feedback', `id=eq.${id}`, { resolved_at: daysAgo(91) });
    const old = await db.rpc('get_purgeable_feedback_media', { p_days: 90 });
    expect(old.some(r => r.id === id)).toBe(true);

    await db.update('tech_feedback', `id=eq.${id}`, { resolved_at: daysAgo(89) });
    const fresh = await db.rpc('get_purgeable_feedback_media', { p_days: 90 });
    expect(fresh.some(r => r.id === id)).toBe(false);
  });

  it('a purged row never reappears in the purgeable list, no matter how old', async () => {
    const id = createdIds[0];
    await db.update('tech_feedback', `id=eq.${id}`, {
      resolved_at: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await db.rpc('mark_feedback_attachments_purged', { p_id: id });
    const rows = await db.rpc('get_purgeable_feedback_media', { p_days: 90 });
    expect(rows.some(r => r.id === id)).toBe(false);
  });

  it('mark_feedback_attachments_purged stamps once, and status updates never clear it', async () => {
    const id = createdIds[0];

    const purged = await db.rpc('mark_feedback_attachments_purged', { p_id: id });
    expect(purged.attachments_purged_at).toBeTruthy();
    const firstStamp = purged.attachments_purged_at;

    // idempotent — a second call keeps the first stamp
    const again = await db.rpc('mark_feedback_attachments_purged', { p_id: id });
    expect(again.attachments_purged_at).toBe(firstStamp);

    // admin status churn never clears the purge stamp
    const updated = await db.rpc('update_tech_feedback', { p_id: id, p_status: 'dismissed' });
    expect(updated.attachments_purged_at).toBe(firstStamp);
  });
});
