/**
 * ════════════════════════════════════════════════
 * FILE: crm_phase6b_import_ownership.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the three ownership/import promises of CRM Phase 6b hold against the
 *   real database:
 *     1. import_contacts de-duplicates on the way in — importing a row whose
 *        phone (or email) already belongs to a contact UPDATES that contact
 *        instead of creating a second one, and every import writes an audit
 *        row into crm_import_batches with honest created/updated counts.
 *     2. Two rows in the SAME file sharing an email collapse to one contact.
 *     3. set_contact_owner / set_contact_lifecycle change the contact AND write
 *        a system_events audit row; an unknown lifecycle value is rejected.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → crm_orgs, contacts, crm_import_batches, system_events ·
 *              writes → contacts (via import_contacts), crm_import_batches,
 *              system_events (all TEST-tagged; batches cleaned in afterAll).
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase; self-skips without
 *     creds like the other CRM suites (CI's `npm test` passes no secrets).
 *   - anon has no DELETE policy on contacts (only authenticated does), so the
 *     handful of TEST contacts here are best-effort-deleted — same accepted
 *     convention as crm_phase6a. Every contact is name-prefixed `zz6b-`.
 *   - anon can delete crm_import_batches (org-scoped audit rows) — those ARE
 *     cleaned up so no TEST-org import rows linger (close-out requirement).
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('CRM Phase 6b — import dedupe + ownership setters (integration)', () => {
  const runId = Date.now();
  let orgId;
  const createdContactIds = [];
  const batchIds = [];

  const digits = (p) => (p || '').replace(/[^0-9]/g, '').slice(-10);

  beforeAll(async () => {
    const [org] = await db.select('crm_orgs', 'is_test=eq.true&limit=1');
    orgId = org.id;
  });

  afterAll(async () => {
    for (const id of batchIds) await db.delete('crm_import_batches', `id=eq.${id}`);
    for (const id of createdContactIds) await db.delete('contacts', `id=eq.${id}`); // best-effort (anon)
  });

  // ─── 1. Dedupe-on-import against an existing contact ──────────────
  it('imports against an existing phone as an UPDATE, never a duplicate', async () => {
    const phone = `+1590${String(runId).slice(-7)}`;
    const [existing] = await db.insert('contacts', { name: `zz6b-${runId}`, phone });
    createdContactIds.push(existing.id);

    const beforeCount = (await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}&select=id`)).length;

    // Same number, differently formatted — must normalize to the same contact.
    const batch = await db.rpc('import_contacts', {
      p_rows: [{ phone: phone.replace('+1', '1-'), email: `zz6b.imp.${runId}@example.com`, company: 'Imported Co' }],
      p_org_id: orgId,
      p_filename: `dedupe-${runId}.csv`,
    });
    batchIds.push(batch.id);

    expect(batch.total_rows).toBe(1);
    expect(batch.updated_count).toBe(1);
    expect(batch.created_count).toBe(0);

    const rows = await db.select('contacts', `phone=eq.${encodeURIComponent(phone)}&select=id,company`);
    expect(rows.length).toBe(beforeCount); // no new contact created
    // Fill-blanks: the empty company got populated, the existing name kept.
    expect(rows.some(r => r.company === 'Imported Co')).toBe(true);
  });

  // ─── 2. Within-file dedupe (two rows, one email) ──────────────
  it('collapses two rows sharing an email in the same file to one contact', async () => {
    const email = `zz6b.same.${runId}@example.com`;
    const batch = await db.rpc('import_contacts', {
      p_rows: [
        { name: `zz6b-a-${runId}`, email, phone: `+1591${String(runId).slice(-7)}` },
        { name: `zz6b-b-${runId}`, email: `  ${email.toUpperCase()}  ` }, // caps + spaces, no phone
      ],
      p_org_id: orgId,
      p_filename: `within-${runId}.csv`,
    });
    batchIds.push(batch.id);

    expect(batch.total_rows).toBe(2);
    expect(batch.created_count).toBe(1);
    expect(batch.updated_count).toBe(1);

    const rows = await db.select('contacts', `email=eq.${encodeURIComponent(email)}&select=id`);
    for (const r of rows) createdContactIds.push(r.id);
    expect(rows.length).toBe(1); // exactly one contact for the shared email
  });

  // ─── 3. A row with neither phone nor email is skipped, not created ──────────────
  it('skips an unmatchable row and records it in the batch errors', async () => {
    const batch = await db.rpc('import_contacts', {
      p_rows: [{ name: `zz6b-noid-${runId}`, company: 'No contact info' }],
      p_org_id: orgId,
      p_filename: `skip-${runId}.csv`,
    });
    batchIds.push(batch.id);
    expect(batch.total_rows).toBe(1);
    expect(batch.created_count).toBe(0);
    expect(batch.skipped_count).toBe(1);
    expect(Array.isArray(batch.errors)).toBe(true);
    expect(batch.errors.length).toBe(1);
  });

  // ─── 4. Owner setter + audit event ──────────────
  it('set_contact_owner assigns an employee and logs an audit event', async () => {
    const [c] = await db.insert('contacts', { name: `zz6b-own-${runId}`, phone: `+1592${String(runId).slice(-7)}` });
    createdContactIds.push(c.id);
    const [emp] = await db.select('employees', 'is_active=eq.true&select=id&limit=1');

    const updated = await db.rpc('set_contact_owner', { p_contact_id: c.id, p_owner_id: emp.id });
    expect(updated.owner_id).toBe(emp.id);

    const events = await db.select('system_events',
      `event_type=eq.crm_contact_owner_set&entity_id=eq.${c.id}&select=payload`);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].payload.owner_id).toBe(emp.id);
  });

  // ─── 5. Lifecycle setter + validation + audit event ──────────────
  it('set_contact_lifecycle sets a known stage, logs it, and rejects junk', async () => {
    const [c] = await db.insert('contacts', { name: `zz6b-life-${runId}`, phone: `+1593${String(runId).slice(-7)}` });
    createdContactIds.push(c.id);

    const updated = await db.rpc('set_contact_lifecycle', { p_contact_id: c.id, p_lifecycle_status: 'customer' });
    expect(updated.lifecycle_status).toBe('customer');

    const events = await db.select('system_events',
      `event_type=eq.crm_contact_lifecycle_set&entity_id=eq.${c.id}&select=payload`);
    expect(events.some(e => e.payload.lifecycle_status === 'customer')).toBe(true);

    await expect(
      db.rpc('set_contact_lifecycle', { p_contact_id: c.id, p_lifecycle_status: 'not-a-real-stage' })
    ).rejects.toBeTruthy();
  });
});
