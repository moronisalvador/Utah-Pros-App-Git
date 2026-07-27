/**
 * ════════════════════════════════════════════════
 * FILE: nativeBiometricGate.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves native launch never reveals an enrolled stored session after a
 *   biometric, policy, cleanup, or local sign-out failure.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  nativeBiometricGate.js
 *   Data:      none (all platform/auth operations are fakes)
 * ════════════════════════════════════════════════
 */
import { describe, expect, it, vi } from 'vitest';
import { evaluateNativeBiometricLaunch } from './nativeBiometricGate.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function dependencies(overrides = {}) {
  return {
    native: true,
    getSession: vi.fn().mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    }),
    readPreference: vi.fn().mockReturnValue({
      enabled: true,
      readable: true,
    }),
    checkAvailable: vi.fn().mockResolvedValue(true),
    verify: vi.fn().mockResolvedValue(true),
    cleanup: vi.fn().mockResolvedValue({ reloadRequired: false }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    ...overrides,
  };
}

describe('evaluateNativeBiometricLaunch', () => {
  it('passes through web, signed-out, and non-enrolled launches', async () => {
    const web = dependencies({ native: false });
    await expect(evaluateNativeBiometricLaunch(web)).resolves.toMatchObject({
      state: 'open',
      reason: 'web',
    });
    expect(web.getSession).not.toHaveBeenCalled();

    await expect(evaluateNativeBiometricLaunch(dependencies({
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    }))).resolves.toMatchObject({
      state: 'open',
      reason: 'no_session',
    });

    await expect(evaluateNativeBiometricLaunch(dependencies({
      readPreference: vi.fn().mockReturnValue({
        enabled: false,
        readable: true,
      }),
    }))).resolves.toMatchObject({
      state: 'open',
      reason: 'not_enrolled',
    });
  });

  it('opens an enrolled session only after successful verification', async () => {
    const deps = dependencies();
    await expect(evaluateNativeBiometricLaunch(deps)).resolves.toEqual({
      state: 'open',
      reason: 'verified',
    });
    expect(deps.cleanup).not.toHaveBeenCalled();
    expect(deps.signOut).not.toHaveBeenCalled();
  });

  it('cancels a superseded launch before opening a biometric prompt', async () => {
    let current = true;
    const pendingSession = deferred();
    const deps = dependencies({
      getSession: () => pendingSession.promise,
      isCurrent: () => current,
    });
    const launch = evaluateNativeBiometricLaunch(deps);
    current = false;
    pendingSession.resolve({
      data: { session: { access_token: 'old-token' } },
    });

    await expect(launch).resolves.toMatchObject({
      state: 'locked',
      reason: 'cancelled',
    });
    expect(deps.checkAvailable).not.toHaveBeenCalled();
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable biometrics', {
      checkAvailable: vi.fn().mockResolvedValue(false),
    }, 'biometric_unavailable'],
    ['a rejected prompt', {
      verify: vi.fn().mockResolvedValue(false),
    }, 'verification_failed'],
    ['a thrown prompt error', {
      verify: vi.fn().mockRejectedValue(new Error('native bridge failed')),
    }, 'verification_failed'],
  ])('cleans and signs out for %s', async (_label, overrides, reason) => {
    const deps = dependencies(overrides);
    await expect(evaluateNativeBiometricLaunch(deps)).resolves.toMatchObject({
      state: 'open',
      reason: 'signed_out',
      signedOut: true,
      verificationReason: reason,
    });
    expect(deps.cleanup).toHaveBeenCalledOnce();
    expect(deps.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('fails closed when session or policy state cannot be read', async () => {
    await expect(evaluateNativeBiometricLaunch(dependencies({
      getSession: vi.fn().mockRejectedValue(new Error('storage failed')),
    }))).resolves.toMatchObject({
      state: 'locked',
      reason: 'session_check_failed',
    });

    await expect(evaluateNativeBiometricLaunch(dependencies({
      readPreference: vi.fn().mockReturnValue({
        enabled: false,
        readable: false,
      }),
    }))).resolves.toMatchObject({
      state: 'locked',
      reason: 'policy_unreadable',
    });
  });

  it('stays locked if local sign-out cannot remove the stored session', async () => {
    const deps = dependencies({
      verify: vi.fn().mockResolvedValue(false),
      cleanup: vi.fn().mockRejectedValue(new Error('cleanup failed')),
      signOut: vi.fn().mockResolvedValue({
        error: new Error('offline sign-out failed'),
      }),
    });

    await expect(evaluateNativeBiometricLaunch(deps)).resolves.toMatchObject({
      state: 'locked',
      reason: 'sign_out_failed',
      verificationReason: 'verification_failed',
    });
    expect(deps.cleanup).toHaveBeenCalledOnce();
    expect(deps.signOut).toHaveBeenCalledOnce();
  });

  it('defers a requested reset until cleanup and sign-out succeed', async () => {
    const deps = dependencies({
      verify: vi.fn().mockResolvedValue(false),
      cleanup: vi.fn().mockResolvedValue({ reloadRequired: true }),
    });

    await expect(evaluateNativeBiometricLaunch(deps)).resolves.toMatchObject({
      state: 'open',
      signedOut: true,
      reloadRequired: true,
    });
    expect(deps.signOut).toHaveBeenCalledOnce();
  });
});
