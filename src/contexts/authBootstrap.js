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
