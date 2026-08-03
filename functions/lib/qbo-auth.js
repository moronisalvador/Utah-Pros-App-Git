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
 *     Project-manager access requires an explicit owner decision and is not inferred here.
 *   - Missing or invalid Bearer sessions retain the workers' deployed 401
 *     `{ error: "Unauthorized" }` response contract.
 * ════════════════════════════════════════════════
 */

import { requireRole } from './auth.js';
import { fetchWithTimeout } from './http.js';

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
