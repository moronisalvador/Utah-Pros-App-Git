/**
 * ════════════════════════════════════════════════
 * FILE: job-files-bucket-private.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the promises of the second job-file privacy change — the one that
 *   stops the shared file store answering strangers — and, just as important,
 *   proves that no screen in the app still builds one of the old open
 *   addresses. Needs no database password: it reads the project's own source.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  the Phase 2 migration + rollback, the signing helper and hook,
 *              and every surface that used to build a public URL
 *   Data:      none (reads repository source only)
 *
 * NOTES / GOTCHAS:
 *   - THIS PROVES INTENT, NOT EFFECT. It reads SQL and JSX as text. Whether
 *     the live policies actually admit an employee and refuse everyone else is
 *     a per-role behavioural question, and it belongs to
 *     scripts/qa/qualify-job-files-private-local.mjs
 *     (database-standard.md §5b). Never present this file as that proof.
 *   - The repo-wide sweep below is the load-bearing test. The migration can be
 *     perfect and the flip still breaks the app if one <img src> is left
 *     building /object/public/. That is precisely the failure this change
 *     exists to avoid, so it is asserted over the whole tree rather than over
 *     a hand-kept file list that would go stale.
 * ════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const MIGRATION = 'supabase/migrations/20260820010000_job_files_bucket_private.sql';
const ROLLBACK = 'supabase/rollbacks/20260820010000_job_files_bucket_private.rollback.sql';
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
// SQL with `--` comments removed. Needed because this migration DISCUSSES the
// grants it is closing ("anon_read_job_files grants SELECT to anon outright"),
// and a case-insensitive search for a grant would otherwise match the sentence
// explaining why there is no grant.
const migrationSql = migration.replace(/^\s*--.*$/gm, '');

function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(rel);
  }
  return out;
}

describe('job-files bucket flip — migration contract', () => {
  it('drops BOTH public read policies, not just the anon one', () => {
    // job_files_select is granted TO public, which includes anon. Dropping
    // only anon_read_job_files would leave the bucket readable by the anon key
    // that ships in the browser bundle.
    expect(migration).toMatch(/DROP POLICY IF EXISTS anon_read_job_files ON storage\.objects/);
    expect(migration).toMatch(/DROP POLICY IF EXISTS job_files_select ON storage\.objects/);
  });

  it('flips the bucket flag as well as the policies', () => {
    // Policies alone are not enough: while public is true the
    // /object/public/ route bypasses RLS entirely.
    expect(migration).toMatch(/UPDATE storage\.buckets SET public = false WHERE id = 'job-files'/);
  });

  it('creates the employee read policy BEFORE dropping the public ones', () => {
    // Ordering is the whole reason there is no outage window: minting a signed
    // URL is a SELECT check, so employees must have a policy at every instant.
    const created = migration.indexOf('CREATE POLICY job_files_authenticated_read');
    const dropped = migration.indexOf('DROP POLICY IF EXISTS anon_read_job_files');
    expect(created).toBeGreaterThan(-1);
    expect(dropped).toBeGreaterThan(-1);
    expect(created).toBeLessThan(dropped);
  });

  it('scopes the new policy to an active internal employee, not merely a session', () => {
    // AGENTS.md §16: a valid session is authentication, not authorization. The
    // predicate is deliberately identical to Phase 1's private-bucket policy so
    // both buckets answer to one definition of "an employee".
    expect(migration).toContain('FOR SELECT\n  TO authenticated');
    expect(migration).toContain('employee.auth_user_id = auth.uid()');
    expect(migration).toContain('employee.is_active IS TRUE');
    expect(migration).toContain('employee.is_external IS FALSE');
    expect(migrationSql).not.toMatch(/CREATE POLICY[\s\S]{0,400}?\bTO\b[^;]*\banon\b/i);
  });

  it('grants nothing to anon and creates no new function', () => {
    expect(migrationSql).not.toMatch(/GRANT[\s\S]{0,200}?\bTO\b[^;]*\banon\b/i);
    expect(migrationSql).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it('aborts instead of guessing when the catalog has drifted', () => {
    expect(migration).toContain("ERRCODE = '55000'");
    expect(migration).toMatch(/WHERE id = 'job-files' AND public IS TRUE/);
    // Phase 1 is a hard prerequisite, not an ordering coincidence.
    expect(migration).toContain("MESSAGE = 'job-documents-private is absent — Phase 1 has not been applied'");
  });

  it('leaves the out-of-scope write policies alone, and proves it did', () => {
    // roadmap §8: any authenticated employee can still delete any object here.
    // Real, pre-existing, its own change. R3 from the same roadmap: importing a
    // known defect into a privacy migration is how one ships a security bug.
    expect(migrationSql).not.toMatch(/DROP POLICY[^;]*job_files_authenticated_(insert|delete)/i);
    expect(migrationSql).not.toMatch(/CREATE POLICY job_files_authenticated_(insert|delete)/i);
    expect(migration).toContain("AND policyname IN ('job_files_authenticated_insert', 'job_files_authenticated_delete')");
  });

  it('names its own prerequisites so they cannot be skipped quietly', () => {
    expect(migration).toContain('§5b');
    expect(migration).toContain('JOB_FILES_LEGACY_PUBLIC_MMS');   // the R4 soak
    expect(migration).toMatch(/DEPLOY ORDER — CODE FIRST/);
  });
});

describe('job-files bucket flip — rollback', () => {
  it('restores both policies and the public flag', () => {
    expect(rollback).toMatch(/CREATE POLICY anon_read_job_files[\s\S]*?TO anon[\s\S]*?USING \(bucket_id = 'job-files'\)/);
    expect(rollback).toMatch(/CREATE POLICY job_files_select[\s\S]*?TO public[\s\S]*?USING \(bucket_id = 'job-files'\)/);
    expect(rollback).toMatch(/UPDATE storage\.buckets SET public = true WHERE id = 'job-files'/);
  });

  it('removes the forward policy so a RE-APPLY cannot fail on "already exists"', () => {
    // A re-apply happens during an incident. That is the worst moment for a
    // surprising error, so the rollback leaves a cleanly re-appliable state.
    expect(rollback).toMatch(/DROP POLICY IF EXISTS job_files_authenticated_read ON storage\.objects/);
  });

  it('carries the -- public: marker its anon grant requires', () => {
    expect(rollback).toMatch(/--\s*public:\s*\S+/);
  });

  it('says out loud that it re-opens the exposure', () => {
    expect(rollback).toContain('RE-OPENS THE EXPOSURE');
  });
});

describe('no source builds a public job-files URL', () => {
  // The load-bearing assertion. Swept over the tree, not a file list.
  const files = [...walk('src'), ...walk('functions')].filter((f) => !/\.test\.jsx?$/.test(f));

  it('finds no /object/public/ or /render/image/public/ construction in live code', () => {
    const offenders = [];
    for (const file of files) {
      const body = read(file);
      // Strip line and block comments: several files legitimately DISCUSS the
      // old route in a header, and a prose mention is not a URL being built.
      const code = body
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*(\/\/|\*).*$/gm, '');
      if (/object\/public\/|render\/image\/public\//.test(code)) offenders.push(file);
    }
    // functions/lib/message-media.js is the one permitted hit: it PARSES the
    // legacy inbound reference (it does not build a URL for a reader), and it
    // is deleted in the same change that flips the bucket, once the R4 soak
    // comes back cold.
    expect(offenders).toEqual(['functions/lib/message-media.js']);
  });

  it('keeps the R4 soak marker on the one branch that hands Twilio a public URL', () => {
    expect(read('functions/lib/message-media.js')).toContain('JOB_FILES_LEGACY_PUBLIC_MMS');
    expect(read('functions/lib/messaging-transport.js')).toContain('JOB_FILES_LEGACY_PUBLIC_MMS_SENT');
  });

  it('routes job documents of EITHER bucket through one signed path', () => {
    const helper = read('src/lib/storageUrl.js');
    expect(helper).toMatch(/export async function jobDocumentUrl[\s\S]{0,300}?signedDocUrl\(/);
    // publicDocUrl is gone, so there is nothing left to reach for.
    expect(helper).not.toMatch(/export function publicDocUrl/);
  });

  it('has no public-URL builder left on the photo upload hook', () => {
    const hook = read('src/hooks/usePhotoUpload.js');
    expect(hook).not.toMatch(/export function (publicUrl|thumbUrl)/);
  });
});
