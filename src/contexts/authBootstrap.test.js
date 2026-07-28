import { describe, expect, it } from 'vitest';
import {
  FIELD_SHELL_ROLES,
  canUseFieldShell,
  classifyEmployeeBootstrap,
  createAuthProviderLifecycle,
  getAccountLandingPath,
} from './authBootstrap.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('classifyEmployeeBootstrap', () => {
  it('loads personal page access only for an active internal employee', () => {
    expect(classifyEmployeeBootstrap({
      is_active: true,
      is_external: false,
      role: 'admin',
    })).toEqual({
      allowed: true,
      loadPersonalPageAccess: true,
      reason: null,
    });
  });

  it('keeps the existing active CRM-partner carve-out without personal overrides', () => {
    expect(classifyEmployeeBootstrap({
      is_active: true,
      is_external: true,
      role: 'crm_partner',
    })).toEqual({
      allowed: true,
      loadPersonalPageAccess: false,
      reason: null,
    });
  });

  it('allows only an explicitly matched external admin in the local dev build', () => {
    const externalAdmin = {
      is_active: true,
      is_external: true,
      role: 'admin',
    };

    expect(classifyEmployeeBootstrap(externalAdmin)).toEqual({
      allowed: false,
      loadPersonalPageAccess: false,
      reason: 'unsupported external employee identity',
    });
    expect(classifyEmployeeBootstrap(externalAdmin, {
      allowExternalDevAccount: true,
    })).toEqual({
      allowed: true,
      loadPersonalPageAccess: false,
      reason: null,
    });
  });

  it.each([
    [
      'inactive',
      { is_active: false, is_external: false, role: 'admin' },
      'inactive employee identity',
    ],
    [
      'unsupported external',
      { is_active: true, is_external: true, role: 'admin' },
      'unsupported external employee identity',
    ],
  ])('denies an %s employee mapping', (_label, employee, reason) => {
    expect(classifyEmployeeBootstrap(employee)).toEqual({
      allowed: false,
      loadPersonalPageAccess: false,
      reason,
    });
  });
});

describe('getAccountLandingPath', () => {
  it.each([
    ['field_tech', '/tech'],
    ['crm_partner', '/crm/leads'],
    ['admin', '/'],
    ['project_manager', '/'],
    [undefined, '/'],
  ])('maps %s to its shared account landing', (role, expected) => {
    expect(getAccountLandingPath(role)).toBe(expected);
  });
});

// AUTH-01. Before the field-shell gate, being signed in was sufficient to
// render every /tech/* route: the landing redirect only fires on '/', so a
// direct URL, a Universal Link or a notification tap bypassed it entirely.
describe('canUseFieldShell', () => {
  it.each(['field_tech', 'admin', 'office', 'supervisor', 'estimator', 'project_manager', 'manager'])(
    'admits the internal role %s',
    (role) => { expect(canUseFieldShell(role)).toBe(true); },
  );

  it('refuses crm_partner, the external product identity', () => {
    // Owner-ratified 2026-07-27. This identity previously reached job data,
    // claims, customer records and photos through the field shell.
    expect(canUseFieldShell('crm_partner')).toBe(false);
  });

  it('fails closed on an absent, unknown or malformed role', () => {
    for (const role of [undefined, null, '', 'not_a_role', 0, {}]) {
      expect(canUseFieldShell(role)).toBe(false);
    }
  });

  it('always sends a refused account somewhere real, never back into /tech', () => {
    // The refusal screen links to getAccountLandingPath(role). If that ever
    // resolved to a /tech path for a refused role, the native catch-all
    // ('*' -> /tech) would trap the user in a loop with no way out.
    const refused = ['crm_partner', undefined, 'not_a_role'];
    for (const role of refused) {
      expect(canUseFieldShell(role)).toBe(false);
      expect(getAccountLandingPath(role).startsWith('/tech')).toBe(false);
    }
  });

  it('keeps the gate and the landing rule from drifting apart', () => {
    // Both live in this module on purpose: any role sent to /tech on login must
    // also be admitted by the gate, or login would bounce into the refusal screen.
    for (const role of FIELD_SHELL_ROLES) {
      if (getAccountLandingPath(role) === '/tech') {
        expect(canUseFieldShell(role)).toBe(true);
      }
    }
    expect(canUseFieldShell('field_tech')).toBe(true);
    expect(getAccountLandingPath('field_tech')).toBe('/tech');
  });
});

describe('AuthProvider account lifecycle', () => {
  it('refuses to publish a bootstrap after a newer generation wins', async () => {
    const lifecycle = createAuthProviderLifecycle();
    const firstRead = deferred();
    let publishedAccount = null;
    const first = lifecycle.begin();
    const staleBootstrap = (async () => {
      await firstRead.promise;
      lifecycle.commit(first, () => {
        publishedAccount = 'employee-a';
      });
    })();

    const second = lifecycle.begin();
    expect(lifecycle.commit(second, () => {
      publishedAccount = 'employee-b';
    })).toBe(true);

    firstRead.resolve();
    await staleBootstrap;

    expect(publishedAccount).toBe('employee-b');
  });

  it('finishes an older destructive cleanup before publishing a newer account', async () => {
    const lifecycle = createAuthProviderLifecycle();
    const cleanupRelease = deferred();
    const events = [];
    const signedOut = lifecycle.begin();
    const cleanup = lifecycle.enqueueAccountState(
      signedOut,
      async () => {
        events.push('cleanup-start');
        await cleanupRelease.promise;
        events.push('cleanup-finish');
      },
      { requireCurrent: false },
    );

    const signedIn = lifecycle.begin();
    const publish = (async () => {
      expect(await lifecycle.waitForAccountState(signedIn)).toBe(true);
      lifecycle.commit(signedIn, () => events.push('publish-new-account'));
    })();

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['cleanup-start']);
    cleanupRelease.resolve();
    await Promise.all([cleanup, publish]);

    expect(events).toEqual([
      'cleanup-start',
      'cleanup-finish',
      'publish-new-account',
    ]);
  });

  it('skips current-only account work that was superseded while queued', async () => {
    const lifecycle = createAuthProviderLifecycle();
    const blockerRelease = deferred();
    const blockerGeneration = lifecycle.begin();
    const blocker = lifecycle.enqueueAccountState(
      blockerGeneration,
      () => blockerRelease.promise,
      { requireCurrent: false },
    );
    const staleGeneration = lifecycle.begin();
    const staleTask = lifecycle.enqueueAccountState(
      staleGeneration,
      () => {
        throw new Error('stale account work ran');
      },
    );

    lifecycle.begin();
    blockerRelease.resolve();

    await blocker;
    await expect(staleTask).resolves.toEqual({ cancelled: true });
  });
});
