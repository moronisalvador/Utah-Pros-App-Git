/**
 * ════════════════════════════════════════════════
 * FILE: auth.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shared "who is calling, and are they allowed?" check for the backend API
 *   endpoints. Every backend endpoint runs with a master database key that can
 *   see and change everything, so each one must confirm the caller is a real,
 *   active employee — and, for sensitive actions, that they hold the right job
 *   role — before doing the work. Hiding a button in the app is not a lock;
 *   this is.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (imported by functions/api/* workers)
 *   Rendered by:  n/a
 *
 * DEPENDS ON:
 *   Packages:  (none — plain fetch)
 *   Internal:  ./supabase.js (privileged DB client), used by functions/api/*.js
 *   Data:      reads  → auth.users (via Supabase Auth), employees
 *              writes → (none)
 *
 * NOTES / GOTCHAS:
 *   - Workers bypass row-level security, so authorization MUST be enforced here
 *     in code, not left to the database or the UI.
 *   - The caller's JWT is validated against Supabase Auth (`/auth/v1/user`) using
 *     the public anon key (the correct key for that endpoint); the employee row
 *     and role are then read with the privileged client from ./supabase.js.
 *   - Employee lookup matches auth_user_id first, then falls back to the token's
 *     verified email (how the frontend AuthContext resolves the employee), so an
 *     employee whose auth_user_id link is not yet populated is not locked out.
 *   - Fails CLOSED: missing token / lookup error / inactive employee → denied.
 * ════════════════════════════════════════════════
 */

import { supabase } from './supabase.js';

// Roles allowed to touch billing / money operations. Mirrors the frontend's
// BILLING_EDIT_ROLES (src/lib/claimUtils.js) so server enforcement matches the UI.
export const BILLING_ROLES = ['admin', 'manager'];

function bearer(request) {
  const authHeader = request.headers.get('Authorization') || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
}

// Validate the caller's JWT with Supabase Auth. Returns the auth user, or null.
export async function verifyToken(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const apikey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!url || !apikey) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

// Resolve the active employee row for a validated auth user, or null.
async function resolveEmployee(env, user) {
  const db = supabase(env);
  const cols = 'select=id,role,email,is_active&limit=1';
  let rows = await db
    .select('employees', `auth_user_id=eq.${encodeURIComponent(user.id)}&${cols}`)
    .catch(() => []);
  if ((!rows || rows.length === 0) && user.email) {
    rows = await db
      .select('employees', `email=eq.${encodeURIComponent(user.email)}&${cols}`)
      .catch(() => []);
  }
  const emp = rows?.[0];
  if (!emp || emp.is_active === false) return null;
  return emp;
}

/**
 * Require a valid, active employee session. Use for endpoints that any staff
 * member may call but that must not be reachable unauthenticated or by a
 * non-employee auth account.
 * @returns {Promise<{ok:true, user, employee} | {ok:false, status:number, error:string}>}
 */
export async function requireEmployee(request, env) {
  const user = await verifyToken(request, env);
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };
  const employee = await resolveEmployee(env, user);
  if (!employee) return { ok: false, status: 403, error: 'No active employee record' };
  return { ok: true, user, employee };
}

/**
 * Require a valid, active employee whose role is in `allowedRoles`.
 * Use for privileged actions (money movement, billing, admin).
 * @param {string[]} allowedRoles e.g. BILLING_ROLES
 * @returns {Promise<{ok:true, user, employee} | {ok:false, status:number, error:string}>}
 */
export async function requireRole(request, env, allowedRoles) {
  const result = await requireEmployee(request, env);
  if (!result.ok) return result;
  if (Array.isArray(allowedRoles) && allowedRoles.length &&
      !allowedRoles.includes(result.employee.role)) {
    return { ok: false, status: 403, error: 'Insufficient role' };
  }
  return result;
}
