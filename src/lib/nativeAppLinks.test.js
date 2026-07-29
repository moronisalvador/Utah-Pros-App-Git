/**
 * ════════════════════════════════════════════════
 * FILE: nativeAppLinks.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves iPhone links can open only supported UPR screens. It covers links
 *   that launch the app, links received while it is open, and cleanup while
 *   native listener setup is still finishing.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  nativeAppLinks
 *   Data:      none (native plugin fakes only)
 * ════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  app: {
    addListener: vi.fn(),
    getLaunchUrl: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: native.isNativePlatform },
}));

vi.mock('@capacitor/app', () => ({
  App: native.app,
}));

import {
  NATIVE_APP_HTTPS_HOSTS,
  NATIVE_APP_SCHEME,
  NATIVE_APP_SCHEME_HOST,
  resolveNativeNavigationTarget,
  startNativeAppLinkListeners,
} from './nativeAppLinks.js';
import { resolveNativePushRoute } from './nativeNavigationTarget.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function makeApp({ launchUrl } = {}) {
  let warmCallback = null;
  const remove = vi.fn(async () => {});
  return {
    addListener: vi.fn(async (event, callback) => {
      expect(event).toBe('appUrlOpen');
      warmCallback = callback;
      return { remove };
    }),
    emitWarm(url) {
      warmCallback?.({ url });
    },
    getLaunchUrl: vi.fn(async () => (
      launchUrl === undefined ? undefined : { url: launchUrl }
    )),
    remove,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('resolveNativeNavigationTarget', () => {
  it('accepts exact production, staging, internal, and custom-scheme targets', () => {
    expect(NATIVE_APP_HTTPS_HOSTS).toEqual([
      'utahpros.app',
      'dev.utahpros.app',
    ]);
    expect(NATIVE_APP_SCHEME).toBe('com.utahprosrestoration.upr');
    expect(NATIVE_APP_SCHEME_HOST).toBe('app');

    expect(resolveNativeNavigationTarget(
      'https://utahpros.app/tech/conversations?c=conversation_1',
    )).toBe('/tech/conversations?c=conversation_1');
    expect(resolveNativeNavigationTarget(
      'https://dev.utahpros.app/tech/jobs/job-1/documents',
    )).toBe('/tech/jobs/job-1/documents');
    expect(resolveNativeNavigationTarget(
      'com.utahprosrestoration.upr://app/tech/appointment/appt-1',
    )).toBe('/tech/appointment/appt-1');
    expect(resolveNativeNavigationTarget('/tech/tasks')).toBe('/tech/tasks');
  });

  it('accepts only the native legal, login, password, and public-signing routes', () => {
    for (const target of [
      '/login',
      '/privacy',
      '/terms',
      '/support',
      '/sign/sign-token_1',
      '/s/short-code_1',
    ]) {
      expect(resolveNativeNavigationTarget(target)).toBe(target);
    }

    expect(resolveNativeNavigationTarget('/settings')).toBe(null);
    expect(resolveNativeNavigationTarget('/crm/leads')).toBe(null);
    expect(resolveNativeNavigationTarget('/')).toBe(null);
  });

  it('preserves a validated password recovery fragment without logging it', () => {
    const target = [
      'https://utahpros.app/set-password',
      '#access_token=header.payload.signature',
      '&expires_at=1790000000',
      '&expires_in=3600',
      '&refresh_token=synthetic-refresh-token',
      '&token_type=bearer',
      '&type=recovery',
    ].join('');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(resolveNativeNavigationTarget(target)).toBe(
      target.replace('https://utahpros.app', ''),
    );
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    expect(resolveNativeNavigationTarget(
      '/set-password#type=recovery&token_type=bearer&access_token=a',
    )).toBe(null);
    expect(resolveNativeNavigationTarget(
      '/set-password#type=recovery&token_type=bearer&access_token=a&refresh_token=b&next=/tech',
    )).toBe(null);
  });

  it('rejects external, downgraded, credentialed, and unknown scheme or host targets', () => {
    for (const target of [
      'https://example.com/tech',
      'https://www.utahpros.app/tech',
      'http://utahpros.app/tech',
      'https://user:pass@utahpros.app/tech',
      'https://utahpros.app:444/tech',
      'javascript:alert(1)',
      'upr://app/tech',
      'com.utahprosrestoration.upr://other/tech',
      '//example.com/tech',
    ]) {
      expect(resolveNativeNavigationTarget(target)).toBe(null);
    }
  });

  it('rejects admin, double-slash, dot-segment, encoded-separator, and fragment attacks', () => {
    for (const target of [
      '/tech/admin',
      '/tech/admin/users',
      '/tech//jobs/job-1',
      '/tech/../settings',
      '/tech/%2e%2e/settings',
      '/tech/jobs%2Fjob-1',
      '/tech/jobs%252Fjob-1',
      '/tech/jobs\\job-1',
      '/tech/tasks#javascript:alert(1)',
      '/sign/token/extra',
    ]) {
      expect(resolveNativeNavigationTarget(target)).toBe(null);
    }
  });

  it('allows only route-specific bounded query parameters', () => {
    const accepted = [
      '/tech/conversations?c=conversation-1',
      '/tech/job/job-1?appt=appointment-1',
      '/tech/appointment/appointment-1/edit?section=tasks',
      '/tech/new-event?date=2026-07-26',
      '/tech/new-appointment?date=2026-07-26&jobId=job-1',
    ];
    const rejected = [
      '/tech/conversations?c=one&c=two',
      '/tech/conversations?new=1',
      '/tech/job/job-1?appt=../../admin',
      '/tech/appointment/appointment-1/edit?section=billing',
      '/tech/new-event?date=tomorrow',
      '/tech/tasks?next=/tech/admin',
      '/sign/token?redirect=/tech',
    ];

    for (const target of accepted) {
      expect(resolveNativeNavigationTarget(target)).toBe(target);
    }
    for (const target of rejected) {
      expect(resolveNativeNavigationTarget(target)).toBe(null);
    }
  });
});

describe('resolveNativePushRoute', () => {
  it('keeps credential-free app routes and drops every signing bearer route', () => {
    expect(resolveNativePushRoute('/tech/appointment/appt-1'))
      .toBe('/tech/appointment/appt-1');
    expect(resolveNativePushRoute('/sign/private-signing-token')).toBe('/');
    expect(resolveNativePushRoute('/s/private-signing-code')).toBe('/');
  });
});

describe('startNativeAppLinkListeners', () => {
  it('delivers an accepted cold launch and later warm URL through the same policy', async () => {
    const app = makeApp({
      launchUrl: 'https://utahpros.app/tech/jobs/job-1',
    });
    const onTarget = vi.fn();
    const lifecycle = startNativeAppLinkListeners({ app, onTarget });

    await expect(lifecycle.ready).resolves.toEqual({
      ok: true,
      coldTargetAccepted: true,
      launchUrlReadable: true,
    });
    expect(onTarget).toHaveBeenNthCalledWith(
      1,
      '/tech/jobs/job-1',
      { source: 'launch' },
    );

    app.emitWarm(
      'com.utahprosrestoration.upr://app/tech/conversations?c=conversation-1',
    );
    expect(onTarget).toHaveBeenNthCalledWith(
      2,
      '/tech/conversations?c=conversation-1',
      { source: 'url_open' },
    );
  });

  it('ignores unsafe cold and warm URLs without exposing their values', async () => {
    const app = makeApp({
      launchUrl: 'https://example.com/tech?token=secret-value',
    });
    const onTarget = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lifecycle = startNativeAppLinkListeners({ app, onTarget });

    await expect(lifecycle.ready).resolves.toMatchObject({
      ok: true,
      coldTargetAccepted: false,
    });
    app.emitWarm('/tech/admin?token=second-secret');

    expect(onTarget).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops delivery immediately and removes a fully installed listener', async () => {
    const app = makeApp();
    const onTarget = vi.fn();
    const lifecycle = startNativeAppLinkListeners({ app, onTarget });

    await lifecycle.ready;
    await expect(lifecycle.stop()).resolves.toBe(true);
    app.emitWarm('/tech/tasks');

    expect(app.remove).toHaveBeenCalledOnce();
    expect(onTarget).not.toHaveBeenCalled();
    await expect(lifecycle.stop()).resolves.toBe(true);
    expect(app.remove).toHaveBeenCalledOnce();
  });

  it('does not let a slow cold lookup overwrite a newer warm URL', async () => {
    const launch = deferred();
    let warmCallback = null;
    const app = {
      addListener: vi.fn(async (_event, callback) => {
        warmCallback = callback;
        return { remove: vi.fn(async () => {}) };
      }),
      getLaunchUrl: vi.fn(() => launch.promise),
    };
    const onTarget = vi.fn();
    const lifecycle = startNativeAppLinkListeners({ app, onTarget });
    await vi.waitFor(() => expect(app.getLaunchUrl).toHaveBeenCalledOnce());

    warmCallback({
      url: 'com.utahprosrestoration.upr://app/tech/tasks',
    });
    launch.resolve({
      url: 'https://utahpros.app/tech/jobs/stale-launch-job',
    });

    await expect(lifecycle.ready).resolves.toEqual({
      ok: true,
      coldTargetAccepted: false,
      launchUrlReadable: true,
    });
    expect(onTarget).toHaveBeenCalledOnce();
    expect(onTarget).toHaveBeenCalledWith(
      '/tech/tasks',
      { source: 'url_open' },
    );
  });

  it('does not let a rejected warm URL suppress the valid cold launch', async () => {
    const launch = deferred();
    let warmCallback = null;
    const app = {
      addListener: vi.fn(async (_event, callback) => {
        warmCallback = callback;
        return { remove: vi.fn(async () => {}) };
      }),
      getLaunchUrl: vi.fn(() => launch.promise),
    };
    const onTarget = vi.fn();
    const lifecycle = startNativeAppLinkListeners({ app, onTarget });
    await vi.waitFor(() => expect(app.getLaunchUrl).toHaveBeenCalledOnce());

    warmCallback({ url: 'https://example.com/tech' });
    launch.resolve({ url: 'https://utahpros.app/tech/jobs/job-1' });

    await expect(lifecycle.ready).resolves.toMatchObject({
      ok: true,
      coldTargetAccepted: true,
    });
    expect(onTarget).toHaveBeenCalledOnce();
    expect(onTarget).toHaveBeenCalledWith(
      '/tech/jobs/job-1',
      { source: 'launch' },
    );
  });

  it('removes a listener that resolves after cleanup and never reads the launch URL', async () => {
    const listener = deferred();
    const remove = vi.fn(async () => {});
    const app = {
      addListener: vi.fn(() => listener.promise),
      getLaunchUrl: vi.fn(async () => ({ url: '/tech/tasks' })),
    };
    const onTarget = vi.fn();
    const lifecycle = startNativeAppLinkListeners({ app, onTarget });
    const stopped = lifecycle.stop();

    listener.resolve({ remove });

    await expect(stopped).resolves.toBe(true);
    await expect(lifecycle.ready).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(app.getLaunchUrl).not.toHaveBeenCalled();
    expect(onTarget).not.toHaveBeenCalled();
  });

  it('contains a synchronous listener setup failure', async () => {
    const app = {
      addListener: vi.fn(() => {
        throw new Error('native plugin missing');
      }),
      getLaunchUrl: vi.fn(),
    };

    const lifecycle = startNativeAppLinkListeners({
      app,
      onTarget: vi.fn(),
    });

    await expect(lifecycle.ready).resolves.toEqual({
      ok: false,
      reason: 'listener_unavailable',
    });
    await expect(lifecycle.stop()).resolves.toBe(false);
    expect(app.getLaunchUrl).not.toHaveBeenCalled();
  });

  it('does not touch the native plugin on web', async () => {
    const app = makeApp({ launchUrl: '/tech/tasks' });
    const onTarget = vi.fn();
    const lifecycle = startNativeAppLinkListeners({
      app,
      isNative: () => false,
      onTarget,
    });

    await expect(lifecycle.ready).resolves.toEqual({
      ok: false,
      reason: 'not_native',
    });
    await expect(lifecycle.stop()).resolves.toBe(true);
    expect(app.addListener).not.toHaveBeenCalled();
    expect(app.getLaunchUrl).not.toHaveBeenCalled();
    expect(onTarget).not.toHaveBeenCalled();
  });
});
