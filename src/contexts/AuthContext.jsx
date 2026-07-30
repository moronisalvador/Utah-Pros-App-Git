/**
 * ════════════════════════════════════════════════
 * FILE: AuthContext.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The app's login brain. It signs people in, figures out which employee
 *   they are, what pages they may see, and which experimental features are
 *   turned on for them. It also hands every screen the database connection
 *   it should use. Every other part of the app asks this file "who is logged
 *   in and what can they do?" via the useAuth() hook.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (context provider)
 *   Rendered by:  src/App.jsx (wraps the whole routed app)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/realtime (Supabase auth session), @/lib/supabase
 *              (anon bootstrap client), @/lib/stableDb (identity-stable
 *              authenticated client), @/lib/pushNotifications,
 *              @/lib/nativeBiometric, @/lib/registerSW, @/components/tech/v2/nav,
 *              @/components/SessionExpiredBanner, ./authBootstrap
 *   Data:      reads  → get_my_employee_profile, nav_permissions, feature
 *                       flags (get_feature_flags), employee page access
 *                       (get_employee_page_access)
 *              writes → account-scoped local/device state, push bindings, and
 *                       authenticated sign-in/sign-out state
 *
 * NOTES / GOTCHAS:
 *   - The authenticated `db` client is IDENTITY-STABLE on purpose: hourly
 *     token renewals (TOKEN_REFRESHED) swap the JWT inside a ref via
 *     bindAuthDb() — they must never mint a new client object, because every
 *     page keys its data loader on [db] and a new identity would re-run all
 *     of them, visibly "resetting" pages right when the app resumes from
 *     background. See src/lib/stableDb.js before changing anything here.
 *   - The anon `db` import is the sanctioned bootstrapping exception to
 *     CLAUDE.md Rule 3 for explicit public pre-login reads only. Employee
 *     identity always requires a real authenticated session.
 *   - recoverSession() is the app's ONLY 401 handler. stableDb.js calls it when
 *     the database rejects the JWT; it renews once (single-flight) or flips
 *     `sessionExpired`. Nothing else should hand-roll a 401 branch.
 *   - Explicit sign-out (logout()) may complete visually after a bounded
 *     silent push-detach retry when the only residual is a journaled
 *     same-owner push cleanup (owner decision 2026-07-29, silent by design —
 *     see accountDeviceCleanup.js). Every other cleanup-blocked path
 *     (password recovery, foreign-owner recovery, signed-out reauth, login)
 *     still hard-walls behind the full-screen retry lock.
 * ════════════════════════════════════════════════
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { realtimeClient } from '@/lib/realtime';
import { db } from '@/lib/supabase';
import { createTokenBoundClient } from '@/lib/stableDb';
import {
  canRegisterPush,
  isNativePushEnrollmentEnabled,
  registerPushForEmployee,
} from '@/lib/pushNotifications';
import {
  cleanupAccountDeviceState,
  detachAccountPushDevices,
  retryPendingAccountPushDetaches,
} from '@/lib/accountDeviceCleanup';
import { WEB_PUSH_FLAG_MIRROR_KEY } from '@/lib/registerSW';
import {
  fingerprintPwaPrincipal,
  reconcilePwaAccountOwner,
} from '@/lib/pwaAccountState';
import {
  isStandaloneDisplay,
  readPwaOwnerLease,
} from '@/lib/resumeRestore';
import { reconcilePushServiceWorker } from '@/lib/pwaServiceWorker';
import { buildResetUrl } from '@/lib/staleChunkReload';
import {
  restorePersistedTechQueries,
} from '@/lib/techQueryPersister';
import { techQueryClient } from '@/lib/techQuery';
import { RELEASE } from '@/lib/releaseIdentity';
import { setHubNav } from '@/components/tech/v2/nav';
import SessionExpiredBanner from '@/components/SessionExpiredBanner';
import {
  classifyEmployeeBootstrap,
  createAuthProviderLifecycle,
  getAccountLandingPath,
} from './authBootstrap.js';

const AuthContext = createContext(null);
const ACCOUNT_CLEANUP_BLOCKED_MESSAGE = (
  'This device could not finish securing the previous account. '
  + 'Retry before signing out or signing in to another account.'
);
const PREVIOUS_ACCOUNT_RECOVERY_MESSAGE = (
  'This device has unfinished notification cleanup from a previous account. '
  + 'Sign in to that previous account to finish securely.'
);
const CANONICAL_UUID_PATTERN = (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
);
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const AUTHORIZATION_KEY_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,127}$/;
const SUPPORTED_EMPLOYEE_ROLES = new Set([
  'admin',
  'office',
  'project_manager',
  'field_tech',
  'estimator',
  'supervisor',
  'crm_partner',
]);

function isCanonicalUuid(value) {
  return typeof value === 'string'
    && value !== NIL_UUID
    && CANONICAL_UUID_PATTERN.test(value);
}

function isAuthorizationKey(value) {
  return typeof value === 'string'
    && AUTHORIZATION_KEY_PATTERN.test(value);
}

function isValidEmployeeProfile(employee) {
  return !!employee
    && typeof employee === 'object'
    && !Array.isArray(employee)
    && isCanonicalUuid(employee.id)
    && SUPPORTED_EMPLOYEE_ROLES.has(employee.role)
    && typeof employee.is_active === 'boolean'
    && typeof employee.is_external === 'boolean';
}

// ONE copy of the deferral authorization decision, shared by
// requireAccountCleanup and the SIGNED_OUT observer: a block set by a
// recovery/reauth flow is never dropped through sign-out deferral.
function cleanupBlockAllowsDeferral(block) {
  return block?.recoveryRequired !== true
    && block?.passwordRecovery !== true
    && block?.signedOutReauthRequired !== true;
}

function localSignOutError(result) {
  if (
    !result
    || typeof result !== 'object'
    || Array.isArray(result)
    || !Object.prototype.hasOwnProperty.call(result, 'error')
  ) {
    return new Error('Local sign out response is malformed');
  }
  if (result.error === null) return null;
  if (result.error instanceof Error) return result.error;
  return new Error(result.error?.message || 'Local sign out failed');
}

// Mirror the effective `feature:web_push` state into localStorage so main.jsx —
// which runs BEFORE auth/flags load — can decide at the next page-load whether to
// register the push service worker. Uses the SAME enabled/dev-only resolution as
// isFeatureEnabled so the worker registration always tracks what the UI gates on.
// A missing flag row = OFF here (deliberately stricter than isFeatureEnabled's
// "missing = unrestricted": we never want to register the SW for everyone by
// accident — the flag is seeded explicitly OFF).
function writeWebPushMirror(flag, emp) {
  const on = !!flag && (flag.enabled || (emp && flag.dev_only_user_id === emp.id));
  try {
    localStorage.setItem(WEB_PUSH_FLAG_MIRROR_KEY, on ? '1' : '0');
  } catch { /* storage blocked — main.jsx defaults to OFF */ }
  return on;
}

function resetAfterServiceWorkerChange() {
  try {
    if (sessionStorage.getItem('swReset')) return;
    sessionStorage.setItem('swReset', '1');
  } catch {
    // A blocked session marker must not prevent one cache-reset recovery.
  }
  window.location.replace(
    buildResetUrl(window.location.pathname + window.location.search),
  );
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);        // Supabase auth user
  const [employee, setEmployee] = useState(null); // Matched employee row
  const [permissions, setPermissions] = useState([]);
  const [featureFlags, setFeatureFlags] = useState({}); // key → flag row
  const [employeePageAccess, setEmployeePageAccess] = useState({}); // nav_key → boolean
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pwaOwnerLease, setPwaOwnerLease] = useState(null);
  const [cleanupRetrying, setCleanupRetrying] = useState(false);

  // Create an authenticated DB client when we have a session.
  // IDENTITY-STABLE by design: the client object is created ONCE and reads the
  // current JWT from tokenRef at each request (createTokenBoundClient). Token
  // renewals update the ref only — they must NOT mint a new client object,
  // because every page keys its data loader on [db] (CLAUDE.md pattern) and a
  // new identity would re-run all of them, visibly "resetting" pages right
  // when the app resumes from background (~hourly TOKEN_REFRESHED).
  const [authDb, setAuthDb] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const authLifecycleRef = useRef(null);
  if (!authLifecycleRef.current) {
    authLifecycleRef.current = createAuthProviderLifecycle();
  }
  const authLifecycle = authLifecycleRef.current;
  const activePrincipalRef = useRef(null);
  const readyPrincipalRef = useRef(null);
  const readyOwnerRef = useRef(readPwaOwnerLease()?.owner || null);
  const tokenRef = useRef(null);
  const stableDbRef = useRef(null);
  const recoverRef = useRef(null);   // → recoverSession (assigned below; see bindAuthDb)
  const refreshingRef = useRef(null); // in-flight refresh promise (single-flight)
  const explicitLogoutRef = useRef(null);
  const cleanupBlockRef = useRef(null);
  const bindAuthDb = (token) => {
    tokenRef.current = token;
    if (!stableDbRef.current) {
      stableDbRef.current = createTokenBoundClient(() => tokenRef.current, {
        // Indirection through a ref on purpose: recoverSession is defined below
        // and itself calls bindAuthDb, so naming it directly here would be a
        // circular reference. The ref is assigned during render, long before any
        // request can fire from an effect.
        onAuthError: () => (recoverRef.current ? recoverRef.current() : Promise.resolve(false)),
      });
    }
    setAuthDb(stableDbRef.current); // same identity after first call — no-op re-render
    return stableDbRef.current;
  };

  // ── Session recovery — the app's ONE 401 handler ──
  // Called by the db client when PostgREST rejects the JWT. Resolves true once a
  // fresh token is bound (the caller then retries), false when the session is
  // genuinely gone — which flips `sessionExpired` so the banner can say so.
  //
  // SINGLE-FLIGHT is not optional: a page firing five parallel loaders must not
  // fire five refreshSession() calls. Supabase rotates refresh tokens, so the
  // losers of that race fail with "Already Used" and can kill a session that was
  // still recoverable — a plausible way to reach the dead-session state at all.
  //
  // Why this exists: before it, a failed renewal left the expired JWT in
  // tokenRef forever. Every call 401'd into a silent catch, so the only visible
  // symptom was the notification bell logging a 401 a minute, all night, with
  // nothing on screen — while Save/Receive-payment would have failed too.
  const recoverSession = useCallback(async () => {
    if (refreshingRef.current) return refreshingRef.current; // join the in-flight attempt
    const generation = authLifecycle.current();
    const principalId = activePrincipalRef.current;
    refreshingRef.current = (async () => {
      try {
        const { data, error: refreshError } = await realtimeClient.auth.refreshSession();
        const token = data?.session?.access_token;
        if (refreshError || !token) throw refreshError || new Error('No session returned');
        if (
          !authLifecycle.isCurrent(generation)
          || !principalId
          || data?.session?.user?.id !== principalId
        ) {
          return false;
        }
        bindAuthDb(token);
        setSessionExpired(false);
        return true;
      } catch {
        authLifecycle.commit(generation, () => setSessionExpired(true));
        return false;
      } finally {
        refreshingRef.current = null;
      }
    })();
    return refreshingRef.current;
  }, [authLifecycle]);
  recoverRef.current = recoverSession;

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
      const generation = authLifecycle.begin();
      try {
        const { data: { session } } = await realtimeClient.auth.getSession();
        if (
          session?.user
          && window.location.pathname.startsWith('/set-password')
        ) {
          // A recovery session may update the credential, but it must not
          // bootstrap employee authorization. Re-run device cleanup on reload
          // before exposing SetPassword so a crash cannot bypass a durable
          // pending-detach journal.
          const recoveryDb = bindAuthDb(session.access_token);
          const recoveryOwnerKey = readyOwnerRef.current;
          cleanupBlockRef.current = {
            db: recoveryDb,
            principalId: session.user.id,
            ownerKey: recoveryOwnerKey,
            recoveryRequired: false,
            passwordRecovery: true,
          };
          authLifecycle.commit(generation, () => {
            setError(null);
            setLoading(true);
          });
          const cleanupPromise = authLifecycle.enqueueAccountState(
            generation,
            () => clearRejectedPrincipalState(recoveryDb, {
              ownerKey: recoveryOwnerKey,
            }),
            { requireCurrent: false },
          );
          const cleanupResult = await requireAccountCleanup(
            generation,
            {
              dbClient: recoveryDb,
              principalId: session.user.id,
              ownerKey: recoveryOwnerKey,
              cleanupPromise,
            },
          );
          if (cleanupResult.cancelled) return;
          if (cleanupResult.ready !== true) {
            authLifecycle.commit(generation, () => {
              setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
              setLoading(true);
            });
            return;
          }
          finishPasswordRecoveryCleanup(generation);
          return;
        }
        if (
          session?.user
          && await authLifecycle.waitForAccountState(generation)
        ) {
          await handleAuthUser(
            session.user,
            session.access_token,
            generation,
          );
        }
      } catch (err) {
        if (authLifecycle.isCurrent(generation)) {
          console.error('Auth init error:', err);
        }
      } finally {
        authLifecycle.commit(
          generation,
          () => setLoading(cleanupBlockRef.current !== null),
        );
      }
    };

    init();

    // Supabase invokes onAuthStateChange while holding its internal auth lock.
    // Calling another auth method from that callback (notably signOut() after a
    // rejected bootstrap) can otherwise wait forever trying to reacquire the
    // same lock. The SDK callback below therefore records the event and returns
    // synchronously. One macrotask later, this queue processes every event in
    // callback order without overlapping auth transitions.
    let authObserverActive = true;
    let authEventTimer = null;
    const pendingAuthEvents = [];
    let authEventQueue = Promise.resolve();

    const processAuthStateChange = async (
      event,
      session,
      observedLogout,
    ) => {
        // Recovery event — redirect to set-password page
        if (event === 'PASSWORD_RECOVERY') {
          const generation = authLifecycle.begin();
          const priorPrincipal = activePrincipalRef.current
            || readyPrincipalRef.current
            || session?.user?.id
            || null;
          const priorDb = tokenRef.current && stableDbRef.current
            ? stableDbRef.current
            : session?.access_token
              ? bindAuthDb(session.access_token)
              : stableDbRef.current;
          const priorOwnerKey = cleanupBlockRef.current?.ownerKey
            || readyOwnerRef.current;
          explicitLogoutRef.current = null;
          cleanupBlockRef.current = {
            db: priorDb,
            principalId: priorPrincipal,
            ownerKey: priorOwnerKey,
            recoveryRequired: false,
            passwordRecovery: true,
          };
          authLifecycle.commit(generation, () => {
            setError(null);
            setLoading(true);
          });
          const cleanupPromise = authLifecycle.enqueueAccountState(
            generation,
            () => clearRejectedPrincipalState(priorDb, {
              ownerKey: priorOwnerKey,
            }),
            { requireCurrent: false },
          );
          const cleanupResult = await requireAccountCleanup(
            generation,
            {
              dbClient: priorDb,
              principalId: priorPrincipal,
              ownerKey: priorOwnerKey,
              cleanupPromise,
            },
          );
          if (cleanupResult.cancelled) return;
          if (cleanupResult.ready !== true) {
            authLifecycle.commit(generation, () => {
              setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
              setLoading(true);
            });
            return;
          }
          finishPasswordRecoveryCleanup(generation);
          return;
        }

        if (event === 'SIGNED_IN' && session?.user) {
          // Supabase can repeat SIGNED_IN for the same established session
          // (tab focus, session re-emission). Keep the published account and
          // current route intact; this event only needs to refresh the token.
          if (
            readyPrincipalRef.current === session.user.id
            && activePrincipalRef.current === session.user.id
            && !cleanupBlockRef.current
          ) {
            bindAuthDb(session.access_token);
            setSessionExpired(false);
            return;
          }

          const priorPrincipal = cleanupBlockRef.current?.principalId
            || activePrincipalRef.current
            || readyPrincipalRef.current;
          const priorDb = cleanupBlockRef.current?.db
            || stableDbRef.current;
          const priorOwnerKey = cleanupBlockRef.current?.ownerKey
            || readyOwnerRef.current;
          explicitLogoutRef.current = null;
          const generation = authLifecycle.begin();
          authLifecycle.commit(generation, () => setLoading(true));
          // Skip full auth flow if we're on the set-password page (recovery in progress)
          if (window.location.pathname.startsWith('/set-password')) {
            authLifecycle.commit(generation, () => {
              activePrincipalRef.current = session.user.id;
              readyPrincipalRef.current = null;
              setUser(session.user);
              setLoading(false);
            });
            return;
          }
          if (
            cleanupBlockRef.current
            || (
              priorPrincipal
              && priorPrincipal !== session.user.id
            )
          ) {
            const cleanupResult = await requireAccountCleanup(
              generation,
              {
                dbClient: priorDb,
                principalId: priorPrincipal,
                ownerKey: priorOwnerKey,
              },
            );
            if (cleanupResult.cancelled) return;
            if (!cleanupResult.ready) {
              authLifecycle.commit(generation, () => {
                setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
                setLoading(true);
              });
              return;
            }
            if (!clearPublishedPrincipal(generation)) return;
          }
          if (!await authLifecycle.waitForAccountState(generation)) return;
          authLifecycle.commit(
            generation,
            () => setSessionExpired(false),
          );
          await handleAuthUser(
            session.user,
            session.access_token,
            generation,
          );
          authLifecycle.commit(
            generation,
            () => setLoading(cleanupBlockRef.current !== null),
          );
        } else if (event === 'TOKEN_REFRESHED' && session?.access_token) {
          // Supabase silently refreshed the JWT — swap the token IN PLACE.
          // Without this, all db calls return 401 after ~1 hour. bindAuthDb
          // keeps the client's identity stable so no [db]-keyed loader re-runs.
          if (
            !activePrincipalRef.current
            || !session.user?.id
            || session.user.id !== activePrincipalRef.current
          ) {
            return;
          }
          bindAuthDb(session.access_token);
          setSessionExpired(false); // the session healed itself — drop the banner
        } else if (event === 'SIGNED_OUT') {
          const explicitLogout = observedLogout
            || explicitLogoutRef.current;
          if (explicitLogout?.finalized) {
            if (explicitLogoutRef.current === explicitLogout) {
              explicitLogoutRef.current = null;
            }
            return;
          }
          const priorPrincipal = cleanupBlockRef.current?.principalId
            || activePrincipalRef.current
            || readyPrincipalRef.current;
          const generation = explicitLogout?.generation
            || authLifecycle.begin();
          const priorDb = explicitLogout?.db
            || cleanupBlockRef.current?.db
            || stableDbRef.current;
          const priorOwnerKey = explicitLogout?.ownerKey
            || cleanupBlockRef.current?.ownerKey
            || readyOwnerRef.current;
          authLifecycle.commit(generation, () => {
            activePrincipalRef.current = null;
            readyPrincipalRef.current = null;
            setUser(null);
            setEmployee(null);
            setPermissions([]);
            setFeatureFlags({});
            setEmployeePageAccess({});
            setPwaOwnerLease(null);
            setHubNav(false);
            writeWebPushMirror(null, null);
            setError(null);
            setLoading(true);
            setSessionExpired(false);
          });
          const cleanupResult = await (
            explicitLogout?.cleanupPromise
            || authLifecycle.enqueueAccountState(
              generation,
              () => clearRejectedPrincipalState(priorDb, {
                ownerKey: priorOwnerKey,
              }),
              { requireCurrent: false },
            )
          );
          if (!authLifecycle.isCurrent(generation)) return;
          if (explicitLogout) {
            explicitLogout.finalized = true;
          }
          if (explicitLogoutRef.current === explicitLogout) {
            explicitLogoutRef.current = null;
          }
          // Race backstop for the same explicit logout: its cleanup may have
          // classified a journaled-transient residual as deferrable, and this
          // observer must not re-wall what logout() is completing. An
          // observer-only SIGNED_OUT (no explicit transition) never defers —
          // the signed-out reauth wall stays exactly as before. The shared
          // refusal keeps a concurrent recovery flow's block intact (its
          // begin() also makes this generation stale — defense in depth).
          const deferredExplicitCleanup = !!explicitLogout
            && cleanupResult?.deferrable === true
            && cleanupBlockAllowsDeferral(cleanupBlockRef.current);
          if (cleanupResult?.ready !== true && !deferredExplicitCleanup) {
            const signedOutReauthRequired = !explicitLogout;
            cleanupBlockRef.current = {
              db: priorDb,
              principalId: priorPrincipal,
              ownerKey: priorOwnerKey,
              signedOutReauthRequired,
            };
            authLifecycle.commit(generation, () => {
              setError(
                signedOutReauthRequired
                  ? PREVIOUS_ACCOUNT_RECOVERY_MESSAGE
                  : ACCOUNT_CLEANUP_BLOCKED_MESSAGE,
              );
              setLoading(true);
            });
            return;
          }
          cleanupBlockRef.current = null;
          readyOwnerRef.current = null;
          authLifecycle.commit(generation, () => {
            tokenRef.current = null;
            setAuthDb(null);
            setError(explicitLogout?.postSignOutError || null);
            setLoading(false);
          });
          // An observer-only SIGNED_OUT proves the session is already gone, so
          // any worker reset is now safe. Explicit logout performs this after
          // signOut() itself confirms success.
          if (
            !explicitLogout
            && cleanupResult?.reloadRequired
            && authLifecycle.isCurrent(generation)
          ) {
            resetAfterServiceWorkerChange();
          }
        }
    };

    const appendPendingAuthEvents = () => {
      authEventTimer = null;
      if (!authObserverActive) {
        pendingAuthEvents.length = 0;
        return;
      }

      const nextEvents = pendingAuthEvents.splice(0);
      nextEvents.forEach(({ event, session, observedLogout }) => {
        authEventQueue = authEventQueue
          .then(async () => {
            if (!authObserverActive) return;
            await processAuthStateChange(
              event,
              session,
              observedLogout,
            );
          })
          .catch((eventError) => {
            if (authObserverActive) {
              console.error('Auth state change error:', eventError);
            }
          });
      });
    };

    // Listen for auth state changes (login, logout, token refresh). This
    // callback must remain synchronous: even returning the Promise produced by
    // the serialized queue would keep the Supabase auth lock held.
    const { data: { subscription } } = realtimeClient.auth.onAuthStateChange(
      (event, session) => {
        if (!authObserverActive) return;
        const observedLogout = event === 'SIGNED_OUT'
          ? explicitLogoutRef.current
          : null;
        if (observedLogout) {
          // This synchronous marker is observation only. All state publication
          // and cleanup stays outside the SDK lock in processAuthStateChange().
          observedLogout.signedOutObserved = true;
        }
        pendingAuthEvents.push({ event, session, observedLogout });
        if (authEventTimer === null) {
          authEventTimer = setTimeout(appendPendingAuthEvents, 0);
        }
      },
    );

    return () => {
      authObserverActive = false;
      pendingAuthEvents.length = 0;
      if (authEventTimer !== null) {
        clearTimeout(authEventTimer);
        authEventTimer = null;
      }
      authLifecycle.begin();
      subscription.unsubscribe();
    };
  // This subscription intentionally mounts once. Its async callbacks use the
  // stable lifecycle/ref objects above; resubscribing during state publication
  // would create overlapping Supabase auth observers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load bootstrap authorization inputs ──
  // These helpers return data instead of publishing React state. handleAuthUser
  // commits one complete account snapshot only after every read and serialized
  // account-state reconciliation still belongs to its generation.
  const loadFeatureFlags = async (dbClient = db) => {
    const rows = await dbClient.rpc('get_feature_flags');
    if (!Array.isArray(rows)) {
      throw new Error('Feature flag authorization response is malformed');
    }
    // Convert array → keyed object for O(1) lookups:
    // { 'page:marketing': { enabled, dev_only_user_id, ... } }. A transport or
    // authorization failure must reject the entire employee bootstrap; treating
    // it as `{}` would make every missing flag read as enabled.
    const flagMap = {};
    rows.forEach((flag) => {
      if (
        !flag
        || typeof flag !== 'object'
        || Array.isArray(flag)
        || !isAuthorizationKey(flag.key)
        || typeof flag.enabled !== 'boolean'
        || typeof flag.force_disabled !== 'boolean'
        || (
          flag.dev_only_user_id !== null
          && !isCanonicalUuid(flag.dev_only_user_id)
        )
        || Object.prototype.hasOwnProperty.call(flagMap, flag.key)
      ) {
        throw new Error('Feature flag authorization response is malformed');
      }
      flagMap[flag.key] = flag;
    });
    return flagMap;
  };

  // ── Load per-employee page access overrides ──
  const loadEmployeePageAccess = async (employeeId, dbClient = db) => {
    const rows = await dbClient.rpc('get_employee_page_access', { p_employee_id: employeeId });
    if (!Array.isArray(rows)) {
      throw new Error('Employee page access response is malformed');
    }
    const map = {};
    rows.forEach((row) => {
      if (
        !row
        || typeof row !== 'object'
        || Array.isArray(row)
        || !isAuthorizationKey(row.nav_key)
        || typeof row.can_view !== 'boolean'
        || Object.prototype.hasOwnProperty.call(map, row.nav_key)
      ) {
        throw new Error('Employee page access response is malformed');
      }
      map[row.nav_key] = row.can_view;
    });
    return map;
  };

  // ── Load role-based nav permissions ──
  const loadPermissions = async (role, dbClient = db) => {
    const rows = await dbClient.select(
      'nav_permissions',
      `role=eq.${encodeURIComponent(role)}&can_view=eq.true&select=nav_key,can_view,can_edit`,
    );
    if (!Array.isArray(rows)) {
      throw new Error('Navigation permission response is malformed');
    }
    const seenKeys = new Set();
    rows.forEach((row) => {
      if (
        !row
        || typeof row !== 'object'
        || Array.isArray(row)
        || !isAuthorizationKey(row.nav_key)
        || typeof row.can_view !== 'boolean'
        || typeof row.can_edit !== 'boolean'
        || seenKeys.has(row.nav_key)
      ) {
        throw new Error('Navigation permission response is malformed');
      }
      seenKeys.add(row.nav_key);
    });
    return rows;
  };

  // Fail closed for an authenticated principal that cannot complete employee
  // bootstrap. The new session may not own the prior account's server rows, but
  // local Web/native delivery, query persistence, and route restore must still
  // be revoked before the login screen is exposed.
  const clearRejectedPrincipalState = useCallback(async (
    dbClient,
    { ownerKey = null, transientPushRetry = false } = {},
  ) => {
    writeWebPushMirror(null, null);
    return cleanupAccountDeviceState(dbClient, {
      clearCaches: false,
      ownerKey,
      transientPushRetry,
    });
  }, []);

  // Run cleanup with the database client that is still bound to the account
  // being removed. A void delete RPC that resolves is success (including an
  // already-missing row); a denied/missing/timed-out call keeps the old client
  // and principal in this ref so logout/login can retry without binding a new
  // token over them.
  const requireAccountCleanup = useCallback(async (
    generation,
    {
      dbClient = cleanupBlockRef.current?.db || stableDbRef.current,
      principalId = cleanupBlockRef.current?.principalId
        || activePrincipalRef.current
        || readyPrincipalRef.current,
      ownerKey = cleanupBlockRef.current?.ownerKey
        || readyOwnerRef.current,
      cleanupPromise = null,
      allowDeferred = false,
    } = {},
  ) => {
    let cleanupResult;
    try {
      cleanupResult = cleanupPromise
          ? await cleanupPromise
          : await authLifecycle.enqueueAccountState(
            generation,
            () => clearRejectedPrincipalState(dbClient, { ownerKey }),
            { requireCurrent: false },
          );
    } catch (cleanupError) {
      cleanupResult = {
        ready: false,
        reason: 'account-device-cleanup-failed',
        error: cleanupError,
      };
    }

    if (!authLifecycle.isCurrent(generation)) {
      return {
        ...cleanupResult,
        ready: false,
        cancelled: true,
      };
    }
    if (cleanupResult?.ready === true) {
      cleanupBlockRef.current = null;
      return cleanupResult;
    }

    // Journaled-transient residual on an explicit sign-out (owner decision
    // 2026-07-29): local delivery is revoked and a same-owner pending-detach
    // journal survives, so the bind-time gate (handleAuthUser →
    // retryPendingAccountPushDetaches) enforces reconciliation — or the
    // previous-account recovery wall — before any account publishes again.
    // Never defers over a recovery/reauth block another flow set.
    if (
      allowDeferred
      && cleanupResult?.deferrable === true
      && cleanupBlockAllowsDeferral(cleanupBlockRef.current)
    ) {
      cleanupBlockRef.current = null;
      return {
        ...cleanupResult,
        ready: false,
        deferred: true,
      };
    }

    cleanupBlockRef.current = {
      db: dbClient,
      principalId,
      ownerKey,
      recoveryRequired: cleanupBlockRef.current?.recoveryRequired === true,
      passwordRecovery: cleanupBlockRef.current?.passwordRecovery === true,
      signedOutReauthRequired:
        cleanupBlockRef.current?.signedOutReauthRequired === true,
    };
    return {
      ...cleanupResult,
      ready: false,
    };
  }, [authLifecycle, clearRejectedPrincipalState]);

  const clearPublishedPrincipal = useCallback((generation) => authLifecycle.commit(
    generation,
    () => {
      activePrincipalRef.current = null;
      readyPrincipalRef.current = null;
      readyOwnerRef.current = null;
      tokenRef.current = null;
      setUser(null);
      setEmployee(null);
      setPermissions([]);
      setFeatureFlags({});
      setEmployeePageAccess({});
      setPwaOwnerLease(null);
      setHubNav(false);
      setAuthDb(null);
      writeWebPushMirror(null, null);
    },
  ), [authLifecycle]);

  const finishPasswordRecoveryCleanup = useCallback((generation) => {
    if (!authLifecycle.isCurrent(generation)) return false;
    cleanupBlockRef.current = null;
    explicitLogoutRef.current = null;
    if (!clearPublishedPrincipal(generation)) return false;
    authLifecycle.commit(generation, () => {
      setSessionExpired(false);
      setError(null);
      setLoading(false);
    });
    if (!window.location.pathname.startsWith('/set-password')) {
      window.location.replace('/set-password');
    }
    return true;
  }, [authLifecycle, clearPublishedPrincipal]);

  /**
   * A rejected authenticated bootstrap may expose Login only after device
   * cleanup and a confirmed local Supabase sign-out. The token-bound client is
   * retained behind the hard lock when sign-out fails so the same owner can
   * retry without rebinding another account over it.
   */
  const finishRejectedPrincipal = useCallback(async (
    generation,
    {
      cleanupResult,
      dbClient,
      principalId,
      ownerKey,
      rejectionMessage,
    },
  ) => {
    if (!authLifecycle.isCurrent(generation)) {
      return { ready: false, cancelled: true };
    }
    if (cleanupResult?.ready !== true) {
      authLifecycle.commit(generation, () => {
        setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
        setLoading(true);
      });
      return { ready: false };
    }

    const transition = {
      cleanupPromise: Promise.resolve(cleanupResult),
      db: dbClient,
      generation,
      ownerKey,
      postSignOutError: rejectionMessage,
      signedOutObserved: false,
      finalized: false,
    };
    explicitLogoutRef.current = transition;

    let signOutError = null;
    try {
      const signOutResult = await realtimeClient.auth.signOut({
        scope: 'local',
      });
      signOutError = localSignOutError(signOutResult);
    } catch (error) {
      signOutError = error;
    }
    if (!authLifecycle.isCurrent(generation)) {
      return { ready: false, cancelled: true };
    }

    // A SIGNED_OUT observation is stronger evidence than a late error returned
    // by signOut(): the local Supabase session is already gone in that case.
    if (signOutError && !transition.signedOutObserved) {
      if (explicitLogoutRef.current === transition) {
        explicitLogoutRef.current = null;
      }
      cleanupBlockRef.current = {
        db: dbClient,
        principalId,
        ownerKey,
        recoveryRequired: false,
        passwordRecovery: false,
      };
      authLifecycle.commit(generation, () => {
        setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
        setLoading(true);
      });
      return {
        ready: false,
        reason: 'local-sign-out-failed',
        error: signOutError,
      };
    }

    cleanupBlockRef.current = null;
    transition.finalized = true;
    if (explicitLogoutRef.current === transition) {
      explicitLogoutRef.current = null;
    }
    if (!clearPublishedPrincipal(generation)) {
      return { ready: false, cancelled: true };
    }
    authLifecycle.commit(generation, () => {
      setSessionExpired(false);
      setError(rejectionMessage);
      setLoading(false);
    });
    return { ready: true };
  }, [authLifecycle, clearPublishedPrincipal]);

  // ── Match auth user → employee row ──
  const handleAuthUser = async (authUser, token, generation) => {
    let authenticatedOwnerKey = null;
    if (!authLifecycle.commit(generation, () => {
      activePrincipalRef.current = authUser.id;
      readyPrincipalRef.current = null;
      setError(null);
      setUser(authUser);
      setEmployee(null);
      setPermissions([]);
      setFeatureFlags({});
      setEmployeePageAccess({});
      setPwaOwnerLease(null);
      setHubNav(false);
      writeWebPushMirror(null, null);
    })) {
      return;
    }

    // Bind the session token to the identity-stable authenticated client
    const authenticatedDb = bindAuthDb(token);

    try {
      // The selector-free RPC resolves auth.uid() inside the trusted boundary.
      // Requiring one active row keeps a stale/disabled membership from
      // bootstrapping UI gates without exposing auth_user_id or pay fields.
      const employees = await authenticatedDb.rpc(
        'get_my_employee_profile',
      );
      if (!authLifecycle.isCurrent(generation)) return;
      if (!Array.isArray(employees)) {
        throw new Error('Employee identity response is malformed');
      }
      if (employees.length > 1) {
        throw new Error('Employee identity mapping is ambiguous');
      }
      if (employees.length === 1 && !isValidEmployeeProfile(employees[0])) {
        throw new Error('Employee identity response is malformed');
      }

      if (employees.length === 1) {
        const emp = employees[0];
        authenticatedOwnerKey = await fingerprintPwaPrincipal(
          authUser.id,
          emp.id,
        );
        if (!authLifecycle.isCurrent(generation)) return;
        if (!authenticatedOwnerKey) {
          throw new Error('Authenticated device owner could not be verified');
        }
        const configuredDevEmail = String(
          import.meta.env.VITE_DEV_TEST_EMAIL || '',
        ).trim().toLowerCase();
        const isDedicatedDevAccount = import.meta.env.DEV
          && configuredDevEmail.length > 0
          && String(authUser.email || '').trim().toLowerCase()
            === configuredDevEmail;
        const bootstrap = classifyEmployeeBootstrap(emp, {
          allowExternalDevAccount: isDedicatedDevAccount,
        });
        if (!bootstrap.allowed) throw new Error(bootstrap.reason);

        const pendingPush = await authLifecycle.enqueueAccountState(
          generation,
          () => retryPendingAccountPushDetaches(authenticatedDb, {
            ownerKey: authenticatedOwnerKey,
          }),
        );
        if (!authLifecycle.isCurrent(generation)) return;
        if (pendingPush?.ready !== true) {
          cleanupBlockRef.current = {
            db: authenticatedDb,
            principalId: authUser.id,
            ownerKey: authenticatedOwnerKey,
            recoveryRequired: pendingPush?.ownerMismatch === true,
          };
          authLifecycle.commit(generation, () => {
            setError(
              pendingPush?.ownerMismatch
                ? PREVIOUS_ACCOUNT_RECOVERY_MESSAGE
                : ACCOUNT_CLEANUP_BLOCKED_MESSAGE,
            );
            setLoading(true);
          });
          return;
        }

        // S1h personal page access is active-internal only. The existing
        // crm_partner product identity is intentionally confined by its role/RLS
        // boundary and therefore has no personal override map.
        const pageAccessLoad = bootstrap.loadPersonalPageAccess
          ? loadEmployeePageAccess(emp.id, authenticatedDb)
          : Promise.resolve({});

        // Do not publish the employee (and make canAccess usable) until the
        // security-significant personal override read has succeeded.
        const [
          nextPermissions,
          nextFeatureFlags,
          nextPageAccess,
        ] = await Promise.all([
          loadPermissions(emp.role, authenticatedDb),
          loadFeatureFlags(authenticatedDb),
          pageAccessLoad,
        ]);
        if (!authLifecycle.isCurrent(generation)) return;

        const webPushEnabled = !!nextFeatureFlags['feature:web_push']
          && (
            nextFeatureFlags['feature:web_push'].enabled
            || nextFeatureFlags['feature:web_push'].dev_only_user_id === emp.id
          );
        const hubFlag = nextFeatureFlags['page:tech_job_hub'];
        const hubEnabled = !!hubFlag
          && (hubFlag.enabled || hubFlag.dev_only_user_id === emp.id);

        // Account-owned browser/native state is serialized across auth events.
        // A newer principal waits for this work, while a stale queued bootstrap
        // is skipped before it can record or publish the wrong owner.
        const accountState = await authLifecycle.enqueueAccountState(
          generation,
          async () => {
            const pwaOwner = await reconcilePwaAccountOwner({
              authUserId: authUser.id,
              employeeId: emp.id,
              pushCleanup: () => detachAccountPushDevices(
                authenticatedDb,
                { ownerKey: authenticatedOwnerKey },
              ),
            });
            if (!pwaOwner.ready || !pwaOwner.lease) {
              throw new Error(
                `Account-owned device state is not ready: ${
                  pwaOwner.reason || 'unknown'
                }`,
              );
            }
            if (!authLifecycle.isCurrent(generation)) {
              return { cancelled: true, pwaOwner };
            }
            const restored = await restorePersistedTechQueries(
              techQueryClient,
              pwaOwner.lease,
              {
                buster: RELEASE.cacheCompatibilityId,
                maxAge: 24 * 60 * 60 * 1_000,
              },
            );
            if (!authLifecycle.isCurrent(generation)) {
              return { cancelled: true, pwaOwner };
            }
            if (restored !== true) {
              throw new Error(
                'Account-owned query state could not be verified',
              );
            }
            writeWebPushMirror(
              nextFeatureFlags['feature:web_push'],
              emp,
            );
            const workerResult = await reconcilePushServiceWorker(
              webPushEnabled,
            );
            return { pwaOwner, workerResult };
          },
        );
        if (
          !authLifecycle.isCurrent(generation)
          || accountState?.cancelled
        ) {
          return;
        }
        if (accountState.workerResult.reloadRequired) {
          resetAfterServiceWorkerChange();
        }

        // A prior verified owner means RouteRestorer may already have restored
        // that owner's task. Standalone account changes land by role, while the
        // native route-confinement contract remains separate in App.jsx.
        const landingPath = getAccountLandingPath(emp.role);
        const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
        if (
          accountState.pwaOwner.changed
          && !accountState.pwaOwner.legacyState
          && isStandaloneDisplay()
          && currentPath !== landingPath
        ) {
          window.location.replace(landingPath);
          return;
        }

        if (!authLifecycle.commit(generation, () => {
          setPermissions(nextPermissions);
          setFeatureFlags(nextFeatureFlags);
          setEmployeePageAccess(nextPageAccess);
          setPwaOwnerLease(accountState.pwaOwner.lease);
          setHubNav(hubEnabled);
          setEmployee(emp);
          readyPrincipalRef.current = authUser.id;
          readyOwnerRef.current = accountState.pwaOwner.lease.owner;
        })) {
          return;
        }

        // Native enrollment remains fail-closed until a reviewed native build
        // explicitly enables the independently gated APNs channel.
        // Intentionally not awaited — login shouldn't block on APNs.
        if (canRegisterPush() && isNativePushEnrollmentEnabled()) {
          registerPushForEmployee(
            authenticatedDb,
            emp.id,
            { ownerKey: authenticatedOwnerKey },
          );
        }
      } else {
        const cleanupResult = await requireAccountCleanup(
          generation,
          {
            dbClient: authenticatedDb,
            principalId: authUser.id,
            ownerKey: authenticatedOwnerKey || readyOwnerRef.current,
          },
        );
        if (cleanupResult.cancelled) return;
        await finishRejectedPrincipal(generation, {
          cleanupResult,
          dbClient: authenticatedDb,
          principalId: authUser.id,
          ownerKey: authenticatedOwnerKey || readyOwnerRef.current,
          rejectionMessage: (
            'No active employee record is mapped to this account. Contact admin.'
          ),
        });
      }
    } catch (err) {
      if (!authLifecycle.isCurrent(generation)) return;
      console.error('Employee authorization bootstrap error:', err);
      const cleanupResult = await requireAccountCleanup(
        generation,
        {
          dbClient: authenticatedDb,
          principalId: authUser.id,
          ownerKey: authenticatedOwnerKey || readyOwnerRef.current,
        },
      );
      if (cleanupResult.cancelled) return;
      await finishRejectedPrincipal(generation, {
        cleanupResult,
        dbClient: authenticatedDb,
        principalId: authUser.id,
        ownerKey: authenticatedOwnerKey || readyOwnerRef.current,
        rejectionMessage: (
          'Failed to verify employee access. Please sign in and try again.'
        ),
      });
    }
  };

  // ── Login ──
  const login = useCallback(async (email, password, options = {}) => {
    const generation = authLifecycle.begin();
    authLifecycle.commit(generation, () => {
      setError(null);
      setLoading(true);
    });
    try {
      if (!await authLifecycle.waitForAccountState(generation)) return null;
      const priorPrincipal = cleanupBlockRef.current?.principalId
        || activePrincipalRef.current
        || readyPrincipalRef.current;
      if (cleanupBlockRef.current || priorPrincipal) {
        const priorDb = cleanupBlockRef.current?.db || stableDbRef.current;
        const priorOwnerKey = cleanupBlockRef.current?.ownerKey
          || readyOwnerRef.current;
        const cleanupResult = await requireAccountCleanup(
          generation,
          {
            dbClient: priorDb,
            principalId: priorPrincipal,
            ownerKey: priorOwnerKey,
          },
        );
        if (cleanupResult.cancelled) return null;
        if (!cleanupResult.ready) {
          throw new Error(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
        }

        // Cleanup may be complete while Supabase still holds A as its current
        // local session. End that session before clearing A's published identity
        // or attempting B, otherwise a failed B credential request could expose
        // Login while A remained authenticated underneath it.
        const transition = {
          cleanupPromise: Promise.resolve(cleanupResult),
          db: priorDb,
          generation,
          ownerKey: priorOwnerKey,
          signedOutObserved: false,
          finalized: false,
        };
        explicitLogoutRef.current = transition;
        let transitionSignOutError = null;
        try {
          const signOutResult = await realtimeClient.auth.signOut({
            scope: 'local',
          });
          transitionSignOutError = localSignOutError(signOutResult);
        } catch (signOutError) {
          transitionSignOutError = signOutError;
        }
        if (
          transitionSignOutError
          && !transition.signedOutObserved
        ) {
          if (explicitLogoutRef.current === transition) {
            explicitLogoutRef.current = null;
          }
          cleanupBlockRef.current = {
            db: priorDb,
            principalId: priorPrincipal,
            ownerKey: priorOwnerKey,
            recoveryRequired: false,
          };
          authLifecycle.commit(generation, () => {
            setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
            setLoading(true);
          });
          throw new Error(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
        }
        transition.finalized = true;
        if (explicitLogoutRef.current === transition) {
          explicitLogoutRef.current = null;
        }
        if (!clearPublishedPrincipal(generation)) return null;
      }
      if (typeof options.beforeSignIn === 'function') {
        await options.beforeSignIn();
        if (!authLifecycle.isCurrent(generation)) return null;
      }
      const { data, error: authError } = await realtimeClient.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) throw authError;
      return data;
    } catch (err) {
      authLifecycle.commit(generation, () => setError(err.message));
      throw err;
    } finally {
      authLifecycle.commit(
        generation,
        () => setLoading(cleanupBlockRef.current !== null),
      );
    }
  }, [authLifecycle, clearPublishedPrincipal, requireAccountCleanup]);

  // ── Logout ──
  const logout = useCallback(async () => {
    const priorPrincipal = cleanupBlockRef.current?.principalId
      || activePrincipalRef.current
      || readyPrincipalRef.current
      || user?.id
      || null;
    const priorDb = cleanupBlockRef.current?.db
      || authDb
      || stableDbRef.current;
    const priorOwnerKey = cleanupBlockRef.current?.ownerKey
      || readyOwnerRef.current;
    const generation = authLifecycle.begin();
    authLifecycle.commit(generation, () => {
      setLoading(true);
      setError(null);
    });
    const cleanupPromise = authLifecycle.enqueueAccountState(
      generation,
      // Explicit sign-out is the one flow with the bounded silent push-detach
      // retry window (~10s backoff) before any blocking UI.
      () => clearRejectedPrincipalState(priorDb, {
        ownerKey: priorOwnerKey,
        transientPushRetry: true,
      }),
      { requireCurrent: false },
    );
    const transition = {
      cleanupPromise,
      db: priorDb,
      generation,
      ownerKey: priorOwnerKey,
      signedOutObserved: false,
      finalized: false,
    };
    explicitLogoutRef.current = transition;
    const cleanupResult = await requireAccountCleanup(
      generation,
      {
        dbClient: priorDb,
        principalId: priorPrincipal,
        ownerKey: priorOwnerKey,
        cleanupPromise,
        allowDeferred: true,
      },
    );
    if (cleanupResult.cancelled) return;
    if (!cleanupResult.ready && cleanupResult.deferred !== true) {
      explicitLogoutRef.current = null;
      const cleanupError = new Error(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
      authLifecycle.commit(generation, () => {
        setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
        setLoading(true);
      });
      throw cleanupError;
    }
    if (cleanupResult.deferred === true) {
      // Deliberately silent for the user (owner precedent 2026-07-28: a banner
      // about a self-resolving internal window is noise). The journal finishes
      // at the next same-owner sign-in or blocks a foreign owner.
      console.warn(
        '[auth] Sign out completed with journaled push cleanup pending; '
        + 'it reconciles at the next same-owner sign-in.',
      );
    }

    let signOutError = null;
    try {
      const signOutResult = await realtimeClient.auth.signOut({
        scope: 'local',
      });
      signOutError = localSignOutError(signOutResult);
    } catch (error) {
      signOutError = error;
    }
    if (signOutError && !transition.signedOutObserved) {
      if (explicitLogoutRef.current === transition) {
        explicitLogoutRef.current = null;
      }
      cleanupBlockRef.current = {
        db: priorDb,
        principalId: priorPrincipal,
        ownerKey: priorOwnerKey,
        recoveryRequired: false,
      };
      authLifecycle.commit(generation, () => {
        setError('Sign out failed. Please try again.');
        setLoading(true);
      });
      throw signOutError;
    }

    transition.finalized = true;
    authLifecycle.commit(generation, () => {
      activePrincipalRef.current = null;
      readyPrincipalRef.current = null;
      readyOwnerRef.current = null;
      setUser(null);
      setEmployee(null);
      setPermissions([]);
      setFeatureFlags({});
      setEmployeePageAccess({});
      setPwaOwnerLease(null);
      setHubNav(false);
      tokenRef.current = null;
      setAuthDb(null);
      setSessionExpired(false);
      setError(null);
      setLoading(false);
    });
    if (explicitLogoutRef.current === transition) {
      explicitLogoutRef.current = null;
    }
    if (
      cleanupResult?.reloadRequired
      // A deferred sign-out skips the advisory reload so the settled journal
      // (not an interrupted context) is the only memory the next boot needs.
      && cleanupResult?.deferred !== true
      && authLifecycle.isCurrent(generation)
    ) {
      resetAfterServiceWorkerChange();
    }
  }, [
    authDb,
    authLifecycle,
    clearRejectedPrincipalState,
    requireAccountCleanup,
    user?.id,
  ]);

  const retryBlockedCleanup = useCallback(async () => {
    if (cleanupRetrying || !cleanupBlockRef.current) return;
    setCleanupRetrying(true);
    try {
      const blocked = cleanupBlockRef.current;
      if (blocked?.passwordRecovery) {
        const generation = authLifecycle.begin();
        authLifecycle.commit(generation, () => {
          setError(null);
          setLoading(true);
        });
        const cleanupResult = await requireAccountCleanup(
          generation,
          {
            dbClient: blocked.db,
            principalId: blocked.principalId,
            ownerKey: blocked.ownerKey,
          },
        );
        if (cleanupResult.cancelled) return;
        if (cleanupResult.ready !== true) {
          authLifecycle.commit(generation, () => {
            setError(ACCOUNT_CLEANUP_BLOCKED_MESSAGE);
            setLoading(true);
          });
          return;
        }
        finishPasswordRecoveryCleanup(generation);
        return;
      }
      if (
        blocked?.recoveryRequired
        || blocked?.signedOutReauthRequired
      ) {
        const generation = authLifecycle.begin();
        authLifecycle.commit(generation, () => {
          setError(PREVIOUS_ACCOUNT_RECOVERY_MESSAGE);
          setLoading(true);
        });
        const transition = {
          cleanupPromise: Promise.resolve({
            ready: true,
            reloadRequired: false,
          }),
          db: blocked.db,
          generation,
          ownerKey: blocked.ownerKey,
          signedOutObserved: false,
          finalized: false,
        };
        explicitLogoutRef.current = transition;
        let recoverySignOutError = null;
        try {
          const signOutResult = await realtimeClient.auth.signOut({
            scope: 'local',
          });
          recoverySignOutError = localSignOutError(signOutResult);
        } catch (signOutError) {
          recoverySignOutError = signOutError;
        }
        if (
          recoverySignOutError
          && !transition.signedOutObserved
        ) {
          if (explicitLogoutRef.current === transition) {
            explicitLogoutRef.current = null;
          }
          authLifecycle.commit(generation, () => {
            setError('Secure account recovery sign out failed. Please retry.');
            setLoading(true);
          });
          return;
        }
        transition.finalized = true;
        authLifecycle.commit(generation, () => {
          cleanupBlockRef.current = null;
          activePrincipalRef.current = null;
          readyPrincipalRef.current = null;
          readyOwnerRef.current = null;
          tokenRef.current = null;
          setUser(null);
          setEmployee(null);
          setPermissions([]);
          setFeatureFlags({});
          setEmployeePageAccess({});
          setPwaOwnerLease(null);
          setHubNav(false);
          setAuthDb(null);
          setSessionExpired(false);
          setError(PREVIOUS_ACCOUNT_RECOVERY_MESSAGE);
          setLoading(false);
        });
        if (explicitLogoutRef.current === transition) {
          explicitLogoutRef.current = null;
        }
        return;
      }
      await logout();
    } catch {
      // logout() keeps the authenticated client and publishes the bounded,
      // privacy-safe lock message. The user can retry this same action.
    } finally {
      setCleanupRetrying(false);
    }
  }, [
    authLifecycle,
    cleanupRetrying,
    finishPasswordRecoveryCleanup,
    logout,
    requireAccountCleanup,
  ]);

  // ── Permission check helper (4-layer priority) ──
  const canAccess = useCallback((navKey) => {
    if (!employee) return false;

    // Layer 1: Force-disabled kills the page for everyone, no exceptions
    const flag = featureFlags[`page:${navKey}`];
    if (flag?.force_disabled) return false;

    // Layer 2: Per-employee override — if a row exists, it wins over role
    if (Object.prototype.hasOwnProperty.call(employeePageAccess, navKey)) {
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
    // A crm_partner account exists solely to use the CRM — it always passes the
    // page:crm gate regardless of the dev_only_user_id rollout flag that keeps
    // CRM hidden from internal staff mid-build (that flag governs internal
    // rollout timing, not whether an already-provisioned partner can log in).
    if (key === 'page:crm' && employee?.role === 'crm_partner') return true;
    const flag = featureFlags[key];
    if (!flag) return true;                                          // No row = unrestricted
    if (flag.enabled) return true;                                   // Globally on
    if (employee && flag.dev_only_user_id === employee.id) return true; // Dev-only for this user
    // Explicit per-employee grant opens page:crm for one internal user (e.g. a
    // second admin during the CRM rollout) WITHOUT enabling it for all staff.
    // Grant-only (an override can add access here, never revoke); set from
    // Admin → Page Access (employee_page_access.can_view). Phase 6b generalizes
    // this into per-screen CRM roles.
    if (key === 'page:crm' && employee && employeePageAccess.crm === true) return true;
    return false;
  }, [featureFlags, employee, employeePageAccess]);

  const value = {
    user,
    employee,
    permissions,
    featureFlags,         // Raw flags map — { 'page:marketing': { enabled, ... } }
    employeePageAccess,   // { dashboard: true, conversations: false, ... } — empty = no overrides
    pwaOwnerLease,        // Opaque owner + login epoch; null until device state is verified
    loading,
    error,
    sessionExpired,       // true = the JWT was rejected and could not be renewed
    db: authDb || db, // Use authenticated client when available
    login,
    logout,
    retrySecureAccountCleanup: retryBlockedCleanup,
    canAccess,
    isFeatureEnabled,     // isFeatureEnabled('page:marketing') → boolean
    isAuthenticated: !!employee,
    isDev: import.meta.env.DEV,
  };
  const cleanupBlocked = cleanupBlockRef.current !== null;
  const signedOutReauthCleanup = cleanupBlockRef.current
    ?.signedOutReauthRequired === true;
  const previousAccountRecovery = (
    cleanupBlockRef.current?.recoveryRequired === true
    || signedOutReauthCleanup
  );
  const passwordRecoveryCleanup = cleanupBlockRef.current
    ?.passwordRecovery === true;

  return (
    <AuthContext.Provider value={value}>
      {cleanupBlocked ? (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div style={{
            width: 'min(100%, 420px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: 24,
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-lg)',
          }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>
              {passwordRecoveryCleanup
                ? 'Finish securing password recovery'
                : signedOutReauthCleanup
                ? 'Sign in to finish securing this device'
                : previousAccountRecovery
                ? 'Previous account required'
                : 'Finish securing this device'}
            </h1>
            <p style={{
              margin: 0,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              {passwordRecoveryCleanup
                ? (
                  'UPR is preserving your password-recovery session while it '
                  + 'finishes removing account-specific device access.'
                )
                : signedOutReauthCleanup
                ? (
                  'Your session ended before UPR could confirm notification '
                  + 'cleanup. Continue to sign-in, then use the same previous '
                  + 'account to finish securely.'
                )
                : previousAccountRecovery
                ? (
                  'This device kept the unfinished notification cleanup '
                  + 'separate from the current account. Sign out, then sign '
                  + 'in to the previous account to finish it.'
                )
                : (
                  'UPR has kept the previous account locked while it finishes '
                  + 'removing this device’s account-specific notification and '
                  + 'offline access.'
                )}
            </p>
            <button
              type="button"
              onClick={retryBlockedCleanup}
              disabled={cleanupRetrying}
              style={{
                minHeight: 48,
                padding: '12px 16px',
                border: 0,
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent)',
                color: '#fff',
                font: 'inherit',
                fontWeight: 700,
                cursor: cleanupRetrying ? 'wait' : 'pointer',
                opacity: cleanupRetrying ? 0.7 : 1,
              }}
            >
              {cleanupRetrying
                ? 'Securing this device…'
                : passwordRecoveryCleanup
                  ? 'Retry secure recovery'
                  : signedOutReauthCleanup
                  ? 'Continue to secure sign-in'
                  : previousAccountRecovery
                  ? 'Sign out for secure recovery'
                  : 'Retry secure sign out'}
            </button>
          </div>
        </div>
      ) : children}
      {/* Mounted HERE, not in Layout/TechLayout, so one instance covers every
          shell (office, tech, CRM) — a dead session is app-wide, not per-shell. */}
      <SessionExpiredBanner />
    </AuthContext.Provider>
  );
}

// AuthProvider and its companion hook intentionally share this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
