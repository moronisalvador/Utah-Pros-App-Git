/**
 * ════════════════════════════════════════════════
 * FILE: billing-role-surface-parity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks that the three places which decide "who is allowed to do billing" all name the
 *   same list of job roles. One decides whether the button appears on screen, one decides
 *   whether the QuickBooks server accepts the click, and one decides whether the database
 *   accepts the save. If they ever disagree, staff see buttons that fail — which is exactly
 *   the bug this test was written after.
 *
 * DEPENDS ON:
 *   Internal:  src/lib/claimUtils.js, functions/lib/qbo-auth.js,
 *              functions/api/stripe-payout.js,
 *              supabase/migrations/20260804120100_billing_editor_role_boundary.sql
 *   Data:      reads  → none (source text only)
 *
 * NOTES / GOTCHAS:
 *   - Sources are read as TEXT, not imported. functions/ is a separate Cloudflare Pages
 *     Functions bundle and cannot import from src/, and the migration is SQL — so text
 *     comparison is the only way all three can be pinned in one credential-free lane.
 *     Same pattern as functions/api/qbo-payment.test.js.
 *   - This proves the lists AGREE. It does not prove the database enforces them; that is
 *     the behavioural proof in supabase/tests/billing_editor_role_boundary.test.sql.
 *   - Payout is deliberately NOT in parity — moving money OUT stays admin-only. The last
 *     case pins that divergence so a future "cleanup" cannot quietly merge the two lists.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const BILLING_ROLES = ['admin', 'office', 'project_manager'];

/** Pull a JS string-array literal, e.g. `const NAME = ['a', 'b'];` */
// `Object.freeze([...])` is accepted as well as a bare array literal: a role list
// is exactly the kind of constant that should be immutable, and requiring the
// looser form to stay greppable would be the tail wagging the dog.
const jsRoleList = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*(?:Object\\.freeze\\()?\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`${name} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

describe('billing role surfaces agree', () => {
  it('the UI gate names exactly the billing roles', () => {
    expect(jsRoleList(read('src/lib/claimUtils.js'), 'BILLING_EDIT_ROLES')).toEqual(BILLING_ROLES);
  });

  it('the QuickBooks worker gate names the same roles as the UI', () => {
    // Widened 2026-08-05 by owner decision. Until then this stayed ['admin'] while the UI
    // and database lists widened, so office/project_manager saw enabled Save / Send to
    // customer / Revert to draft and got 403 from POST /api/qbo-invoice — and
    // /api/qbo-payment and /api/qbo-query shared the same gate.
    //
    // functions/ is a separate Cloudflare bundle and cannot import from src/, so this list
    // is necessarily duplicated; that is exactly why it is pinned here.
    expect(jsRoleList(read('functions/lib/qbo-auth.js'), 'QBO_BROWSER_ROLES')).toEqual(BILLING_ROLES);
  });

  it('keeps QuickBooks credential and operational workers admin-only', () => {
    // The widening covers INVOICING (qbo-invoice, qbo-receive-payment, qbo-estimate,
    // qbo-payment, qbo-query). It deliberately does not cover:
    //   quickbooks-connect  — runs the OAuth connection; AGENTS.md §16 treats credential
    //                         management as its own class, and the owner widened invoicing.
    //   qbo-payments-sync   — operational sync, not a billing action.
    //   qbo-sync-customer   — reached only from Settings -> Integrations; the invoice path
    //                         uses the ensureQboCustomer library function instead.
    // These pass QBO_ADMIN_ROLES explicitly so a shared-constant change cannot leak in.
    expect(jsRoleList(read('functions/lib/qbo-auth.js'), 'QBO_ADMIN_ROLES')).toEqual(['admin']);
    for (const worker of [
      'functions/api/quickbooks-connect.js',
      'functions/api/qbo-payments-sync.js',
      'functions/api/qbo-sync-customer.js',
    ]) {
      expect(read(worker), `${worker} must pass QBO_ADMIN_ROLES`).toContain('QBO_ADMIN_ROLES');
    }
  });

  it('still refuses inactive and external employees at the QuickBooks gate', () => {
    // Widening WHICH roles may reach QuickBooks must not weaken the 2026-07-31
    // containment's real guarantee: an inactive or external employee is refused whatever
    // their role. requireRole -> requireEmployee enforces is_active; is_external is
    // checked in the worker. Per-worker proof: qbo-worker-authorization.test.js.
    const qboAuth = read('functions/lib/qbo-auth.js');
    expect(qboAuth).toContain('auth.employee.is_external');
    expect(read('functions/lib/auth.js')).toContain("if (!employee.is_active) return { error: 'Inactive employee'");
  });

  it('the database predicate names the same roles as the UI', () => {
    const sql = read('supabase/migrations/20260804120100_billing_editor_role_boundary.sql');
    const match = sql.match(/role::text IN \(([^)]*)\)/);
    expect(match, 'billing_edit_access() role list not found').toBeTruthy();
    expect([...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(BILLING_ROLES);
  });

  it('routes every billing-gated SECURITY DEFINER RPC through the one predicate', () => {
    // Each of these replaces a function body and must CONSUME billing_edit_access()
    // rather than carry its own copy of the role list. A second list is the exact
    // defect this file exists to catch: on 2026-08-07 the OOP conversion RPC was
    // found still gating on the dead ('admin','manager') literal while the UI had
    // widened, so office and project_manager saw an enabled "Create estimate"
    // button and got 42501 from the database.
    for (const migration of [
      'supabase/migrations/20260805020000_estimate_create_rpc_billing_boundary.sql',
      'supabase/migrations/20260807220000_oop_convert_estimate_billing_boundary.sql',
    ]) {
      const code = read(migration)
        .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
      expect(code, `${migration} must call billing_edit_access()`).toContain('public.billing_edit_access()');

      // Scope the no-inlined-list check to FUNCTION BODIES. A migration's own
      // drift guard and postcondition legitimately name role literals in order to
      // assert they are absent from the body; scanning the whole file would flag
      // the very check that enforces this rule.
      const bodies = [...code.matchAll(/AS \$(\w*)\$([\s\S]*?)\$\1\$;/g)].map((m) => m[2]);
      expect(bodies.length, `${migration} has no function body`).toBeGreaterThan(0);
      for (const body of bodies) {
        for (const role of BILLING_ROLES) {
          expect(body, `${migration} inlines the role literal '${role}'`).not.toContain(`'${role}'`);
        }
      }
    }
  });

  it('keeps the OOP calculator button and the OOP conversion RPC on the same list', () => {
    // The UI gate and the database gate for OOP quote -> estimate. Both must be
    // the shared helper; neither may hardcode roles.
    const calculator = read('src/components/oop/ConfiguredOopPricingCalculator.jsx');
    expect(calculator).toContain('canEditBilling(employee?.role)');
    expect(calculator).toContain("db.rpc('convert_oop_quote_to_estimate'");
    const convert = read('supabase/migrations/20260807220000_oop_convert_estimate_billing_boundary.sql');
    expect(convert).toContain('IF NOT public.billing_edit_access() THEN');
  });

  it('keeps the OOP estimate CORRECTION path admin-only, by owner decision', () => {
    // Deliberate divergence (owner, 2026-08-07): creating an estimate from a quote
    // is a billing-editor action; editing a committed estimate's lines and totals
    // in place on the native review screen stays admin-only. The route gate and the
    // RPC gate agree today — this pins that pair so a future "consistency cleanup"
    // cannot quietly widen one of them. Same shape as the payout divergence below.
    const oop = read('supabase/migrations/20260803192344_oop_quote_to_estimate.sql');
    const start = oop.indexOf('CREATE OR REPLACE FUNCTION public.correct_oop_estimate(');
    expect(start, 'correct_oop_estimate block not found').toBeGreaterThan(-1);
    const body = oop.slice(start, oop.indexOf('$function$;', oop.indexOf('AS $function$', start)));
    expect(body).toContain("v_role IS DISTINCT FROM 'admin'");
    expect(body).not.toContain('billing_edit_access()');
    // ...and the only route that reaches it is admin-gated.
    expect(read('src/App.jsx')).toContain('<AdminRoute><FeatureRoute flag="tool:oop_pricing">');
  });

  it('the Stripe pay-link gate names the same roles as the UI', () => {
    // Fixed 2026-08-19. It gated on the dead ('admin','manager') literal — the same
    // drift that hit create_oop_estimate and the QuickBooks workers: 'manager' is not
    // an employee_role, so the endpoint was admin-only by accident while office and
    // project_manager could do every other part of invoicing. Harmless while the
    // durable-boundary 503 refuses everyone, which is exactly why it survived; pinned
    // here so un-containing the endpoint does not quietly ship the old gate.
    const payLink = read('functions/api/stripe-pay-link.js');
    expect(jsRoleList(payLink, 'BILLING_ROLES')).toEqual(BILLING_ROLES);
  });

  it('keeps Stripe Instant Payout admin-only, separate from billing editing', () => {
    const payout = read('functions/api/stripe-payout.js');
    expect(jsRoleList(payout, 'PAYOUT_MANAGE_ROLES')).toEqual(['admin']);
    // Recording money IN and wiring money OUT are different jobs — never the same list.
    expect(jsRoleList(payout, 'PAYOUT_MANAGE_ROLES')).not.toEqual(BILLING_ROLES);
  });

  it('the mobile admin shell names the same roles today, as its OWN list', () => {
    // Widened from admin-only 2026-08-08. ADMIN_MOBILE_ROLES matches
    // BILLING_EDIT_ROLES today and is deliberately a separate constant: "may see
    // the admin screens on a phone" and "may edit billing" are different
    // questions with the same answer right now. This case pins the current
    // agreement so a divergence is a visible, deliberate edit rather than drift —
    // it does NOT require them to stay equal forever. If supervisor ever gains
    // the mobile ops screens, change this expectation on purpose; do not merge
    // the two arrays, which is how PAYOUT_MANAGE_ROLES had to be split back out.
    const access = read('src/components/admin-mobile/adminMobileAccess.js');
    expect(jsRoleList(access, 'ADMIN_MOBILE_ROLES')).toEqual(BILLING_ROLES);
    expect(access).not.toMatch(/import\s*\{[^}]*BILLING_EDIT_ROLES/);
  });

  it('the mobile admin shell still requires the feature flag, not the role alone', () => {
    // The role list is half the gate. Losing the flag check would dark-launch the
    // whole admin surface to office and project_manager on the next deploy.
    const access = read('src/components/admin-mobile/adminMobileAccess.js');
    expect(access).toMatch(/ADMIN_MOBILE_ROLES\.includes\(role\)\s*&&\s*flagEnabled === true/);
  });
});
