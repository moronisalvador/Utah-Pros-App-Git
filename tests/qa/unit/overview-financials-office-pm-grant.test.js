/**
 * ════════════════════════════════════════════════
 * FILE: overview-financials-office-pm-grant.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Reads the migration that lets the office manager and project managers see the
 *   Dashboard money cards, and checks it says what it claims: exactly two people
 *   gain, nobody loses, and it only ever adds rows. It also checks the chain the
 *   grant depends on is still wired — the permission name, the screen that reads
 *   it, and the database boundary that was closed first.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, vitest
 *   Internal:  the paired 20260808060000 migration/rollback, src/pages/Dashboard.jsx,
 *              src/contexts/AuthContext.jsx
 *   Data:      reads → repository source only · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT. EFFECT is proven by
 *     supabase/tests/overview_financials_office_pm_grant.test.sql on a disposable
 *     stack (npm run test:db:overview-financials-grant:local).
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relative) => readFileSync(path.join(repositoryRoot, relative), 'utf8');

const SLUG = '20260808060000_overview_financials_office_pm_grant';
const migration = read(`supabase/migrations/${SLUG}.sql`);
const rollback = read(`supabase/rollbacks/${SLUG}.rollback.sql`);

const stripComments = (sql) => sql.replace(/^\s*--.*$/gm, '');
const migrationSql = stripComments(migration);
const rollbackSql = stripComments(rollback);

describe('overview_financials grant — migration source contract', () => {
  it('grants exactly office and project_manager, and nobody else', () => {
    expect(migrationSql).toContain("('overview_financials', 'office',          true, false)");
    expect(migrationSql).toContain("('overview_financials', 'project_manager', true, false)");

    const rows = migrationSql.match(/\('overview_financials',\s*'(\w+)'/g) || [];
    expect(rows).toHaveLength(2);

    for (const role of ['supervisor', 'estimator', 'field_tech', 'crm_partner', 'admin']) {
      expect(migrationSql, role).not.toContain(`'overview_financials', '${role}'`);
    }
  });

  it('grants sight, not authority — can_edit is false on both rows', () => {
    expect(migrationSql).not.toMatch(/'overview_financials',\s*'\w+',\s*true,\s*true/);
  });

  it('only ever adds rows — it revokes and deletes nothing', () => {
    for (const forbidden of [
      /\bDELETE\s+FROM\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDROP\b/i,
      /\bREVOKE\b/i, /\bALTER\s+TABLE\b/i, /\bCREATE\s+POLICY\b/i,
    ]) {
      expect(migrationSql, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('is idempotent, so a repeat apply cannot overwrite a hand-tuned row', () => {
    expect(migrationSql).toMatch(/ON CONFLICT \(nav_key, role\) DO NOTHING/);
  });

  it('adds no top-level transaction (the migration executor owns it)', () => {
    expect(migrationSql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/m);
  });

  it('the rollback removes only these two rows', () => {
    expect(rollbackSql).toMatch(/DELETE FROM public\.nav_permissions/);
    expect(rollbackSql).toMatch(/nav_key = 'overview_financials'/);
    expect(rollbackSql).toMatch(/role IN \('office', 'project_manager'\)/);
    // A DELETE that lost its nav_key predicate would wipe every office/PM
    // permission — a far worse outage than the grant it undoes.
    expect(rollbackSql).not.toMatch(/DELETE FROM public\.nav_permissions\s*;/);
    expect(rollback).toMatch(/destructive-approved:/);
  });
});

describe('overview_financials grant — the chain it depends on is still wired', () => {
  it('the Dashboard still gates its money cards on canAccess(overview_financials)', () => {
    const dashboard = read('src/pages/Dashboard.jsx');
    expect(dashboard).toMatch(/canAccess\('overview_financials'\)/);
    // The four financial hooks take canFin; the pipeline hook deliberately does
    // not — see 20260807230000, which excluded get_pipeline_summary for exactly
    // that reason. If usePipeline ever gains the gate, that migration's
    // reasoning changes and both must be revisited together.
    expect(dashboard).toMatch(/usePipeline\(\)/);
  });

  it('canAccess still resolves non-admins through nav_permissions (Layer 4)', () => {
    // The grant is a nav_permissions row, so it only works if canAccess still
    // consults that table for non-admins. Layer 3 short-circuits admins first,
    // which is why the proof asserts admin gains NO row.
    const auth = read('src/contexts/AuthContext.jsx');
    expect(auth).toMatch(/nav_permissions/);
    expect(auth).toMatch(/permissions\.find\(p => p\.nav_key === navKey\)/);
    expect(auth).toMatch(/employee\.role === 'admin'\) return true/);
  });

  it('the server boundary was closed BEFORE this UI grant, not after', () => {
    // This is the ordering that makes widening the UI safe: the five reports
    // already refuse anyone outside {admin, office, project_manager}. Without
    // that, this migration would be opening a screen onto ungated data.
    const boundary = read('supabase/migrations/20260807230000_office_financial_read_boundary.sql');
    expect(boundary).toContain('public.billing_edit_access()');
    for (const fn of [
      'get_ar_invoices', 'get_payments_ledger', 'get_payments_received',
      'get_avg_ticket', 'get_revenue_by_division',
    ]) {
      expect(boundary, fn).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    }
    expect(migration).toMatch(/20260807230000_office_financial_read_boundary/);
  });
});
