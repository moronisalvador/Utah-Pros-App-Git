/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase8_sequences.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the four drip-sequence database functions of CRM Phase 8 hold against
 *   the real database:
 *     1. You can build a sequence with ordered steps, read it back with those
 *        steps in order, and a status-only edit (pause/activate) never wipes the
 *        steps you already wrote.
 *     2. Enrolling the same person in the same sequence twice creates ONE
 *        enrollment, never a duplicate (the UNIQUE guarantee the drip relies on).
 *     3. Enrolling a saved segment enrolls exactly the people that segment
 *        matches — and nobody it doesn't.
 *     4. Deleting a sequence takes its steps and enrollments with it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs, crm_sequences/steps/enrollments (via RPCs)
 *              writes → crm_sequences (+ cascade), crm_segments, contacts
 *              (all TEST-tagged; sequences + segments cleaned in afterAll).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites (CI's `npm test` passes no secrets).
 *   - anon has no DELETE policy on contacts, so the handful of TEST contacts are
 *     best-effort-deleted; every contact is name-prefixed `zz8-` for a later
 *     sweep. Sequences (and their cascaded steps/enrollments) delete cleanly via
 *     delete_sequence.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 8 — drip sequences CRUD, enrollment idempotency, segment enroll (integration)', () => {
  const runId = Date.now();
  let orgId;
  const createdContactIds = [];
  const sequenceIds = [];
  const segmentIds = [];

  const mkContact = async (fields) => {
    const [row] = await db.insert('contacts', { name: `zz8-${runId}`, ...fields });
    createdContactIds.push(row.id);
    return row;
  };

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    for (const id of sequenceIds) { try { await db.rpc('delete_sequence', { p_sequence_id: id }); } catch { /* best effort */ } }
    for (const id of segmentIds) { try { await db.rpc('delete_segment', { p_segment_id: id }); } catch { /* best effort */ } }
    for (const id of createdContactIds) { try { await db.delete('contacts', `id=eq.${id}`); } catch { /* anon can't delete contacts */ } }
  });

  const mkSequence = async (steps, extra = {}) => {
    const seq = await db.rpc('upsert_sequence', {
      p_name: `zz8 seq ${runId}-${sequenceIds.length}`,
      p_description: 'Phase 8 integration test',
      p_status: 'active',
      p_steps: steps,
      p_org_id: orgId,
      ...extra,
    });
    sequenceIds.push(seq.id);
    return seq;
  };

  // ─── 1. Build → read back with ordered steps; status edit preserves steps ────
  it('creates a sequence with ordered steps and reads it back', async () => {
    const seq = await mkSequence([
      { step_order: 0, channel: 'email', delay_hours: 0, subject: 'Hi', body: 'Welcome {{name}}' },
      { step_order: 1, channel: 'email', delay_hours: 48, subject: 'Still here', body: 'Following up' },
      { step_order: 2, channel: 'sms', delay_hours: 72, body: 'Quick text' },
    ]);
    expect(seq.id).toBeTruthy();
    expect(seq.status).toBe('active');

    const all = await db.rpc('get_sequences', { p_org_id: orgId });
    const got = all.find((s) => s.id === seq.id);
    expect(got).toBeTruthy();
    expect(got.steps.map((s) => s.step_order)).toEqual([0, 1, 2]);
    expect(got.steps[0].channel).toBe('email');
    expect(got.steps[0].delay_hours).toBe(0);
    expect(got.steps[2].channel).toBe('sms');
    expect(got.steps[1].delay_hours).toBe(48);
    expect(got.stats.total).toBe(0);
  });

  it('a status-only edit (p_steps null) pauses without wiping steps', async () => {
    const seq = await mkSequence([
      { step_order: 0, channel: 'email', delay_hours: 0, subject: 'Hi', body: 'Hello' },
      { step_order: 1, channel: 'email', delay_hours: 24, subject: 'Bump', body: 'Bump' },
    ]);
    const paused = await db.rpc('upsert_sequence', { p_id: seq.id, p_status: 'paused', p_steps: null });
    expect(paused.status).toBe('paused');

    const all = await db.rpc('get_sequences', { p_org_id: orgId });
    const got = all.find((s) => s.id === seq.id);
    expect(got.steps.length).toBe(2); // steps survived the status-only edit
  });

  // ─── 2. Enrollment idempotency (UNIQUE sequence + contact) ───────────────────
  it('enrolling the same contact twice yields exactly one enrollment', async () => {
    const seq = await mkSequence([{ step_order: 0, channel: 'email', delay_hours: 0, subject: 'x', body: 'y' }]);
    const c = await mkContact({ phone: `+180${String(runId).slice(-8)}`, email: `zz8.dup.${runId}@example.com` });

    const first = await db.rpc('enroll_in_sequence', { p_sequence_id: seq.id, p_contact_id: c.id, p_org_id: orgId });
    const second = await db.rpc('enroll_in_sequence', { p_sequence_id: seq.id, p_contact_id: c.id, p_org_id: orgId });

    expect(Array.isArray(first)).toBe(true);
    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
    expect(second[0].id).toBe(first[0].id); // same enrollment row, not a new one

    const rows = await db.select('crm_sequence_enrollments', `sequence_id=eq.${seq.id}&contact_id=eq.${c.id}&select=id`);
    expect(rows.length).toBe(1);
    // first step delay 0 → due immediately
    expect(first[0].next_run_at).toBeTruthy();
    expect(first[0].current_step).toBe(0);
    expect(first[0].status).toBe('active');
  });

  // ─── 3. Enroll a segment: exactly the matching contacts, nobody else ─────────
  it('enrolling a segment enrolls the matching contacts only', async () => {
    const marker = `zz8-seg-${runId}`;
    const a = await mkContact({ phone: `+181${String(runId).slice(-8)}`, referral_source: marker });
    const b = await mkContact({ phone: `+182${String(runId).slice(-8)}`, referral_source: marker });
    // A non-matching contact with a different referral source — must NOT be enrolled.
    const other = await mkContact({ phone: `+183${String(runId).slice(-8)}`, referral_source: `nope-${runId}` });

    const seg = await db.rpc('upsert_segment', {
      p_name: `zz8 segment ${runId}`, p_filter: { referral_source: marker }, p_org_id: orgId,
    });
    segmentIds.push(seg.id);

    const seq = await mkSequence([{ step_order: 0, channel: 'email', delay_hours: 0, subject: 'x', body: 'y' }]);
    const enrolled = await db.rpc('enroll_in_sequence', { p_sequence_id: seq.id, p_segment_id: seg.id, p_org_id: orgId });

    const ids = enrolled.map((e) => e.contact_id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(other.id);

    // get_sequences stats reflect the two active enrollments.
    const all = await db.rpc('get_sequences', { p_org_id: orgId });
    const got = all.find((s) => s.id === seq.id);
    expect(got.stats.active).toBeGreaterThanOrEqual(2);
    expect(got.stats.total).toBeGreaterThanOrEqual(2);
  });

  // ─── 4. Delete cascades steps + enrollments ──────────────────────────────────
  it('deleting a sequence removes its steps and enrollments', async () => {
    const seq = await mkSequence([{ step_order: 0, channel: 'email', delay_hours: 0, subject: 'x', body: 'y' }]);
    const c = await mkContact({ phone: `+184${String(runId).slice(-8)}` });
    await db.rpc('enroll_in_sequence', { p_sequence_id: seq.id, p_contact_id: c.id, p_org_id: orgId });

    await db.rpc('delete_sequence', { p_sequence_id: seq.id });
    sequenceIds.splice(sequenceIds.indexOf(seq.id), 1); // already gone

    const steps = await db.select('crm_sequence_steps', `sequence_id=eq.${seq.id}&select=id`);
    const enrollments = await db.select('crm_sequence_enrollments', `sequence_id=eq.${seq.id}&select=id`);
    expect(steps.length).toBe(0);
    expect(enrollments.length).toBe(0);
  });
});
