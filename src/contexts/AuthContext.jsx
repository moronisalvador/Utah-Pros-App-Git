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
    // Intercept recovery links — if URL hash contains type=recovery,
    // redirect to /set-password before anything else loads
    const hash = window.location.hash;
    if (hash.includes('type=recovery') && !window.location.pathname.startsWith('/set-password')) {
      // Preserve the hash (contains the tokens Supabase needs)
      window.location.replace('/set-password' + hash);
      return;
    }

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
        // Recovery event — redirect to set-password page
        if (event === 'PASSWORD_RECOVERY') {
          if (!window.location.pathname.startsWith('/set-password')) {
            window.location.replace('/set-password');
          }
          return;
        }

        if (event === 'SIGNED_IN' && session?.user) {
          // Skip full auth flow if we're on the set-password page (recovery in progress)
          if (window.location.pathname.startsWith('/set-password')) {
            setUser(session.user);
            setLoading(false);
            return;
          }
          await handleAuthUser(session.user, session.access_token);
        } else if (event === 'TOKEN_REFRESHED' && session?.access_token) {
          // Supabase silently refreshed the JWT — rebuild our fetch client with the new token
          // Without this, all db calls return 401 after ~1 hour
          setAuthDb(createSupabaseClient(session.access_token));
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
        `role=eq.${encodeURIComponent(role)}&can_view=eq.true&select=nav_key,can_view,can_edit`
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

  // ── Dev login: bypass auth for local development ONLY ──
  // Disabled entirely in production builds
  const devLogin = useCallback(async (employeeEmail) => {
    if (!import.meta.env.DEV) {
      throw new Error('Dev login is not available in production.');
    }
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
  const canAccess = useCallback((navKey) => {
    if (!employee) return false;
    // Admins always see everything
    if (employee.role === 'admin') return true;
    // No permissions loaded — deny by default for non-admins
    // (prevents accidental access if nav_permissions table is empty or failed to load)
    if (permissions.length === 0) return false;
    const perm = permissions.find(p => p.nav_key === navKey);
    return perm ? perm.can_view : false;
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
    // devLogin only exposed in dev builds — null in production so it can't be called
    devLogin: import.meta.env.DEV ? devLogin : null,
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
