/**
 * ════════════════════════════════════════════════
 * FILE: billing-editor-role-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the rules about who may touch money still say what they are
 *   supposed to say. It reads the migration and the app's own permission list as
 *   plain text and makes sure the two agree: the list of job titles allowed to
 *   record a payment on screen must match the list the database enforces. It also
 *   makes sure the "pay money out to our debit card" permission stayed separate
 *   and admin-only. No database required.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  supabase/migrations/20260804120100_billing_editor_role_boundary.sql
 *              supabase/rollbacks/20260804120100_billing_editor_role_boundary.rollback.sql
 *              src/lib/claimUtils.js, src/pages/JobPage.jsx,
 *              functions/api/stripe-payout.js, src/lib/navItems.jsx
 *   Data:      reads  → migration, rollback and application source text
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves INTENT, not EFFECT. It cannot tell you the policy actually
 *     applied — only that the source still asks for it. Live proof is the
 *     apply-window step plus supabase/tests/billing_editor_role_boundary.test.sql.
 *   - The UI/SQL parity assertion is the point of this file. AGENTS.md §16 was
 *     violated here in both directions at once before 2026-08-04: JobPage showed
 *     payment controls the database refused, while invoices were writable by every
 *     authenticated employee with no role predicate at all. A future edit that
 *     widens one side without the other fails here rather than in production.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derived from this file's location rather than the working directory, so the
// test resolves the same way however the lane runner is invoked.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = read('supabase/migrations/20260804120100_billing_editor_role_boundary.sql');
const ROLLBACK = read('supabase/rollbacks/20260804120100_billing_editor_role_boundary.rollback.sql');
const CLAIM_UTILS = read('src/lib/claimUtils.js');
const JOB_PAGE = read('src/pages/JobPage.jsx');
const STRIPE_PAYOUT = read('functions/api/stripe-payout.js');
const NAV_ITEMS = read('src/lib/navItems.jsx');

// Comment-stripped views. Grant/guard assertions must read EXECUTABLE SQL only —
// otherwise a `-- ... EXECUTE TO PUBLIC ...` explanatory comment reads as a grant,
// and `INSERT INTO public.invoices` reads as "TO public".
const stripComments = (sql) =>
  sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
const MIGRATION_CODE = stripComments(MIGRATION);
const ROLLBACK_CODE = stripComments(ROLLBACK);

// The single source of truth this whole change hangs on. Parsed out of the JS
// rather than hardcoded, so the parity checks below compare the two real lists.
function parseRoleArray(source, constName) {
  const m = new RegExp(`export const ${constName} = \\[([^\\]]*)\\]`).exec(source);
  if (!m) throw new Error(`${constName} not found`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
}

describe('billing editor role boundary — UI/SQL parity', () => {
  const billingRoles = parseRoleArray(CLAIM_UTILS, 'BILLING_EDIT_ROLES');

  it('BILLING_EDIT_ROLES is the owner-directed set and carries no dead enum value', () => {
    expect(billingRoles).toEqual(['admin', 'office', 'project_manager']);
    // 'manager' is not a value in the employee_role enum, so it could never match.
    expect(billingRoles).not.toContain('manager');
  });

  it('billing_edit_access() enforces exactly the BILLING_EDIT_ROLES list', () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.billing_edit_access()'),
      MIGRATION.indexOf('$function$;'),
    );
    for (const role of billingRoles) expect(fn).toContain(`'${role}'`);
    // No role beyond the JS list may appear in the SQL predicate.
    const sqlRoles = [...fn.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(sqlRoles)].sort()).toEqual([...billingRoles].sort());
  });

  it('the predicate still fails closed on inactive and external employees', () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.billing_edit_access()'),
      MIGRATION.indexOf('$function$;'),
    );
    expect(fn).toContain('e.auth_user_id = auth.uid()');
    expect(fn).toContain('e.is_active IS TRUE');
    expect(fn).toContain('e.is_external IS FALSE');
  });
});

describe('payout authority stayed separate and admin-only', () => {
  it('PAYOUT_MANAGE_ROLES is admin-only and strictly narrower than billing', () => {
    const billingRoles = parseRoleArray(CLAIM_UTILS, 'BILLING_EDIT_ROLES');
    const payoutRoles = parseRoleArray(CLAIM_UTILS, 'PAYOUT_MANAGE_ROLES');
    expect(payoutRoles).toEqual(['admin']);
    expect(payoutRoles.length).toBeLessThan(billingRoles.length);
    for (const r of payoutRoles) expect(billingRoles).toContain(r);
  });

  it('stripe-payout gates on PAYOUT_MANAGE_ROLES, never BILLING_EDIT_ROLES', () => {
    // Instant Payout moves real money OUT to the company debit card. Re-pointing
    // this at the billing list would hand it to every billing editor.
    expect(STRIPE_PAYOUT).toContain("const PAYOUT_MANAGE_ROLES = ['admin']");
    expect(STRIPE_PAYOUT).toContain('PAYOUT_MANAGE_ROLES.includes(emp.role)');
    expect(STRIPE_PAYOUT).not.toMatch(/const BILLING_EDIT_ROLES\s*=/);
    expect(STRIPE_PAYOUT).not.toMatch(/BILLING_EDIT_ROLES\.includes/);
  });

  it('the payout settings page and its nav entry use the payout gate', () => {
    const settings = read('src/pages/settings/Payments.jsx');
    expect(settings).toContain('canManagePayouts(employee?.role)');
    expect(settings).not.toMatch(/canEditBilling\(/);
    expect(NAV_ITEMS).toContain('canManagePayouts(employee.role)');
    expect(NAV_ITEMS).toMatch(/path: '\/settings\/payments'[^}]*payout: true/);
  });
});

describe('every ClaimBilling call site derives its gate from canEditBilling', () => {
  // The 2026-08-04 defect: JobPage was the only one of four call sites passing a
  // hand-rolled role set instead, so office/project_manager saw payment controls
  // that the database refused.
  const CALL_SITES = [
    'src/pages/JobPage.jsx',
    'src/pages/ClaimPage.jsx',
    'src/pages/CustomerPage.jsx',
    'src/pages/ClaimCollectionPage.jsx',
  ];

  it.each(CALL_SITES)('%s imports canEditBilling and renders ClaimBilling', (file) => {
    const src = read(file);
    expect(src).toMatch(/canEditBilling/);
    expect(src).toMatch(/<ClaimBilling/);
  });

  it('JobPage passes the billing-derived prop, not the jobs-table canEdit', () => {
    expect(JOB_PAGE).toContain('const canEditBill=canEditBilling(employee?.role);');
    expect(JOB_PAGE).toContain('<ClaimBilling jobs={[job]} db={db} canEdit={canEditBill}/>');
    // The jobs-table gate must remain a separate variable — the two answer
    // different authorization questions against different tables.
    expect(JOB_PAGE).toMatch(/const canEdit=employee\?\.role==='admin'/);
  });
});

describe('payments write policies — widened without losing their other guards', () => {
  const policies = ['payments_billing_insert', 'payments_billing_update', 'payments_billing_delete'];

  it.each(policies)('%s is recreated against the shared predicate', (name) => {
    expect(MIGRATION).toContain(`DROP POLICY IF EXISTS ${name} ON public.payments;`);
    expect(MIGRATION).toContain(`CREATE POLICY ${name} ON public.payments`);
  });

  it('worker-owned receipt rows stay un-writable from a browser', () => {
    // receipt_id IS NULL + source='manual' are what keep provider-originated and
    // grouped QBO receipt payments worker-owned. INSERT (WITH CHECK), UPDATE
    // (USING + WITH CHECK) and DELETE (USING) → four occurrences of each guard.
    const guardCount = (needle) => MIGRATION_CODE.split(needle).length - 1;
    expect(guardCount('receipt_id IS NULL')).toBe(4);
    expect(guardCount("COALESCE(source, 'manual') = 'manual'")).toBe(4);
  });

  it('INSERT still pins recorded_by to the acting employee', () => {
    const insert = MIGRATION.slice(
      MIGRATION.indexOf('CREATE POLICY payments_billing_insert'),
      MIGRATION.indexOf('CREATE POLICY payments_billing_update'),
    );
    expect(insert).toContain('employee.id = recorded_by');
    expect(insert).toContain('employee.auth_user_id = auth.uid()');
  });

  it('no policy or grant names anon or PUBLIC', () => {
    expect(MIGRATION_CODE).not.toMatch(/\bTO\s+anon\b/i);
    expect(MIGRATION_CODE).not.toMatch(/\bTO\s+PUBLIC\b/i);
    expect(MIGRATION_CODE).not.toMatch(/GRANT[^;]*\banon\b/i);
    // Every executable GRANT in the file, enumerated — a new one has to be
    // added here deliberately rather than slipping in unnoticed.
    const grants = MIGRATION_CODE.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.toUpperCase().startsWith('GRANT'));
    expect(grants).toEqual([
      'GRANT EXECUTE ON FUNCTION public.billing_edit_access() TO authenticated;',
      'GRANT EXECUTE ON FUNCTION public.create_invoice_for_job(uuid, uuid) TO authenticated, service_role;',
      'GRANT EXECUTE ON FUNCTION public.convert_estimate_to_invoice(uuid, boolean, uuid) TO authenticated, service_role;',
    ]);
  });
});

describe('invoices and invoice_line_items — the unpredicated write is closed', () => {
  it('drops the role-free FOR ALL policies inherited from 20260701', () => {
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS "allow_authenticated_invoices" ON public.invoices;');
    expect(MIGRATION).toContain(
      'DROP POLICY IF EXISTS "allow_authenticated_invoice_line_items" ON public.invoice_line_items;',
    );
  });

  it('drops the always-true SELECT policy that exposed invoices to crm_partner', () => {
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS allow_anon_read_invoices ON public.invoices;');
  });

  it.each([
    ['invoices', 'invoices_internal_read', 'invoices_billing_write'],
    ['invoice_line_items', 'invoice_lines_internal_read', 'invoice_lines_billing_write'],
  ])('%s splits into an internal read and a billing write', (table, readPolicy, writePolicy) => {
    expect(MIGRATION).toContain(`CREATE POLICY "${readPolicy}" ON public.${table}`);
    expect(MIGRATION).toContain(`CREATE POLICY "${writePolicy}" ON public.${table}`);
    const write = MIGRATION.slice(MIGRATION.indexOf(`CREATE POLICY "${writePolicy}"`));
    expect(write.slice(0, 260)).toContain('public.billing_edit_access()');
  });
});

describe('SECURITY DEFINER invoice RPCs enforce the same predicate', () => {
  it.each(['create_invoice_for_job', 'convert_estimate_to_invoice'])(
    '%s checks billing_edit_access and keeps its service_role bypass',
    (fn) => {
      const body = MIGRATION.slice(MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`));
      expect(body).toContain("IF auth.role() <> 'service_role' AND NOT public.billing_edit_access() THEN");
      expect(body).toContain("USING ERRCODE = '42501'");
      // The dead 'manager' caller check must be gone from both.
      expect(body.slice(0, 2000)).not.toContain("e.role::text = 'manager'");
    },
  );

  it('both RPCs revoke PUBLIC/anon immediately before their grant', () => {
    for (const sig of ['create_invoice_for_job(uuid, uuid)', 'convert_estimate_to_invoice(uuid, boolean, uuid)']) {
      const revokeAt = MIGRATION.indexOf(`REVOKE EXECUTE ON FUNCTION public.${sig} FROM PUBLIC, anon;`);
      const grantAt = MIGRATION.indexOf(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated, service_role;`);
      expect(revokeAt).toBeGreaterThan(-1);
      expect(grantAt).toBeGreaterThan(revokeAt);
    }
  });

  it('billing_edit_access revokes service_role and grants only authenticated', () => {
    // Policy-only helper: service_role bypasses RLS and needs no direct capability.
    expect(MIGRATION).toContain(
      'REVOKE EXECUTE ON FUNCTION public.billing_edit_access()\n  FROM PUBLIC, anon, authenticated, service_role;',
    );
    expect(MIGRATION).toContain('GRANT EXECUTE ON FUNCTION public.billing_edit_access() TO authenticated;');
  });

  it('convert_estimate_to_invoice keeps its serialization and idempotent re-entry', () => {
    const body = MIGRATION.slice(MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.convert_estimate_to_invoice('));
    expect(body).toContain('FROM public.estimates');
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('converted_invoice_id');
  });
});

describe('rollback exists and restores the exact prior state', () => {
  it('restores the admin-effective predicate', () => {
    expect(ROLLBACK).toContain("AND e.role::text IN ('admin', 'manager')");
  });

  it('restores every object the forward migration replaced', () => {
    for (const needle of [
      'CREATE POLICY payments_billing_insert ON public.payments',
      'CREATE POLICY payments_billing_update ON public.payments',
      'CREATE POLICY payments_billing_delete ON public.payments',
      'CREATE POLICY "allow_authenticated_invoices" ON public.invoices',
      'CREATE POLICY allow_anon_read_invoices ON public.invoices',
      'CREATE POLICY "allow_authenticated_invoice_line_items" ON public.invoice_line_items',
      'CREATE POLICY qbo_attachments_select ON public.qbo_attachments',
      'CREATE OR REPLACE FUNCTION public.create_invoice_for_job(',
      'CREATE OR REPLACE FUNCTION public.convert_estimate_to_invoice(',
    ]) {
      expect(ROLLBACK).toContain(needle);
    }
  });

  it('warns that reverting re-opens the invoice write hole', () => {
    // A rollback that silently restores a known defect is a trap. The warning is
    // part of the contract, not decoration.
    expect(ROLLBACK).toMatch(/READ THIS BEFORE RUNNING IT/);
    expect(ROLLBACK).toMatch(/destructive-approved:/);
  });

  it('never re-grants anon', () => {
    // The policy NAMED allow_anon_read_invoices is restored, but it is a
    // TO authenticated policy — the historical anon grant is not resurrected.
    expect(ROLLBACK_CODE).not.toMatch(/\bTO\s+anon\b/i);
    expect(ROLLBACK_CODE).not.toMatch(/GRANT[^;]*\banon\b/i);
  });
});
