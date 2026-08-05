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

// DELIBERATELY admin-only, and deliberately NARROWER than BILLING_EDIT_ROLES.
//
// This is a hardened containment (2026-07-31, `fix(qbo): recover invoice commands safely`)
// with an explicit deny-list proof in functions/api/qbo-worker-authorization.test.js that
// names inactive admin, external admin, office, supervisor, field_tech, project_manager and
// crm_partner — all 403 before any business read or provider call.
//
// The owner's 2026-08-04 widening moved src/lib/claimUtils BILLING_EDIT_ROLES and
// public.billing_edit_access() to ['admin','office','project_manager']. It did not name
// these workers, and pushing to QuickBooks is a different act from writing an invoice row
// in UPR — so the narrower gate is retained until the owner rules on it directly.
//
// KNOWN CONSEQUENCE, surfaced 2026-08-05: office/project_manager currently see enabled
// Save invoice / Send to customer / Revert to draft in InvoiceEditor and get 403 here.
// Resolving that is an owner decision between widening this list and hiding those controls
// from non-admins — NOT something to "fix" by quietly widening, which would silently
// reverse a reviewed security boundary.
const QBO_BROWSER_ROLES = ['admin'];

export async function authorizeQboBrowserRequest(
  request,
  env,
  db,
  fetchImpl = fetchWithTimeout,
) {
  const auth = await requireRole(request, env, db, QBO_BROWSER_ROLES, fetchImpl);
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
) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret && env.QBO_WEBHOOK_SECRET && secret === env.QBO_WEBHOOK_SECRET) {
    return { ok: true, via: 'webhook' };
  }

  return authorizeQboBrowserRequest(request, env, db, fetchImpl);
}
