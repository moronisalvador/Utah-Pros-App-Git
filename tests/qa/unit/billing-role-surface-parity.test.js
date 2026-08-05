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
const jsRoleList = (source, name) => {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
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

  it('keeps Stripe Instant Payout admin-only, separate from billing editing', () => {
    const payout = read('functions/api/stripe-payout.js');
    expect(jsRoleList(payout, 'PAYOUT_MANAGE_ROLES')).toEqual(['admin']);
    // Recording money IN and wiring money OUT are different jobs — never the same list.
    expect(jsRoleList(payout, 'PAYOUT_MANAGE_ROLES')).not.toEqual(BILLING_ROLES);
  });
});
