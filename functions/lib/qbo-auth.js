/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/qbo-auth.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether a QuickBooks worker request came from an approved server task or an active
 *   internal administrator. It keeps the existing server-secret path while preventing other
 *   logged-in employees from reaching company accounting actions directly.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./auth.js
 *   Data:      reads  → employees (through requireRole)
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - The repository's historical "manager" billing label is not a live employee role.
 *     Project-manager access requires an explicit owner decision and is not inferred here.
 *   - Missing or invalid Bearer sessions retain the workers' deployed 401
 *     `{ error: "Unauthorized" }` response contract.
 * ════════════════════════════════════════════════
 */

import { requireRole } from './auth.js';

const QBO_BROWSER_ROLES = ['admin'];

export async function authorizeQboRequest(request, env, db) {
  const secret = request.headers.get('x-webhook-secret');
  if (secret && env.QBO_WEBHOOK_SECRET && secret === env.QBO_WEBHOOK_SECRET) {
    return { ok: true, via: 'webhook' };
  }

  const auth = await requireRole(request, env, db, QBO_BROWSER_ROLES);
  if (auth.error) {
    return {
      ok: false,
      status: auth.status,
      error: auth.status === 401 ? 'Unauthorized' : 'Forbidden',
    };
  }
  if (auth.employee.is_external) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, via: 'bearer', user: auth.user, employee: auth.employee };
}
