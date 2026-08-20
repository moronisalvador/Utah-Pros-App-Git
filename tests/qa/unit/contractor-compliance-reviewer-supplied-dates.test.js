/**
 * ════════════════════════════════════════════════
 * FILE: contractor-compliance-reviewer-supplied-dates.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the migration that lets a subcontractor send an insurance certificate without typing its
 *   dates, and checks it actually says what it claims: dates optional when the document arrives,
 *   still required before anyone can mark it accepted, and no new way for a stranger to call it.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, vitest
 *   Internal:  supabase/migrations + supabase/rollbacks for 20260819010000
 *   Data:      reads  → source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It reads SQL text; it does not run it. The behavioural proof
 *     belongs in the db lane and to the apply window (close-out-standard.md step 2b).
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolved from this file, not process.cwd() — the sibling contract test does the
// same, and cwd is not a node global eslint grants to this lane.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NAME = '20260819010000_contractor_compliance_reviewer_supplied_dates';
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const migration = read(`supabase/migrations/${NAME}.sql`);
const rollback = read(`supabase/rollbacks/${NAME}.rollback.sql`);

describe('contractor compliance — reviewer-supplied coverage dates', () => {
  it('refuses to run against a drifted constraint', () => {
    // Applying a relaxation on top of an unreviewed predicate could widen
    // something nobody looked at.
    expect(migration).toContain("conname  = 'contractor_compliance_documents_date_check'");
    expect(migration).toContain('8c290ee9197afaabc6bed2a5a25195a7');
    expect(migration).toMatch(/RAISE EXCEPTION 'DRIFT:/);
  });

  it('still requires both ordered dates before a coverage document can be accepted', () => {
    // The accept branch feeds contractor_compliance_continuous_coverage_end(),
    // which reads exactly these columns — NULLs there would silently mark a
    // contractor compliant on an undated certificate.
    expect(migration).toMatch(/WHEN review_state = 'accepted' THEN/);
    expect(migration).toMatch(/coverage_end_date >= coverage_start_date/);
    expect(migration).toContain('coverage start and end dates are required to accept this document');
  });

  it('lets a document arrive with no dates at all, but never with only one', () => {
    expect(migration).toMatch(/coverage_start_date IS NULL AND coverage_end_date IS NULL/);
  });

  it('keeps the deployed 4-argument signature callable', () => {
    // FE-contract freeze (database-standard.md §3): the shipped reviewer UI
    // calls this with four arguments and must keep working.
    expect(migration).toContain('p_coverage_start_date date DEFAULT NULL::date');
    expect(migration).toContain('p_coverage_end_date date DEFAULT NULL::date');
  });

  it('stays service_role-only and explicitly revokes authenticated', () => {
    // This definer trusts a CALLER-SUPPLIED actor id and never binds it to
    // auth.uid(), and employee ids are readable via get_employee_directory — so
    // granting `authenticated` would let any signed-in employee accept, reject
    // or re-date compliance documents under a forged actor. The explicit REVOKE
    // FROM authenticated is required because the baseline carries
    // ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO authenticated.
    const revokeAt = migration.indexOf('REVOKE EXECUTE ON FUNCTION public.contractor_compliance_review_document(uuid, uuid, text, text, date, date) FROM PUBLIC, anon, authenticated;');
    const grantAt = migration.indexOf('GRANT EXECUTE ON FUNCTION public.contractor_compliance_review_document(uuid, uuid, text, text, date, date) TO service_role;');
    expect(revokeAt).toBeGreaterThan(-1);
    expect(grantAt).toBeGreaterThan(revokeAt);
    // Anchored to a statement start: the migration's own comments discuss the
    // `GRANT ALL ON FUNCTIONS TO authenticated` default-privilege hazard, and a
    // loose regex cannot tell that prose from executable SQL.
    expect(migration).not.toMatch(/^\s*GRANT[^;]*TO\s+authenticated/m);
    expect(migration).not.toMatch(/^\s*GRANT[^;]*TO[^;]*\banon\b/m);
  });

  it('drops the superseded 4-argument overload so exactly one function survives', () => {
    // CREATE OR REPLACE does NOT replace across a changed argument list —
    // identity is name + argument types. Without the drop the deployed worker's
    // 4-named-argument call either binds the stale body or fails 42725.
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.contractor_compliance_review_document(uuid, uuid, text, text);');
    expect(migration).toMatch(/--\s*destructive-approved:/);
    expect(migration).toMatch(/POSTCONDITION: expected exactly 1 contractor_compliance_review_document/);
  });

  it('asserts its own postconditions', () => {
    expect(migration).toMatch(/RAISE EXCEPTION 'POSTCONDITION: anon holds EXECUTE'/);
    expect(migration).toMatch(/RAISE EXCEPTION 'POSTCONDITION: authenticated holds EXECUTE'/);
    expect(migration).toMatch(/RAISE EXCEPTION 'POSTCONDITION: service_role lacks EXECUTE'/);
  });

  it('leaves the transaction to the Supabase executor', () => {
    // database-standard.md §5: a top-level BEGIN/COMMIT in a governed forward
    // file breaks the executor's schema_migrations ledger write.
    expect(migration).not.toMatch(/^\s*BEGIN;\s*$/m);
    expect(migration).not.toMatch(/^\s*COMMIT;\s*$/m);
  });

  it('the Worker forwards the reviewer-supplied dates to the six-argument RPC', () => {
    // The migration alone delivers nothing: without these two parameters the
    // reviewer still cannot date a document the contractor left blank.
    const worker = read('functions/api/contractor-compliance-requests.js');
    expect(worker).toContain('p_coverage_start_date: coverageStart');
    expect(worker).toContain('p_coverage_end_date: coverageEnd');
    // Shape-checked before it reaches Postgres, so a malformed value is a 400
    // rather than a constraint violation surfaced as a 500.
    expect(worker).toMatch(/isoDate\.test\(String\(body\.coverage_start_date/);
    expect(worker).toMatch(/coverageEnd < coverageStart/);
  });

  it('the reviewer UI can supply dates, and refuses to accept without them', () => {
    const detail = read('src/pages/ContractorDetail.jsx');
    expect(detail).toContain('coverage_start_date: start');
    expect(detail).toContain('coverage_end_date: end');
    // Non-W-9 only: the constraint requires w9 rows to carry NULL coverage dates.
    expect(detail).toContain("const needsDates = !isW9 && state === 'pending_review'");
    expect(detail).toMatch(/disabled=\{busy \|\| \(needsDates && !datesOk\)\}/);
    // The house date control, not a native input — the lint ratchet is shrink-only.
    expect(detail).toContain("import DatePicker from '@/components/DatePicker'");
  });

  it('the contractor may send a coverage document with no dates, but never half', () => {
    const upload = read('src/pages/ContractorUpload.jsx');
    expect(upload).toContain('!anyDate || (bothDates && !datesOutOfOrder)');
    const lib = read('functions/lib/contractor-compliance.js');
    expect(lib).toContain('if (!start && !end) return { effectiveDate: null, expirationDate: null, taxYear: null };');
  });

  it('ships a rollback that restores both the constraint and the original body', () => {
    expect(rollback).toContain('coverage_start_date IS NOT NULL');
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.contractor_compliance_review_document(uuid, uuid, text, text, date, date)');
    // The rollback must restore the FOUNDATION's ACL, not invent a wider one.
    expect(rollback).toContain('FROM PUBLIC, anon, authenticated;');
    expect(rollback).toContain('(uuid, uuid, text, text) TO service_role;');
    expect(rollback).not.toMatch(/^\s*GRANT[^;]*TO\s+authenticated/m);
    // The restored body must be the 4-argument one, without the date handling.
    expect(rollback).toContain('contractor_compliance_review_document(p_actor_employee_id uuid, p_document_id uuid, p_review_state text, p_rejection_reason text DEFAULT NULL::text)');
    expect(rollback).not.toContain('p_coverage_start_date date DEFAULT');
  });

  it('warns that the rollback can legitimately fail rather than delete documents', () => {
    expect(rollback).toMatch(/RE-TIGHTENS A CONSTRAINT AND CAN FAIL/);
  });
});
