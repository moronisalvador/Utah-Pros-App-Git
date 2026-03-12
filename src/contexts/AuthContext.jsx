import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { realtimeClient } from '@/lib/realtime';
import { createSupabaseClient, db } from '@/lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);        // Supabase auth user
  const [employee, setEmployee] = useState(null); // Matched employee row
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Create an authenticated DB client when we have a session
  const [authDb, setAuthDb] = useState(null);

  // ── Bootstrap: check existing session ──
  useEffect(() => {
    const init = async () => {
      try {
        const { data: { session } } = await realtimeClient.auth.getSession();
        if (session?.user) {
          await handleAuthUser(session.user, session.access_token);
        }
      } catch (err) {
        console.error('Auth init error:', err);
      } finally {
        setLoading(false);
      }
    };

    init();

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = realtimeClient.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          await handleAuthUser(session.user, session.access_token);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setEmployee(null);
          setPermissions([]);
          setAuthDb(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── Match auth user → employee row ──
  const handleAuthUser = async (authUser, token) => {
    setUser(authUser);

    // Create authenticated client
    const authenticatedDb = createSupabaseClient(token);
    setAuthDb(authenticatedDb);

    try {
      // Bridge: look up employee by email (until auth_user_id is populated)
      const employees = await db.select(
        'employees',
        `email=eq.${encodeURIComponent(authUser.email)}&limit=1`
      );

      if (employees.length > 0) {
        setEmployee(employees[0]);
        await loadPermissions(employees[0].role);
      } else {
        // Auth user exists but no matching employee — could be new user
        setError('No employee record found for this email. Contact admin.');
      }
    } catch (err) {
      console.error('Employee lookup error:', err);
      setError('Failed to load employee data.');
    }
  };

  // ── Load role-based nav permissions ──
  const loadPermissions = async (role) => {
    try {
      const perms = await db.select(
        'nav_permissions',
        `role=eq.${encodeURIComponent(role)}&is_visible=eq.true&select=nav_item,can_access`
      );
      setPermissions(perms);
    } catch (err) {
      console.error('Permissions load error:', err);
      // Default: show everything for admin, minimal for others
      setPermissions([]);
    }
  };

  // ── Login ──
  const login = useCallback(async (email, password) => {
    setError(null);
    setLoading(true);
    try {
      const { data, error: authError } = await realtimeClient.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) throw authError;
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Logout ──
  const logout = useCallback(async () => {
    await realtimeClient.auth.signOut();
    setUser(null);
    setEmployee(null);
    setPermissions([]);
    setAuthDb(null);
  }, []);

  // ── Dev login: bypass auth for local development ──
  // Uses employee email directly without Supabase Auth
  const devLogin = useCallback(async (employeeEmail) => {
    setError(null);
    setLoading(true);
    try {
      const employees = await db.select(
        'employees',
        `email=eq.${encodeURIComponent(employeeEmail)}&limit=1`
      );
      if (employees.length === 0) {
        throw new Error('Employee not found');
      }
      const emp = employees[0];
      setEmployee(emp);
      setUser({ id: emp.id, email: emp.email }); // Fake user object
      setAuthDb(createSupabaseClient()); // Uses anon key in dev
      await loadPermissions(emp.role);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Permission check helper ──
  const canAccess = useCallback((navItem) => {
    if (!employee) return false;
    // Admins see everything
    if (employee.role === 'admin' || employee.role === 'owner') return true;
    // Check permissions table
    if (permissions.length === 0) return true; // No permissions loaded = show all (fallback)
    const perm = permissions.find(p => p.nav_item === navItem);
    return perm ? perm.can_access : false;
  }, [employee, permissions]);

  const value = {
    user,
    employee,
    permissions,
    loading,
    error,
    db: authDb || db, // Use authenticated client when available
    login,
    logout,
    devLogin,
    canAccess,
    isAuthenticated: !!employee,
    isDev: import.meta.env.DEV,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
