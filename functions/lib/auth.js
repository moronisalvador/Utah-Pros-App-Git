/**
 * ════════════════════════════════════════════════
 * FILE: functions/lib/auth.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One shared "who is calling?" checker for the Cloudflare workers. Before a
 *   worker moves money, sends a message, or returns private data it asks this
 *   file to confirm the caller is a real logged-in user, a real employee, or an
 *   employee with the right job role — and for scheduled/cron workers, that the
 *   caller knows the shared cron secret. It replaces ~34 copy-pasted auth checks
 *   that used to live inside individual workers.
 *
 * WHERE IT LIVES:
 *   Worker library — imported by functions/api/*.js. Not a route.
 *
 * DEPENDS ON:
 *   Packages:  none (pure fetch, runs in a V8 isolate)
 *   Internal:  none. Callers pass in their own supabase() client where a DB
 *              lookup is needed (requireEmployee / requireRole / checkCronSecret).
 *   Data:      reads → employees (auth_user_id → employee row),
 *                      integration_config (cron_worker_secret)
 *              writes → none
 *
 * EXPORTS:
 *   getBearer(request)                       → token string | null
 *   requireUser(request, env)                → { user } | { error, status }
 *   requireEmployee(request, env, db)        → { user, employee } | { error, status }
 *   requireRole(request, env, db, roles)     → { user, employee } | { error, status }
 *   checkCronSecret(request, db)             → boolean
 *   getActorEmployee(request, env, db)       → employee row | null  (legacy shape;
 *                                              moved here from google-drive.js)
 *
 * NOTES / GOTCHAS:
 *   - Token verification hits GET {SUPABASE_URL}/auth/v1/user with the caller's
 *     Bearer token and the project ANON key as `apikey`. The anon key is a valid
 *     apikey for the GoTrue /user endpoint; we verify the caller's token, not the
 *     apikey. We deliberately do NOT read the service-role key here (it isn't
 *     needed and naming it trips the repo secret scanner).
 *   - requireUser only proves the token is valid — ANY employee session passes.
 *     For a money/PII/campaign side effect, gate on requireRole so the SERVER
 *     enforces the same role the UI does (workers-standard.md §1).
 *   - Public-by-design endpoints (database-standard.md §2 allowlist) do not call
 *     these — they carry their own `// public: <reason>` comment.
 * ════════════════════════════════════════════════
 */

// ─── SECTION: Helpers ──────────────
export function getBearer(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function anonKey(env) {
  return env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
}
function projectUrl(env) {
  return env.SUPABASE_URL || env.VITE_SUPABASE_URL;
}

// ─── SECTION: Token → user ──────────────
// Verifies the caller's Supabase session and returns the auth user, or a
// { error, status } pair the worker can hand straight to jsonResponse().
export async function requireUser(request, env) {
  const token = getBearer(request);
  if (!token) return { error: 'Missing Authorization header', status: 401 };

  const url = projectUrl(env);
  const key = anonKey(env);
  if (!url || !key) return { error: 'Auth not configured', status: 500 };

  let res;
  try {
    res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
  } catch {
    return { error: 'Auth check failed', status: 502 };
  }
  if (!res.ok) return { error: 'Invalid or expired token', status: 401 };

  const user = await res.json().catch(() => null);
  if (!user?.id) return { error: 'Invalid or expired token', status: 401 };
  return { user };
}

// ─── SECTION: User → employee ──────────────
// Valid session AND a matching employees row. Returns { user, employee } or a
// { error, status } pair.
export async function requireEmployee(request, env, db) {
  const auth = await requireUser(request, env);
  if (auth.error) return auth;

  let emp;
  try {
    emp = await db.select(
      'employees',
      `auth_user_id=eq.${auth.user.id}&select=id,full_name,email,role&limit=1`,
    );
  } catch {
    return { error: 'Employee lookup failed', status: 500 };
  }
  const employee = emp?.[0];
  if (!employee) return { error: 'Not an employee', status: 403 };
  return { user: auth.user, employee };
}

// ─── SECTION: Employee → role gate ──────────────
// Enforces, server-side, the SAME role predicate the UI enforces (money/PII/
// campaign endpoints). `roles` is an array, e.g. ['admin','manager'].
export async function requireRole(request, env, db, roles) {
  const auth = await requireEmployee(request, env, db);
  if (auth.error) return auth;

  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(auth.employee.role)) {
    return { error: 'Insufficient role', status: 403 };
  }
  return { user: auth.user, employee: auth.employee };
}

// ─── SECTION: Cron secret ──────────────
// A server-side scheduler (Supabase pg_cron + pg_net) authenticates with the
// x-webhook-secret header (Cloudflare PAGES projects expose no Cron Trigger UI).
// Returns true only when the header matches integration_config.cron_worker_secret.
export async function checkCronSecret(request, db) {
  const provided = request.headers.get('x-webhook-secret');
  if (!provided) return false;
  try {
    const [row] = await db.select(
      'integration_config',
      'key=eq.cron_worker_secret&select=value&limit=1',
    );
    return !!row?.value && row.value === provided;
  } catch {
    return false;
  }
}

// ─── SECTION: Legacy shape — resolve request → employee row ──────────────
// Moved verbatim (behavior-preserving) from google-drive.js so google-*, meta-*,
// transcribe-call, callrail-backfill, and process-crm-automations keep their
// `const employee = await getActorEmployee(request, env, db)` calls unchanged.
// Returns the employee row or null (never throws for a missing/invalid token).
export async function getActorEmployee(request, env, db) {
  const token = getBearer(request);
  if (!token) return null;

  const url = projectUrl(env);
  const key = anonKey(env);
  let res;
  try {
    res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  if (!user?.id) return null;

  const emp = await db.select('employees', `auth_user_id=eq.${user.id}&select=id,full_name,email&limit=1`);
  return emp?.[0] || null;
}
