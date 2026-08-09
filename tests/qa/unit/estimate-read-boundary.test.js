/**
 * ════════════════════════════════════════════════
 * FILE: estimate-read-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the migration which stops everyone reading the customer-quote
 *   list says what it claims to, and that the undo file restores exactly what
 *   was there before.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs
 *   Internal:  supabase/migrations/20260808210000_estimate_read_boundary.sql,
 *              its paired rollback
 *   Data:      reads  → source text only · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. The behavioural proof is
 *     supabase/tests/estimate_read_boundary.test.sql, which runs only through
 *     npm run test:db:estimate-read:local — the db lane is not one of the three
 *     credential-free lanes, so never present it as CI coverage
 *     (close-out-standard.md §2b).
 *   - The signature case is the one that protects deployed frontends. Four
 *     surfaces read these 21 columns; changing one is a production break the
 *     instant the migration applies, because the database ships ahead of the app.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = 'supabase/migrations/20260808210000_estimate_read_boundary.sql';
const ROLLBACK = 'supabase/rollbacks/20260808210000_estimate_read_boundary.rollback.sql';

/** Source with `--` comment lines stripped, so prose cannot satisfy a code assertion. */
const code = (rel) => read(rel).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const COLUMNS = [
  'estimate_id uuid', 'estimate_number text', 'estimate_type text', 'status text',
  'amount numeric', 'created_at timestamp with time zone', 'submitted_at timestamp with time zone',
  'expiration_date date', 'qbo_estimate_id text', 'qbo_doc_number text', 'qbo_sync_error text',
  'qbo_emailed_at timestamp with time zone', 'job_id uuid', 'job_number text', 'division text',
  'claim_id uuid', 'claim_number text', 'contact_id uuid', 'client_name text',
  'converted_invoice_id uuid', 'converted_invoice_number text',
];

describe('get_estimates read boundary', () => {
  it('routes through the shared predicate rather than its own role list', () => {
    const sql = code(MIGRATION);
    expect(sql).toContain('public.billing_edit_access()');
    // A second copy of the role list is the exact defect the parity test exists
    // to catch; the OOP conversion RPC shipped one and refused office/PM for days.
    const bodies = [...sql.matchAll(/AS \$(\w*)\$([\s\S]*?)\$\1\$;/g)].map((m) => m[2]);
    expect(bodies.length).toBeGreaterThan(0);
    const fnBody = bodies.find((b) => b.includes('RETURN QUERY'));
    expect(fnBody, 'no function body with RETURN QUERY found').toBeTruthy();
    for (const role of ['admin', 'office', 'project_manager']) {
      expect(fnBody, `inlines the role literal '${role}'`).not.toContain(`'${role}'`);
    }
  });

  it('uses IS DISTINCT FROM for the service_role bypass, never <>', () => {
    // auth.role() is NULL outside a PostgREST request. `NULL <> 'service_role'`
    // is NULL, which PL/pgSQL's IF treats as false — silently skipping the guard
    // for anything holding a raw connection.
    expect(code(MIGRATION)).toContain("auth.role() IS DISTINCT FROM 'service_role'");
    expect(code(MIGRATION)).not.toMatch(/auth\.role\(\)\s*<>/);
  });

  it('refuses with 42501, the code PostgREST maps to a clean 403', () => {
    expect(code(MIGRATION)).toContain("RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501'");
  });

  it('revokes from PUBLIC and anon BEFORE granting authenticated', () => {
    // This managed project re-applies EXECUTE TO PUBLIC to every new function at
    // ddl_command_end, so the order is load-bearing (database-standard.md §1).
    const sql = code(MIGRATION);
    const revoke = sql.indexOf('REVOKE EXECUTE ON FUNCTION public.get_estimates() FROM PUBLIC, anon;');
    const grant = sql.indexOf('GRANT  EXECUTE ON FUNCTION public.get_estimates() TO authenticated;');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it('carries a drift guard pinning the exact body it replaces', () => {
    const sql = code(MIGRATION);
    expect(sql).toContain('5062fe1b025b989e82ac827a00411d2e');
    expect(sql).toMatch(/RAISE EXCEPTION[\s\S]{0,120}drifted/);
  });

  it('keeps the 21-column signature identical in BOTH directions', () => {
    // Four surfaces read these columns and the database ships ahead of the app,
    // so a changed name or type is a production break on apply.
    for (const rel of [MIGRATION, ROLLBACK]) {
      const sql = code(rel);
      for (const column of COLUMNS) {
        expect(sql, `${rel} is missing column ${column}`).toContain(column);
      }
    }
  });

  it('keeps the enum cast that plpgsql will not apply for you', () => {
    // jobs.division is enum job_division; the declared column is text. LANGUAGE
    // sql assignment-casts at the result boundary, plpgsql's RETURN QUERY does
    // not. Dropping this cast throws for EVERY caller including admins — the
    // defect that reached the apply step on 20260807230000.
    expect(code(MIGRATION)).toContain('j.division::text');
    expect(code(ROLLBACK)).toContain('j.division::text');
  });

  it('the rollback restores LANGUAGE sql and removes the gate', () => {
    const sql = code(ROLLBACK);
    expect(sql).toContain('LANGUAGE sql');
    expect(sql).not.toContain('billing_edit_access');
    expect(read(ROLLBACK)).toContain('-- destructive-approved:');
  });

  it('neither file touches billing_edit_access or the five already-gated reports', () => {
    // Undoing this gate must never disturb the shared predicate or the boundary
    // applied as ledger 20260808050037.
    for (const rel of [MIGRATION, ROLLBACK]) {
      const sql = code(rel);
      expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.billing_edit_access/);
      for (const fn of ['get_ar_invoices', 'get_payments_ledger', 'get_payments_received', 'get_avg_ticket', 'get_revenue_by_division']) {
        expect(sql, `${rel} must not redefine ${fn}`).not.toContain(`FUNCTION public.${fn}`);
      }
    }
  });
});
