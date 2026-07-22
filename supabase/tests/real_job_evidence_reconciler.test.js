/**
 * ════════════════════════════════════════════════
 * FILE: real_job_evidence_reconciler.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the "evidence reconciler" report (get_real_job_evidence_mismatches)
 *   catches both ways the canonical sale flag can drift from its own evidence:
 *   (a) a job with a real QuickBooks-synced invoice that is nonetheless flagged
 *   "not a real job" shows up as 'evidence_unflagged' (the exact drift a
 *   2026-07-03 bulk demotion caused on 13 production jobs), (b) a job flagged
 *   real with zero evidence on file shows up as 'flagged_no_evidence', and
 *   (c) fixing the flag makes the job disappear from the report — the report
 *   only ever lists genuine disagreements.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file, not a screen)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/supabase.js (unauthenticated REST client — fine for a
 *              script/test, not a component; see CLAUDE.md rule 3)
 *   Data:      reads  → get_real_job_evidence_mismatches RPC
 *              writes → contacts, jobs, invoices (TEST fixtures, best-effort
 *              deleted in afterAll)
 *
 * NOTES / GOTCHAS:
 *   - INTEGRATION test against the live shared Supabase project. Self-skips
 *     via describe.skipIf when VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
 *     absent, same as the other CRM integration suites.
 *   - Finds its OWN fixture rows by job_id in the report — never asserts on
 *     absolute report counts (live prod data has real mismatches in it).
 *   - Test (a) deliberately reproduces the production drift mechanically:
 *     inserting the QBO invoice fires trg_invoice_real_job (job auto-flips to
 *     real), then the test demotes it back to false — exactly what the
 *     2026-07-03 bulk demotion did — and the reconciler must catch it, with
 *     was_demoted=true (real_job_marked_at left behind by mark_job_real).
 *   - Every job auto-gets a DRAFT invoice on creation (trg_create_draft_invoice,
 *     qbo_invoice_id NULL) — that must NOT count as evidence, which test (b)
 *     implicitly proves (its job has only the auto-draft and still lands in
 *     'flagged_no_evidence').
 * ════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../src/lib/supabase.js';

const hasCreds = !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

describe.skipIf(!hasCreds)('real-job evidence reconciler (integration)', () => {
  const runId = Date.now();
  let contactId;
  let demotedJobId;   // test (a)/(c): QBO invoice evidence, demoted to false
  let noEvidenceJobId; // test (b): flagged real, zero evidence
  const jobIds = [];
  const contactIds = [];

  const findRow = (rows, jobId) =>
    (rows || []).find((r) => r.job_id === jobId);

  beforeAll(async () => {
    const [contact] = await db.insert('contacts', {
      name: `zz Evidence Reconciler ${runId}`,
      phone: `+1801${String(runId).slice(-7)}`,
    });
    contactId = contact.id;
    contactIds.push(contact.id);
  });

  afterAll(async () => {
    // Best-effort cleanup: invoices first (incl. the auto-created drafts),
    // then jobs, then the contact.
    try {
      if (jobIds.length) await db.delete('invoices', `job_id=in.(${jobIds.join(',')})`);
    } catch { /* best-effort */ }
    try {
      if (jobIds.length) await db.delete('jobs', `id=in.(${jobIds.join(',')})`);
    } catch { /* best-effort */ }
    try {
      if (contactIds.length) await db.delete('contacts', `id=in.(${contactIds.join(',')})`);
    } catch { /* best-effort */ }
  });

  it('(a) a job with a QBO invoice but is_real_job=false appears as evidence_unflagged', async () => {
    const [job] = await db.insert('jobs', {
      primary_contact_id: contactId,
      phase: 'job_received',
      status: 'active',
      is_real_job: false,
      division: 'water',
      insured_name: `zz-recon-demoted-${runId}`,
    });
    demotedJobId = job.id;
    jobIds.push(job.id);

    // A real (QBO-synced) invoice — this fires trg_invoice_real_job, so the
    // job auto-flips to is_real_job=true with source='invoice'.
    await db.insert('invoices', {
      job_id: job.id,
      contact_id: contactId,
      invoice_number: `RECON-${runId}`,
      status: 'draft',
      total: 1200,
      qbo_invoice_id: `TEST-QBO-${runId}`,
    });

    // Reproduce the production drift: demote the flag while the evidence
    // stays on file (the 2026-07-03 bulk-demotion scenario). mark_job_real's
    // real_job_marked_at stamp stays behind — the demotion signature.
    await db.update('jobs', `id=eq.${job.id}`, { is_real_job: false });

    const rows = await db.rpc('get_real_job_evidence_mismatches', {});
    const row = findRow(rows, job.id);
    expect(row).toBeTruthy();
    expect(row.category).toBe('evidence_unflagged');
    expect(row.evidence).toContain('invoice');
    expect(Number(row.invoiced_total)).toBe(1200);
    expect(row.was_demoted).toBe(true);
    expect(row.contact_name).toBe(`zz Evidence Reconciler ${runId}`);
  });

  it('(b) a job flagged real with zero evidence appears as flagged_no_evidence', async () => {
    const [job] = await db.insert('jobs', {
      primary_contact_id: contactId,
      phase: 'job_received',
      status: 'active',
      is_real_job: true,
      real_job_source: 'manual',
      real_job_marked_at: new Date().toISOString(),
      division: 'water',
      insured_name: `zz-recon-noev-${runId}`,
    });
    noEvidenceJobId = job.id;
    jobIds.push(job.id);

    const rows = await db.rpc('get_real_job_evidence_mismatches', {});
    const row = findRow(rows, job.id);
    expect(row).toBeTruthy();
    expect(row.category).toBe('flagged_no_evidence');
    expect(row.real_job_source).toBe('manual');
    // The auto-created DRAFT invoice (qbo_invoice_id NULL) did not count as
    // evidence — otherwise this job would not be in this bucket at all.
  });

  it('(c) marking the demoted job real again removes it from the report', async () => {
    const before = await db.rpc('get_real_job_evidence_mismatches', {});
    expect(findRow(before, demotedJobId)).toBeTruthy(); // still drifted

    // Fix the flag to agree with its evidence.
    await db.update('jobs', `id=eq.${demotedJobId}`, { is_real_job: true });

    const after = await db.rpc('get_real_job_evidence_mismatches', {});
    // Flag now agrees with evidence → matches NEITHER category.
    expect(findRow(after, demotedJobId)).toBeUndefined();
    // The unrelated no-evidence fixture is untouched and still reported.
    expect(findRow(after, noEvidenceJobId)).toBeTruthy();
  });
});
