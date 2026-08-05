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

  it('pins the QuickBooks worker gate as deliberately NARROWER, pending an owner ruling', () => {
    // This intentionally does NOT assert parity. QBO_BROWSER_ROLES is a hardened
    // containment (2026-07-31) whose deny-list proof in
    // functions/api/qbo-worker-authorization.test.js names office and project_manager
    // explicitly. The owner's 2026-08-04 widening moved the UI and database lists but did
    // not name these workers.
    //
    // The live consequence is real and unresolved: office/project_manager see enabled
    // Save / Send to customer / Revert to draft in InvoiceEditor and receive 403. This
    // case exists so that divergence stays VISIBLE and deliberate rather than being
    // discovered again as a surprise — and so nobody closes it by widening the worker
    // without the owner, which would silently reverse a reviewed security boundary.
    const qbo = jsRoleList(read('functions/lib/qbo-auth.js'), 'QBO_BROWSER_ROLES');
    expect(qbo).toEqual(['admin']);
    expect(qbo).not.toEqual(BILLING_ROLES);
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
