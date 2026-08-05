/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/qbo-auth.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether a QuickBooks worker request came from an approved server task or an active
 *   internal administrator. It keeps the existing server-secret path on workers that already
 *   support it, while giving browser-only OAuth workers a separate human-only gate.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./auth.js, ./http.js
 *   Data:      reads  → employees (through requireRole)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The repository's historical "manager" billing label is not a live employee role.
 *   - QBO_BROWSER_ROLES is the THIRD of three surfaces that must state the same billing
 *     role list. The other two are src/lib/claimUtils.js BILLING_EDIT_ROLES (which decides
 *     whether the button renders) and public.billing_edit_access() (which decides whether
 *     the database accepts the write). functions/ is a separate Cloudflare bundle and
 *     cannot import from src/, so the list is duplicated here on purpose and pinned by
 *     tests/qa/unit/billing-role-surface-parity.test.js — if you change one, change all
 *     three or that test fails.
 *   - Missing or invalid Bearer sessions retain the workers' deployed 401
 *     `{ error: "Unauthorized" }` response contract.
 * ════════════════════════════════════════════════
 */

import { requireRole } from './auth.js';
import { fetchWithTimeout } from './http.js';

// Mirrors src/lib/claimUtils BILLING_EDIT_ROLES and public.billing_edit_access().
//
// Widened from ['admin'] on 2026-08-05 by explicit owner decision, confirming that the
// 2026-08-04 billing widening was meant to cover pushing to QuickBooks and not only
// writing invoice rows in UPR. Until then office/project_manager saw enabled Save invoice
// / Send to customer / Revert to draft in InvoiceEditor and got 403 from here.
//
// This deliberately relaxes part of the 2026-07-31 containment
// (`fix(qbo): recover invoice commands safely`). What that containment still guarantees is
// unchanged and is what matters most: an INACTIVE or EXTERNAL employee is refused
// regardless of role, as are supervisor, field_tech and crm_partner — proven per-worker in
// functions/api/qbo-worker-authorization.test.js, before any business read or provider
// call. Only the two roles the owner named were moved.
//
// Moving money OUT is NOT this list — Stripe Instant Payout stays admin-only via
// PAYOUT_MANAGE_ROLES in functions/api/stripe-payout.js. Never merge the two.
// All three billing surfaces are pinned together by
// tests/qa/unit/billing-role-surface-parity.test.js.
const QBO_BROWSER_ROLES = ['admin', 'office', 'project_manager'];

// NOT everything behind these helpers is invoicing. `quickbooks-connect` runs the OAuth
// connection (credential management) and `qbo-payments-sync` is an operational sync — the
// owner widened *invoicing and payment recording*, not the QuickBooks credential itself,
// and AGENTS.md §16 treats "manages credentials" as its own class. Those two pass
// QBO_ADMIN_ROLES explicitly so the widening cannot leak into them.
export const QBO_ADMIN_ROLES = ['admin'];

export async function authorizeQboBrowserRequest(
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
  roles = QBO_BROWSER_ROLES,
) {
  const auth = await requireRole(request, env, db, roles, fetchImpl);
  if (auth.error) {
    return {
      ok: false,
      status: auth.status,
      error: auth.status === 401
        ? 'Unauthorized'
        : auth.status === 403
          ? 'Forbidden'
          : 'Authorization check failed',
    };
  }
  if (auth.employee.is_external) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, via: 'bearer', user: auth.user, employee: auth.employee };
}

export async function authorizeQboRequest(
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
  roles = QBO_BROWSER_ROLES,
) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret && env.QBO_WEBHOOK_SECRET && secret === env.QBO_WEBHOOK_SECRET) {
    return { ok: true, via: 'webhook' };
  }

  return authorizeQboBrowserRequest(request, env, db, fetchImpl, roles);
}
