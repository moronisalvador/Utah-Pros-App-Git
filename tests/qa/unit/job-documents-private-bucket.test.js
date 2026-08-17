/**
 * ════════════════════════════════════════════════
 * FILE: job-documents-private-bucket.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Locks the safety promises for the first job-file privacy migration and its
 *   browser and worker callers without needing database credentials.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node built-ins
 *   Internal:  migration, rollback, document pages, submit-esign worker
 *   Data:      none (reads repository source only)
 *
 * NOTES / GOTCHAS:
 *   - Live role behavior is separately proven by the recorded qa-staging R1 receipt.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260809010000_job_documents_private_bucket.sql');
const rollback = read('supabase/rollbacks/20260809010000_job_documents_private_bucket.rollback.sql');
const worker = read('functions/api/submit-esign.js');
const desktop = read('src/pages/JobPage.jsx');
const tech = read('src/pages/tech/TechJobDocuments.jsx');
const localRunner = read('scripts/qa/run-local-db-tests.mjs');

describe('job-documents-private migration contract', () => {
  it('creates a private 50 MB bucket with authenticated read/delete only', () => {
    expect(migration).toContain("VALUES ('job-documents-private', 'job-documents-private', false, 52428800)");
    expect(migration).toContain('FOR SELECT\n  TO authenticated');
    expect(migration).toContain('FOR DELETE\n  TO authenticated');
    expect(migration).not.toMatch(/GRANT\s+EXECUTE[^;]*TO\s+(?:PUBLIC|anon|authenticated)/i);
    expect(migration).toMatch(/GRANT\s+EXECUTE[^;]*TO\s+service_role/i);
    expect(migration).not.toContain('FOR INSERT');
    expect(migration).toContain('employee.auth_user_id = auth.uid()');
    expect(migration).toContain('employee.is_active IS TRUE');
    expect(migration).toContain('employee.is_external IS FALSE');
  });

  it('adds only a nullable, default-free bucket selector and has a paired rollback', () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS storage_bucket text\s*;/);
    expect(migration).not.toMatch(/storage_bucket text\s+(?:NOT NULL|DEFAULT)/i);
    expect(rollback).toContain('DROP COLUMN IF EXISTS storage_bucket');
    expect(rollback).toContain('DROP POLICY IF EXISTS job_documents_private_authenticated_read');
    expect(localRunner).toContain('supabase/tests/job_documents_private_bucket.test.sql');
  });
});

describe('private signed-document source contract', () => {
  it('uploads and atomically records the private bucket before sending attached PDFs', () => {
    expect(worker).toContain("SIGNED_DOCUMENT_BUCKET = 'job-documents-private'");
    expect(worker).toContain("PRIVATE_STORAGE_COMPLETION_RPC = 'complete_sign_request_with_private_storage'");
    expect(migration).toContain('CREATE FUNCTION public.complete_sign_request_with_private_storage');
    expect(migration).toContain("SET storage_bucket = 'job-documents-private'");
    expect(migration).toContain('GET DIAGNOSTICS v_updated = ROW_COUNT');
    expect(worker).not.toContain("db.update(\n      'job_documents'");
    expect(worker).toContain('attachments: [{');
    expect(worker).toContain("contentType: 'application/pdf'");
  });

  it('routes both employee document surfaces through the shared helper', () => {
    for (const source of [desktop, tech]) {
      expect(source).toContain("from '@/lib/storageUrl'");
      expect(source).toContain('jobDocumentUrl');
      expect(source).not.toContain('/storage/v1/object/public/job-files');
      expect(source).not.toMatch(/href=\{[^\n]*:\s*['"]#['"]/);
      expect(source).toContain('window.location.assign(url)');
    }
    expect(tech).toContain('previewNativeDoc({ url');
  });
});
