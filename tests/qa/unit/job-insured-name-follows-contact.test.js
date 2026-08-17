/**
 * ════════════════════════════════════════════════
 * FILE: job-insured-name-follows-contact.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the migration that makes a renamed customer's name follow through onto
 *   their jobs, and checks it actually says what it claims to say — that it only
 *   overwrites a job's name when that job was still showing the customer's old
 *   name (or was blank), and never blanket-overwrites every job.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260817030000_job_insured_name_follows_contact.sql
 *              supabase/rollbacks/20260817030000_job_insured_name_follows_contact.rollback.sql
 *   Data:      reads  → the two SQL files as text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It is a source-contract test in a
 *     credential-free lane (close-out-standard.md §2b); it never touches a
 *     database. The behavioural per-role proof belongs in supabase/tests/ and
 *     runs in the db lane.
 *   - The narrow predicate is the whole point of the migration. Ten live jobs
 *     carry a deliberate per-job label under a property-management contact
 *     ("A2Z Properties (Henriquez)" vs contact "A2Z Properties"); a blanket
 *     UPDATE would collapse four different addresses to one string on the
 *     dispatch board. If a future edit widens the predicate, these assertions
 *     are what stops it.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERSION = '20260817030000_job_insured_name_follows_contact';
const MIGRATION_PATH = join(ROOT, 'supabase', 'migrations', `${VERSION}.sql`);
const ROLLBACK_PATH = join(ROOT, 'supabase', 'rollbacks', `${VERSION}.rollback.sql`);

const migration = readFileSync(MIGRATION_PATH, 'utf8');
const rollback = readFileSync(ROLLBACK_PATH, 'utf8');

// Comments carry the reasoning; assertions about SQL must read the SQL only.
const sql = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('20260817030000 job insured_name follows contact — source contract', () => {
  it('ships a paired rollback (database-standard.md §6)', () => {
    expect(existsSync(ROLLBACK_PATH)).toBe(true);
    expect(rollback).toMatch(/DROP TRIGGER IF EXISTS trg_sync_job_insured_name ON public\.contacts/);
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.sync_job_insured_name_from_contact\(\)/);
  });

  it('installs the trigger on contacts, scoped to the name column only', () => {
    expect(sql).toMatch(/AFTER UPDATE OF name ON public\.contacts/);
    expect(sql).toMatch(/FOR EACH ROW/);
    // No-op renames must not fan out an UPDATE across every job on the contact.
    expect(sql).toMatch(/WHEN \(NEW\.name IS DISTINCT FROM OLD\.name\)/);
  });

  it('updates ONLY jobs whose snapshot tracked the old name, or was blank', () => {
    expect(sql).toMatch(/WHERE\s+primary_contact_id = NEW\.id/);
    expect(sql).toMatch(/insured_name IS NOT DISTINCT FROM OLD\.name/);
    expect(sql).toMatch(/NULLIF\(btrim\(COALESCE\(insured_name, ''\)\), ''\) IS NULL/);
  });

  it('refuses to cascade a blank or NULL name', () => {
    // Regression guard. `contacts.name` is nullable and JobPage's Client
    // Information tile wrote NULL when its Name field was cleared, so without
    // this early return one stray clear blanks every sibling job at once —
    // contact "A2Z Properties" carries 26 of them. Caught in review of this
    // migration before it was applied.
    expect(sql).toMatch(/IF NEW\.name IS NULL OR btrim\(NEW\.name\) = ''\s+THEN\s+RETURN NULL;\s+END IF;/);
    // The guard must come BEFORE the UPDATE, or it guards nothing.
    expect(sql.indexOf('IF NEW.name IS NULL')).toBeLessThan(sql.indexOf('UPDATE public.jobs'));
  });

  it('never blanket-overwrites every job on the contact', () => {
    // The naive predicate destroys the deliberate per-job labels. Assert that no
    // UPDATE of insured_name is qualified by primary_contact_id alone.
    const updates = sql.match(/UPDATE\s+public\.jobs[\s\S]*?;/g) || [];
    expect(updates).toHaveLength(1);
    for (const stmt of updates) {
      expect(stmt).toMatch(/insured_name IS NOT DISTINCT FROM OLD\.name/);
    }
  });

  it('is least-privilege: SECURITY INVOKER with a pinned search_path', () => {
    // Read the declaration only. The postcondition block names "SECURITY DEFINER"
    // inside a RAISE message, so a whole-file scan would match its own guard.
    const header = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.sync_job_insured_name_from_contact'),
      sql.indexOf('AS $$'),
    );
    expect(header).toMatch(/SECURITY INVOKER/);
    expect(header).toMatch(/SET search_path = public/);
    expect(header).not.toMatch(/SECURITY DEFINER/);
  });

  it('grants nothing and touches no anon/public role', () => {
    expect(sql).not.toMatch(/\bGRANT\b/);
    expect(sql).not.toMatch(/\banon\b/);
  });

  it('is additive-only: no table, column, policy or row change', () => {
    expect(sql).not.toMatch(/\bALTER TABLE\b/);
    expect(sql).not.toMatch(/\bDROP TABLE\b/);
    expect(sql).not.toMatch(/\bDROP COLUMN\b/);
    expect(sql).not.toMatch(/\bCREATE POLICY\b/);
    expect(sql).not.toMatch(/\bDROP POLICY\b/);
    // The only DROP is the idempotent trigger guard immediately before CREATE TRIGGER.
    const drops = sql.match(/DROP\s+\w+/g) || [];
    expect(drops).toEqual(['DROP TRIGGER']);
  });

  it('does not silently repair the 32 already-drifted rows', () => {
    // Those need owner judgement (a stale copy and a deliberate label are
    // indistinguishable to SQL). A bare data UPDATE here would rename live jobs.
    expect(sql).not.toMatch(/UPDATE\s+public\.jobs[\s\S]*?WHERE[\s\S]*?insured_name\s*(<>|!=)\s*/);
    expect(sql).not.toMatch(/\bINSERT INTO\b/);
  });

  it('leaves the consent-adjacent denormalized columns alone', () => {
    expect(sql).not.toMatch(/client_phone/);
    expect(sql).not.toMatch(/client_email/);
  });

  it('verifies its own installation with postconditions', () => {
    expect(sql).toMatch(/postcondition failed: trigger trg_sync_job_insured_name/);
    expect(sql).toMatch(/postcondition failed: sync_job_insured_name_from_contact/);
  });
});
