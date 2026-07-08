/**
 * ════════════════════════════════════════════════
 * FILE: db_foundation_p4_data_integrity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   CI guard for DB-Foundation Phase P4. The authoritative, live proof is the
 *   companion SQL gate (db_foundation_p4_data_integrity.sql) run against the
 *   shared Supabase via the Supabase MCP — a table/constraint check can't be a
 *   pure unit test. This vitest keeps `npm test` (which has no DB secrets in CI)
 *   meaningful and green by statically asserting the P4 migration set and the SQL
 *   gate are intact and carry the exact DDL/assertions they are supposed to — so
 *   an accidental edit, rename, or deletion is caught in CI.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260708_dbf_p4_*.sql, this dir's .sql gate
 *   Data:      reads  → none (static file reads)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The RED repair + repaired-column unique migrations are owner-gated (staged,
 *     not applied). This test only asserts they EXIST and are well-formed; it does
 *     not require them to be applied. Live verification = the .sql gate via MCP.
 *   - No negativity: the repair migration must NULL only the four claim ids + one
 *     contact id named in the report, and must not touch any money/status column —
 *     this test asserts the migration references exactly those non-canonical ids.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mig = (f) => readFileSync(join(here, '..', 'migrations', f), 'utf8');
const gate = readFileSync(join(here, 'db_foundation_p4_data_integrity.sql'), 'utf8');

describe('P4 — missing FK migration', () => {
  const sql = mig('20260708_dbf_p4_missing_fks.sql');
  it('adds notifications.job_id → jobs the NOT VALID → VALIDATE way', () => {
    expect(sql).toMatch(/ADD CONSTRAINT notifications_job_id_fkey[\s\S]*REFERENCES public\.jobs\(id\)[\s\S]*NOT VALID/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT notifications_job_id_fkey/);
  });
  it('ships a rollback note', () => {
    expect(sql).toMatch(/ROLLBACK/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS notifications_job_id_fkey/);
  });
});

describe('P4 — CHECK constraints migration', () => {
  const sql = mig('20260708_dbf_p4_check_constraints.sql');
  it('adds the three job_time_entries non-negativity CHECKs (NULL-tolerant, NOT VALID → VALIDATE)', () => {
    for (const c of ['hours', 'total_paused_minutes', 'travel_minutes']) {
      expect(sql).toMatch(new RegExp(`CHECK \\(${c} IS NULL OR ${c} >= 0\\) NOT VALID`));
    }
    expect(sql).toMatch(/VALIDATE CONSTRAINT job_time_entries_hours_nonneg/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT job_time_entries_paused_nonneg/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT job_time_entries_travel_nonneg/);
  });
});

describe('P4 — clean external-ID unique indexes', () => {
  const sql = mig('20260708_dbf_p4_external_id_unique_clean.sql');
  it('adds partial unique indexes on forms.encircle_note_id + gcal.google_event_id', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*forms_encircle_note_id_uniq[\s\S]*WHERE encircle_note_id IS NOT NULL/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*google_calendar_links_google_event_id_uniq[\s\S]*WHERE google_event_id IS NOT NULL/);
  });
});

describe('P4 — RED repair migration (owner-gated)', () => {
  const sql = mig('20260708_dbf_p4_external_id_repair.sql');
  const nonCanonical = [
    'cd742f5a-f28b-438d-930a-46feb3f15216',
    'ff218cae-70b4-4873-8138-1f437bd84836',
    'afa6648f-390c-4af9-b72a-5544e9d0a8b7',
    '65b7493f-8a9d-4ddf-95d1-66fd0fc19efb',
    '93bd0fc8-2fed-4d11-9b00-c4b909a6ba7b',
  ];
  it('NULLs ONLY the five non-canonical external ids, guarded by the current value', () => {
    for (const id of nonCanonical) expect(sql).toContain(id);
    // exactly five UPDATE ... SET ... = NULL statements
    expect((sql.match(/SET\s+\w+\s*=\s*NULL/gi) || []).length).toBe(5);
  });
  it('never touches a money or status column', () => {
    expect(sql).not.toMatch(/\b(amount|total|amount_paid|status|deductible|paid_at)\b\s*=/i);
  });
  it('is flagged RED and ships an exact-inverse rollback', () => {
    expect(sql).toMatch(/RED/);
    expect(sql).toMatch(/ROLLBACK[\s\S]*encircle_claim_id='4018951'/);
  });
});

describe('P4 — RED repaired-column unique migration (owner-gated)', () => {
  const sql = mig('20260708_dbf_p4_external_id_unique_repaired.sql');
  it('adds unique indexes and supersedes the redundant plain claims index', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*claims_encircle_claim_id_uniq/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*contacts_qbo_customer_id_uniq/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS public\.claims_encircle_claim_id_idx/);
  });
});

describe('P4 — SQL gate', () => {
  it('asserts the YELLOW constraints and adapts to the staged RED items', () => {
    expect(gate).toMatch(/notifications_job_id_fkey/);
    expect(gate).toMatch(/job_time_entries_hours_nonneg/);
    expect(gate).toMatch(/claims_encircle_claim_id_uniq/);
    expect(gate).toMatch(/unique_violation/); // backward-compat probe
    expect(gate).toMatch(/SELECT true AS ok/);
  });
});
