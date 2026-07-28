/**
 * ════════════════════════════════════════════════
 * FILE: authBootstrap.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Defines the fail-closed rules used while a Supabase Auth session is mapped
 *   to the UPR employee directory. It also owns the generation/queue primitive
 *   that prevents an older async auth transition from publishing over a newer
 *   account, plus the shared role-aware PWA landing decision.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  AuthContext.jsx
 *   Data:      reads → none; writes → none
 *
 * NOTES / GOTCHAS:
 *   - get_my_employee_profile resolves the Auth user ID inside SQL. Email is not
 *     used as the employee binding.
 *   - crm_partner is the existing supported external product identity and does
 *     not use active-internal personal page overrides.
 *   - Account-state work is serialized because a late logout cleanup must finish
 *     before a newer principal records or publishes its local owner state.
 * ════════════════════════════════════════════════
 */

export function getAccountLandingPath(role) {
  if (role === 'field_tech') return '/tech';
  if (role === 'crm_partner') return '/crm/leads';
  return '/';
}

/**
 * AUTH-01 — who may render the field shell (`/tech/*`).
 *
 * Owner-ratified 2026-07-27: every INTERNAL role, because office, estimator,
 * supervisor and project_manager all legitimately use field screens today, and
 * excluding admin would lock the owner out of the app they support. The single
 * exclusion is `crm_partner`, the external product identity, which had full
 * access to job data, claims, customer records and photos.
 *
 * `manager` was in this list briefly and has been removed (NAV-01). It is not a
 * real role: absent from AuthContext's SUPPORTED_EMPLOYEE_ROLES and from
 * navKeys ROLES, so no employee can ever hold it. Listing it implied an
 * identity that does not exist. Note the two canonical lists still disagree
 * about `estimator` — AuthContext accepts it, navKeys ROLES omits it — which is
 * why this list follows AuthContext, the one that actually admits a session.
 *
 * This lives beside getAccountLandingPath deliberately: the landing redirect
 * and the route gate must not drift, and the refusal screen sends a blocked
 * account to getAccountLandingPath(role) rather than looping.
 *
 * NOTE: this is a PRESENTATION boundary. It stops a wrong-shell render; it does
 * not authorize data. The server-side boundary is the RPC grant surface (see
 * audit finding DATA-01 — get_claims_list is granted to plain `authenticated`),
 * which is a separate reviewed database change.
 */
export const FIELD_SHELL_ROLES = Object.freeze([
  'field_tech',
  'admin',
  'office',
  'supervisor',
  'estimator',
  'project_manager',
]);

export function canUseFieldShell(role) {
  return FIELD_SHELL_ROLES.includes(role);
}

/**
 * AuthProvider's latest-transition-wins primitive.
 *
 * React state publication is guarded by a monotonically increasing generation.
 * Account-owned cleanup/reconciliation is additionally serialized so an older
 * cleanup cannot finish after a newer account has recorded its owner state.
 */
export function createAuthProviderLifecycle() {
  let generation = 0;
  let accountStateQueue = Promise.resolve();

  const isCurrent = (candidate) => candidate === generation;

  return {
    begin() {
      generation += 1;
      return generation;
    },

    current() {
      return generation;
    },

    isCurrent,

    commit(candidate, publish) {
      if (!isCurrent(candidate)) return false;
      publish();
      return true;
    },

    enqueueAccountState(candidate, task, {
      requireCurrent = true,
    } = {}) {
      const result = accountStateQueue
        .catch(() => undefined)
        .then(() => {
          if (requireCurrent && !isCurrent(candidate)) {
            return { cancelled: true };
          }
          return task();
        });
      accountStateQueue = result.catch(() => undefined);
      return result;
    },

    async waitForAccountState(candidate) {
      await accountStateQueue.catch(() => undefined);
      return isCurrent(candidate);
    },
  };
}

export function classifyEmployeeBootstrap(
  employee,
  { allowExternalDevAccount = false } = {},
) {
  if (!employee?.is_active) {
    return {
      allowed: false,
      loadPersonalPageAccess: false,
      reason: 'inactive employee identity',
    };
  }

  if (employee.role === 'crm_partner') {
    return {
      allowed: true,
      loadPersonalPageAccess: false,
      reason: null,
    };
  }

  if (employee.is_external) {
    if (allowExternalDevAccount && employee.role === 'admin') {
      return {
        allowed: true,
        loadPersonalPageAccess: false,
        reason: null,
      };
    }

    return {
      allowed: false,
      loadPersonalPageAccess: false,
      reason: 'unsupported external employee identity',
    };
  }

  return {
    allowed: true,
    loadPersonalPageAccess: true,
    reason: null,
  };
}
