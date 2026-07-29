/**
 * ════════════════════════════════════════════════
 * FILE: nativeAppLinks.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides whether a link is allowed to open a screen inside the iPhone app.
 *   It listens for both a link that launched the app and a link received while
 *   the app is already open, then forwards only the approved in-app path.
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/app, @capacitor/core
 *   Internal:  ./nativeNavigationTarget.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Invalid links are ignored rather than redirected to a fallback screen.
 *   - Password-recovery links may contain credentials in their URL fragment.
 *     This module validates and forwards them but never logs or stores them.
 *   - The caller owns auth/profile readiness and must retain an accepted path
 *     until the route is safe to render.
 * ════════════════════════════════════════════════
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { resolveNativeNavigationTarget } from './nativeNavigationTarget.js';

export {
  NATIVE_APP_HTTPS_HOSTS,
  NATIVE_APP_SCHEME,
  NATIVE_APP_SCHEME_HOST,
  resolveNativeNavigationTarget,
} from './nativeNavigationTarget.js';

function notifyWithoutThrow(callback, target, source) {
  try {
    Promise.resolve(callback(target, { source })).catch(() => {});
  } catch {
    // Native callback failures must not break future URL delivery.
  }
}

/**
 * Begin listening for both terminated/cold and already-running/warm app URLs.
 * Calling stop blocks delivery immediately, even while native setup is pending.
 */
export function startNativeAppLinkListeners({
  onTarget,
  app = App,
  isNative = () => Capacitor.isNativePlatform(),
} = {}) {
  let active = true;
  let listenerHandle = null;
  let listenerRemoved = false;
  let stopPromise = null;
  let supported = false;
  let warmTargetAccepted = false;

  try {
    supported = isNative() === true && typeof onTarget === 'function';
  } catch {
    supported = false;
  }

  const deliver = (value, source) => {
    if (!active) return false;
    const target = resolveNativeNavigationTarget(value);
    if (!target) return false;
    notifyWithoutThrow(onTarget, target, source);
    return true;
  };

  const listenerPromise = supported
    ? Promise.resolve().then(() => app.addListener(
      'appUrlOpen',
      ({ url }) => {
        if (deliver(url, 'url_open')) warmTargetAccepted = true;
      },
    )).then((handle) => {
      listenerHandle = handle || null;
      return listenerHandle;
    })
    : Promise.resolve(null);

  const removeListener = async () => {
    if (listenerRemoved) return true;
    listenerRemoved = true;
    try {
      await listenerHandle?.remove?.();
      return true;
    } catch {
      return false;
    }
  };

  const ready = (async () => {
    if (!supported) return { ok: false, reason: 'not_native' };

    try {
      await listenerPromise;
    } catch {
      return { ok: false, reason: 'listener_unavailable' };
    }

    if (!active) {
      await removeListener();
      return { ok: false, reason: 'cancelled' };
    }

    let launch;
    try {
      launch = await app.getLaunchUrl();
    } catch {
      if (!active) {
        return { ok: false, reason: 'cancelled' };
      }
      return {
        ok: true,
        coldTargetAccepted: false,
        launchUrlReadable: false,
      };
    }

    if (!active) {
      return { ok: false, reason: 'cancelled' };
    }

    return {
      ok: true,
      // A warm URL received while the cold lookup was pending is the newer
      // user intent and must not be overwritten by the original launch URL.
      coldTargetAccepted: warmTargetAccepted
        ? false
        : deliver(launch?.url, 'launch'),
      launchUrlReadable: true,
    };
  })();

  return {
    ready,
    stop() {
      active = false;
      if (!stopPromise) {
        stopPromise = listenerPromise
          .then(() => removeListener())
          .catch(() => false);
      }
      return stopPromise;
    },
  };
}
