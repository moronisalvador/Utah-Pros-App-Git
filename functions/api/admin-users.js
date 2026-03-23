// POST/PATCH/DELETE /api/admin-users
// Admin user management — creates Supabase Auth users + employee records.
// Requires SUPABASE_SERVICE_ROLE_KEY env var (never exposed client-side).
//
// POST   — Create new user (auth + employee row)
// PATCH  — Update user (auth email/password + employee fields)
// DELETE — Hard delete user (auth + employee row)
// PUT    — Toggle active status (ban/unban auth + is_active flag)
//
// All operations require a valid admin JWT in Authorization header.

import { handleOptions, jsonResponse } from '../lib/cors.js';

// ── JWT verification: extract caller's JWT, verify with Supabase, check admin role ──
async function requireAdmin(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return { error: 'Missing Authorization header', status: 401 };
  }

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  // Verify JWT by fetching the caller's user record from Supabase Auth
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!userRes.ok) {
    return { error: 'Invalid or expired token', status: 401 };
  }

  const authUser = await userRes.json();

  // Look up employee record and verify admin role
  const empRes = await fetch(
    `${url}/rest/v1/employees?auth_user_id=eq.${authUser.id}&limit=1`,
    {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!empRes.ok) {
    return { error: 'Failed to verify employee role', status: 500 };
  }

  const employees = await empRes.json();
  const employee = employees[0];

  if (!employee || employee.role !== 'admin') {
    return { error: 'Admin role required', status: 403 };
  }

  return { ok: true, employee };
}

function supabaseAdmin(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  return {
    // ── Auth Admin API ──
    async createAuthUser(email, password, metadata = {}) {
      const res = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          password,
          email_confirm: true, // Skip email verification — admin-created
          user_metadata: metadata,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.msg || data.message || JSON.stringify(data));
      return data;
    },

    async updateAuthUser(authUserId, updates) {
      // updates can include: { email, password, ban_duration, user_metadata }
      const res = await fetch(`${url}/auth/v1/admin/users/${authUserId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.msg || data.message || JSON.stringify(data));
      return data;
    },

    async deleteAuthUser(authUserId) {
      const res = await fetch(`${url}/auth/v1/admin/users/${authUserId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.msg || data.message || `Delete failed: ${res.status}`);
      }
      return true;
    },

    // ── PostgREST (via service role) ──
    async select(table, query = '') {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`SELECT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    async insert(table, data) {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`INSERT ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    async update(table, filter, data) {
      const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`UPDATE ${table}: ${res.status} ${await res.text()}`);
      return res.json();
    },

    async delete(table, filter) {
      const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error(`DELETE ${table}: ${res.status} ${await res.text()}`);
      return true;
    },
  };
}

// ── CORS preflight ──
export async function onRequestOptions(context) {
  return handleOptions(context.request, context.env);
}

// ═══════════════════════════════════════════════════
// POST — Create new user
// Body: { email, password, full_name, display_name, role, phone, hourly_rate, overtime_rate }
// ═══════════════════════════════════════════════════
export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await requireAdmin(request, env);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const db = supabaseAdmin(env);

  try {
    const {
      email, password, full_name, display_name,
      role, phone, hourly_rate, overtime_rate,
    } = await request.json();

    // Validate required fields
    if (!email?.trim()) return jsonResponse({ error: 'Email is required' }, 400, request, env);
    if (!password || password.length < 6) return jsonResponse({ error: 'Password must be at least 6 characters' }, 400, request, env);
    if (!full_name?.trim()) return jsonResponse({ error: 'Full name is required' }, 400, request, env);
    if (!role?.trim()) return jsonResponse({ error: 'Role is required' }, 400, request, env);

    // Check email uniqueness in employees table
    const existing = await db.select('employees', `email=eq.${encodeURIComponent(email.trim())}&limit=1`);
    if (existing.length > 0) {
      return jsonResponse({ error: 'An employee with this email already exists' }, 409, request, env);
    }

    // 1. Create Supabase Auth user
    const authUser = await db.createAuthUser(email.trim(), password, {
      full_name: full_name.trim(),
      role: role.trim(),
    });

    // 2. Create employee row linked to auth user
    const employeeData = {
      auth_user_id: authUser.id,
      email: email.trim(),
      full_name: full_name.trim(),
      display_name: (display_name?.trim()) || full_name.trim().split(' ')[0],
      role: role.trim(),
      phone: phone?.trim() || null,
      hourly_rate: hourly_rate ? parseFloat(hourly_rate) : null,
      overtime_rate: overtime_rate ? parseFloat(overtime_rate) : null,
      is_active: true,
    };

    const [employee] = await db.insert('employees', employeeData);

    return jsonResponse({ success: true, employee }, 201, request, env);

  } catch (err) {
    console.error('admin-users POST error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}

// ═══════════════════════════════════════════════════
// PATCH — Update existing user
// Body: { employee_id, email?, password?, full_name?, display_name?, role?, phone?, hourly_rate?, overtime_rate? }
// If employee has no auth_user_id and password is provided, creates auth account and links it.
// ═══════════════════════════════════════════════════
export async function onRequestPatch(context) {
  const { request, env } = context;

  const auth = await requireAdmin(request, env);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const db = supabaseAdmin(env);

  try {
    const { employee_id, ...updates } = await request.json();

    if (!employee_id) return jsonResponse({ error: 'employee_id is required' }, 400, request, env);

    // Get current employee
    const [emp] = await db.select('employees', `id=eq.${employee_id}&limit=1`);
    if (!emp) return jsonResponse({ error: 'Employee not found' }, 404, request, env);

    // ── Case 1: Employee has NO auth account — create one if password provided ──
    if (!emp.auth_user_id && updates.password && updates.password.length >= 6) {
      const email = (updates.email || emp.email)?.trim();
      if (!email) return jsonResponse({ error: 'Email is required to create auth account' }, 400, request, env);

      const authUser = await db.createAuthUser(email, updates.password, {
        full_name: (updates.full_name || emp.full_name)?.trim(),
        role: (updates.role || emp.role)?.trim(),
      });

      // Build full update including auth_user_id link
      const employeeUpdate = { auth_user_id: authUser.id };
      if (updates.email) employeeUpdate.email = updates.email.trim();
      if (updates.full_name) employeeUpdate.full_name = updates.full_name.trim();
      if (updates.display_name !== undefined) employeeUpdate.display_name = updates.display_name?.trim() || null;
      if (updates.role) employeeUpdate.role = updates.role.trim();
      if (updates.phone !== undefined) employeeUpdate.phone = updates.phone?.trim() || null;
      if (updates.hourly_rate !== undefined) employeeUpdate.hourly_rate = updates.hourly_rate ? parseFloat(updates.hourly_rate) : null;
      if (updates.overtime_rate !== undefined) employeeUpdate.overtime_rate = updates.overtime_rate ? parseFloat(updates.overtime_rate) : null;

      const [updated] = await db.update('employees', `id=eq.${employee_id}`, employeeUpdate);
      return jsonResponse({ success: true, employee: updated, auth_created: true }, 200, request, env);
    }

    // ── Case 2: Employee HAS auth account — update auth if email/password changed ──
    if (emp.auth_user_id && (updates.email || updates.password)) {
      const authUpdates = {};
      if (updates.email && updates.email.trim() !== emp.email) {
        authUpdates.email = updates.email.trim();
        authUpdates.email_confirm = true;
      }
      if (updates.password && updates.password.length >= 6) {
        authUpdates.password = updates.password;
      }
      if (Object.keys(authUpdates).length > 0) {
        await db.updateAuthUser(emp.auth_user_id, authUpdates);
      }
    }

    // Build employee update payload (exclude password)
    const employeeUpdate = {};
    if (updates.email) employeeUpdate.email = updates.email.trim();
    if (updates.full_name) employeeUpdate.full_name = updates.full_name.trim();
    if (updates.display_name !== undefined) employeeUpdate.display_name = updates.display_name?.trim() || null;
    if (updates.role) employeeUpdate.role = updates.role.trim();
    if (updates.phone !== undefined) employeeUpdate.phone = updates.phone?.trim() || null;
    if (updates.hourly_rate !== undefined) employeeUpdate.hourly_rate = updates.hourly_rate ? parseFloat(updates.hourly_rate) : null;
    if (updates.overtime_rate !== undefined) employeeUpdate.overtime_rate = updates.overtime_rate ? parseFloat(updates.overtime_rate) : null;

    if (Object.keys(employeeUpdate).length > 0) {
      const [updated] = await db.update('employees', `id=eq.${employee_id}`, employeeUpdate);
      return jsonResponse({ success: true, employee: updated }, 200, request, env);
    }

    return jsonResponse({ success: true, employee: emp }, 200, request, env);

  } catch (err) {
    console.error('admin-users PATCH error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}

// ═══════════════════════════════════════════════════
// PUT — Toggle active/inactive (ban/unban auth user)
// Body: { employee_id, is_active: boolean }
// ═══════════════════════════════════════════════════
export async function onRequestPut(context) {
  const { request, env } = context;

  const auth = await requireAdmin(request, env);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const db = supabaseAdmin(env);

  try {
    const { employee_id, is_active } = await request.json();

    if (!employee_id) return jsonResponse({ error: 'employee_id is required' }, 400, request, env);
    if (typeof is_active !== 'boolean') return jsonResponse({ error: 'is_active must be boolean' }, 400, request, env);

    // Get current employee
    const [emp] = await db.select('employees', `id=eq.${employee_id}&limit=1`);
    if (!emp) return jsonResponse({ error: 'Employee not found' }, 404, request, env);

    // Ban/unban auth user
    if (emp.auth_user_id) {
      await db.updateAuthUser(emp.auth_user_id, {
        ban_duration: is_active ? 'none' : '876600h', // ~100 years ban
      });
    }

    // Update employee row
    const [updated] = await db.update('employees', `id=eq.${employee_id}`, { is_active });

    return jsonResponse({ success: true, employee: updated }, 200, request, env);

  } catch (err) {
    console.error('admin-users PUT error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}

// ═══════════════════════════════════════════════════
// DELETE — Hard delete user (auth + employee row)
// Body: { employee_id }
// ═══════════════════════════════════════════════════
export async function onRequestDelete(context) {
  const { request, env } = context;

  const auth = await requireAdmin(request, env);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status, request, env);

  const db = supabaseAdmin(env);

  try {
    const { employee_id } = await request.json();

    if (!employee_id) return jsonResponse({ error: 'employee_id is required' }, 400, request, env);

    // Get current employee
    const [emp] = await db.select('employees', `id=eq.${employee_id}&limit=1`);
    if (!emp) return jsonResponse({ error: 'Employee not found' }, 404, request, env);

    // Delete auth user first (if linked)
    if (emp.auth_user_id) {
      await db.deleteAuthUser(emp.auth_user_id);
    }

    // Delete employee row
    await db.delete('employees', `id=eq.${employee_id}`);

    return jsonResponse({ success: true, deleted: employee_id }, 200, request, env);

  } catch (err) {
    console.error('admin-users DELETE error:', err);
    return jsonResponse({ error: err.message }, 500, request, env);
  }
}
