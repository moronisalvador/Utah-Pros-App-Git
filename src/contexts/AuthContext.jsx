import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { realtimeClient } from '@/lib/realtime';
import { createSupabaseClient, db } from '@/lib/supabase';
import { registerPushForEmployee, canRegisterPush } from '@/lib/pushNotifications';
import { setBiometricEnabled } from '@/lib/nativeBiometric';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);        // Supabase auth user
  const [employee, setEmployee] = useState(null); // Matched employee row
  const [permissions, setPermissions] = useState([]);
  const [featureFlags, setFeatureFlags] = useState({}); // key → flag row
  const [employeePageAccess, setEmployeePageAccess] = useState({}); // nav_key → boolean
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
          setFeatureFlags({});
          setEmployeePageAccess({});
          setAuthDb(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── Load feature flags ──
  const loadFeatureFlags = async (dbClient = db) => {
    try {
      const rows = await dbClient.rpc('get_feature_flags');
      // Convert array → keyed object for O(1) lookups: { 'page:marketing': { enabled, dev_only_user_id, ... } }
      const flagMap = {};
      (rows || []).forEach(f => { flagMap[f.key] = f; });
      setFeatureFlags(flagMap);
    } catch (err) {
      console.error('Feature flags load error:', err);
      setFeatureFlags({}); // Fail open — no flags = everything unrestricted
    }
  };

  // ── Load per-employee page access overrides ──
  const loadEmployeePageAccess = async (employeeId, dbClient = db) => {
    try {
      const rows = await dbClient.rpc('get_employee_page_access', { p_employee_id: employeeId });
      const map = {};
      (rows || []).forEach(r => { map[r.nav_key] = r.can_view; });
      setEmployeePageAccess(map);
    } catch (err) {
      console.error('Employee page access load error:', err);
      setEmployeePageAccess({}); // Fail open — empty = no overrides = use role defaults
    }
  };

  // ── Match auth user → employee row ──
  const handleAuthUser = async (authUser, token) => {
    setUser(authUser);

    // Create authenticated client with the session token
    const authenticatedDb = createSupabaseClient(token);
    setAuthDb(authenticatedDb);

    try {
      // Use the authenticated client — anon client breaks if RLS tightens
      const employees = await authenticatedDb.select(
        'employees',
        `email=eq.${encodeURIComponent(authUser.email)}&limit=1`
      );

      if (employees.length > 0) {
        setEmployee(employees[0]);
        // Load permissions, feature flags, and page access overrides in parallel
        await Promise.all([
          loadPermissions(employees[0].role, authenticatedDb),
          loadFeatureFlags(authenticatedDb),
          loadEmployeePageAccess(employees[0].id, authenticatedDb),
        ]);
        // Register for push on native (silent no-op on web).
        // Intentionally not awaited — login shouldn't block on APNs.
        if (canRegisterPush()) {
          registerPushForEmployee(authenticatedDb, employees[0].id);
        }
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
  // Accepts an optional dbClient so we can use the authenticated client immediately after login
  const loadPermissions = async (role, dbClient = db) => {
    try {
      const perms = await dbClient.select(
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
    setBiometricEnabled(false);
    await realtimeClient.auth.signOut();
    setUser(null);
    setEmployee(null);
    setPermissions([]);
    setFeatureFlags({});
    setEmployeePageAccess({});
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
      await Promise.all([
        loadPermissions(emp.role),
        loadFeatureFlags(),
        loadEmployeePageAccess(emp.id),
      ]);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Permission check helper (4-layer priority) ──
  const canAccess = useCallback((navKey) => {
    if (!employee) return false;

    // Layer 1: Force-disabled kills the page for everyone, no exceptions
    const flag = featureFlags[`page:${navKey}`];
    if (flag?.force_disabled) return false;

    // Layer 2: Per-employee override — if a row exists, it wins over role
    if (employeePageAccess.hasOwnProperty(navKey)) {
      return employeePageAccess[navKey];
    }

    // Layer 3: Admins see everything (unless force_disabled above)
    if (employee.role === 'admin') return true;

    // Layer 4: Role-based nav_permissions (existing logic)
    if (permissions.length === 0) return false;
    const perm = permissions.find(p => p.nav_key === navKey);
    return perm ? perm.can_view : false;
  }, [employee, permissions, featureFlags, employeePageAccess]);

  // ── Feature flag check helper ──
  // No flag row = unrestricted (backwards compatible — existing pages keep working)
  // flag.enabled = globally on for everyone
  // flag.dev_only_user_id === employee.id = visible only to that specific user
  const isFeatureEnabled = useCallback((key) => {
    const flag = featureFlags[key];
    if (!flag) return true;                                          // No row = unrestricted
    if (flag.enabled) return true;                                   // Globally on
    if (employee && flag.dev_only_user_id === employee.id) return true; // Dev-only for this user
    return false;
  }, [featureFlags, employee]);

  const value = {
    user,
    employee,
    permissions,
    featureFlags,         // Raw flags map — { 'page:marketing': { enabled, ... } }
    employeePageAccess,   // { dashboard: true, conversations: false, ... } — empty = no overrides
    loading,
    error,
    db: authDb || db, // Use authenticated client when available
    login,
    logout,
    // devLogin only exposed in dev builds — null in production so it can't be called
    devLogin: import.meta.env.DEV ? devLogin : null,
    canAccess,
    isFeatureEnabled,     // isFeatureEnabled('page:marketing') → boolean
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
