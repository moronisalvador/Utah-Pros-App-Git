/**
 * ════════════════════════════════════════════════
 * FILE: messaging-auth.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Applies the server-side equivalent of canAccess('conversations') before a
 *   worker may write a note or contact a messaging provider. It also rejects
 *   inactive and external identities.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./auth.js
 *   Data:      reads → employees, feature_flags, employee_page_access,
 *                      nav_permissions
 *
 * EXPORTS:
 *   requireMessagingAccess(request, env, db)
 *
 * NOTES / GOTCHAS:
 *   - Priority matches AuthContext: force-disable → employee override → admin →
 *     role permission. Missing evidence denies.
 *   - This is a page capability, not provider selection. Provider mode remains
 *     a separate server-only decision.
 * ════════════════════════════════════════════════
 */

import { requireEmployee } from './auth.js';

const NAV_KEY = 'conversations';

function denied(error, code = 'MESSAGING_NOT_AUTHORIZED') {
  return { error, code, status: 403 };
}

export async function requireMessagingAccess(request, env, db) {
  const auth = await requireEmployee(request, env, db);
  if (auth.error) return auth;

  const { employee } = auth;
  if (employee.is_active !== true) {
    return denied('Inactive employee', 'INACTIVE_EMPLOYEE');
  }
  if (employee.is_external === true) {
    return denied('Messaging is unavailable for external accounts');
  }

  try {
    const [flag] = await db.select(
      'feature_flags',
      `key=eq.page:${NAV_KEY}&select=force_disabled&limit=1`,
    );
    if (flag?.force_disabled === true) {
      return denied('Messaging is currently disabled', 'MESSAGING_DISABLED');
    }

    const [override] = await db.select(
      'employee_page_access',
      `employee_id=eq.${employee.id}&nav_key=eq.${NAV_KEY}&select=can_view&limit=1`,
    );
    if (override) {
      return override.can_view === true
        ? auth
        : denied('Messaging access is disabled for this employee');
    }

    if (employee.role === 'admin') return auth;

    const [permission] = await db.select(
      'nav_permissions',
      `role=eq.${employee.role}&nav_key=eq.${NAV_KEY}&select=can_view&limit=1`,
    );
    return permission?.can_view === true
      ? auth
      : denied('Messaging access is not granted for this role');
  } catch {
    return { error: 'Messaging authorization lookup failed', status: 500 };
  }
}
