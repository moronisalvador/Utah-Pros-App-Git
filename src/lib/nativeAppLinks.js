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
 *   Internal:  none
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
import { NATIVE_APP_HTTPS_HOSTS } from './nativeHosts.js';

export const NATIVE_APP_SCHEME = 'com.utahprosrestoration.upr';
export const NATIVE_APP_SCHEME_HOST = 'app';
// Moved to nativeHosts.js (no imports) so the native BUILD SCRIPT can validate
// its API origin against the same list — this file imports @capacitor/app, so a
// plain Node script cannot load it. Imported AND re-exported: `export { x } from`
// alone would not create the local binding this module uses below.
export { NATIVE_APP_HTTPS_HOSTS };

const MAX_TARGET_LENGTH = 8_192;
const ID_VALUE = /^[A-Za-z0-9_-]{1,128}$/;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_SIGNING_PATH = /^\/(?:sign|s)\/[A-Za-z0-9_-]{1,256}$/;
const FIELD_PATHS = [
  /^\/tech\/claims\/[A-Za-z0-9_-]{1,128}$/,
  /^\/tech\/claims\/[A-Za-z0-9_-]{1,128}\/photos$/,
  /^\/tech\/claims\/[A-Za-z0-9_-]{1,128}\/rooms\/[A-Za-z0-9_-]{1,128}$/,
  /^\/tech\/jobs\/[A-Za-z0-9_-]{1,128}$/,
  /^\/tech\/job\/[A-Za-z0-9_-]{1,128}$/,
  /^\/tech\/jobs\/[A-Za-z0-9_-]{1,128}\/photos$/,
  /^\/tech\/jobs\/[A-Za-z0-9_-]{1,128}\/documents$/,
  /^\/tech\/appointment\/[A-Za-z0-9_-]{1,128}$/,
  /^\/tech\/appointment\/[A-Za-z0-9_-]{1,128}\/edit$/,
];
const STATIC_PATHS = new Set([
  '/tech',
  '/tech/schedule',
  '/tech/tasks',
  '/tech/claims',
  '/tech/new-customer',
  '/tech/new-job',
  '/tech/new-appointment',
  '/tech/new-event',
  '/tech/conversations',
  '/tech/feedback',
  '/tech/more',
  '/tech/settings',
  '/tech/help',
  '/tech/tools/oop-pricing',
  '/tech/tools/demo-sheet',
  '/login',
  '/set-password',
  '/privacy',
  '/terms',
  '/support',
]);
const RECOVERY_HASH_KEYS = new Set([
  'access_token',
  'expires_at',
  'expires_in',
  'refresh_token',
  'token_type',
  'type',
]);

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function getRawPath(value) {
  if (value.startsWith('/')) {
    return value.split(/[?#]/, 1)[0];
  }

  const schemeEnd = value.indexOf('://');
  if (schemeEnd < 0) return null;
  const authorityStart = schemeEnd + 3;
  const firstDelimiter = value.slice(authorityStart).search(/[/?#]/);
  if (firstDelimiter < 0) return '/';
  const delimiterIndex = authorityStart + firstDelimiter;
  if (value[delimiterIndex] !== '/') return '/';
  return value.slice(delimiterIndex).split(/[?#]/, 1)[0];
}

function hasSafeRawPath(value) {
  const path = getRawPath(value);
  if (!path || path.includes('\\') || path.includes('%') || path.includes('//')) {
    return false;
  }
  return !path.split('/').some((segment) => segment === '.' || segment === '..');
}

function hasAllowedOrigin(url, relative) {
  if (relative) return true;
  if (url.username || url.password || url.port) return false;

  if (url.protocol === 'https:') {
    return NATIVE_APP_HTTPS_HOSTS.includes(url.hostname);
  }
  return (
    url.protocol === `${NATIVE_APP_SCHEME}:`
    && url.hostname === NATIVE_APP_SCHEME_HOST
  );
}

function hasAllowedQuery(url) {
  if (!url.search) return true;

  const values = new Map();
  for (const [name, value] of url.searchParams.entries()) {
    if (values.has(name)) return false;
    values.set(name, value);
  }

  if (url.pathname === '/tech/conversations') {
    return values.size === 1 && ID_VALUE.test(values.get('c') || '');
  }
  if (/^\/tech\/job\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) {
    return values.size === 1 && ID_VALUE.test(values.get('appt') || '');
  }
  if (/^\/tech\/appointment\/[A-Za-z0-9_-]{1,128}\/edit$/.test(url.pathname)) {
    return values.size === 1 && values.get('section') === 'tasks';
  }
  if (url.pathname === '/tech/new-event') {
    return values.size === 1 && DATE_VALUE.test(values.get('date') || '');
  }
  if (url.pathname === '/tech/new-appointment') {
    if (values.size < 1 || values.size > 2) return false;
    for (const [name, value] of values) {
      if (name === 'date' && DATE_VALUE.test(value)) continue;
      if (name === 'jobId' && ID_VALUE.test(value)) continue;
      return false;
    }
    return true;
  }
  return false;
}

function hasSafeRecoveryHash(url) {
  if (!url.hash) return true;
  if (url.pathname !== '/set-password' || url.search) return false;

  const params = new URLSearchParams(url.hash.slice(1));
  const seen = new Set();
  for (const [name, value] of params.entries()) {
    if (
      !RECOVERY_HASH_KEYS.has(name)
      || seen.has(name)
      || !value
      || value.length > 4_096
      || hasControlCharacters(value)
    ) {
      return false;
    }
    seen.add(name);
  }

  return (
    params.get('type') === 'recovery'
    && params.get('token_type') === 'bearer'
    && !!params.get('access_token')
    && !!params.get('refresh_token')
  );
}

function isAllowedPath(url) {
  if (
    url.pathname === '/tech/admin'
    || url.pathname.startsWith('/tech/admin/')
  ) {
    return false;
  }
  return (
    STATIC_PATHS.has(url.pathname)
    || FIELD_PATHS.some((pattern) => pattern.test(url.pathname))
    || PUBLIC_SIGNING_PATH.test(url.pathname)
  );
}

/**
 * Turn an absolute Universal Link, the app's custom URL, or an internal Push
 * target into one native-supported route. Unsafe input returns null.
 */
export function resolveNativeNavigationTarget(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_TARGET_LENGTH
    || value !== value.trim()
    || hasControlCharacters(value)
    || value.includes('\\')
    || !hasSafeRawPath(value)
  ) {
    return null;
  }

  const relative = value.startsWith('/') && !value.startsWith('//');
  let url;
  try {
    url = new URL(value, 'https://utahpros.app');
  } catch {
    return null;
  }

  if (
    !hasAllowedOrigin(url, relative)
    || url.pathname.includes('%')
    || url.pathname.includes('//')
    || !isAllowedPath(url)
    || !hasAllowedQuery(url)
    || !hasSafeRecoveryHash(url)
    || (url.hash && url.pathname !== '/set-password')
  ) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

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
