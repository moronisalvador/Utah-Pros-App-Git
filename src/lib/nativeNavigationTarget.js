/**
 * ════════════════════════════════════════════════
 * FILE: nativeNavigationTarget.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Validates every route that may enter the native app. The pure policy is
 *   shared by Capacitor link handling and the APNs worker so an unsafe route is
 *   rejected before it reaches Apple as well as before the app navigates.
 *
 * DEPENDS ON:
 *   Packages:  none — deliberately server-importable
 *   Internal:  ./nativeHosts.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Password-recovery links are valid app links but are never valid APNs
 *     payload routes because their fragment contains credentials.
 *   - Push routes fall back to `/` on any invalid, oversized, encoded, admin,
 *     or unsupported query shape.
 * ════════════════════════════════════════════════
 */
import { NATIVE_APP_HTTPS_HOSTS } from './nativeHosts.js';

export const NATIVE_APP_SCHEME = 'com.utahprosrestoration.upr';
export const NATIVE_APP_SCHEME_HOST = 'app';
export { NATIVE_APP_HTTPS_HOSTS };

const MAX_TARGET_LENGTH = 8_192;
const MAX_PUSH_TARGET_LENGTH = 2_048;
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
 * Turn an absolute Universal Link, the app's custom URL, or an internal target
 * into one native-supported route. Unsafe input returns null.
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

/**
 * APNs carries only short, credential-free, allowlisted relative routes.
 */
export function resolveNativePushRoute(value) {
  if (
    typeof value !== 'string'
    || value.length > MAX_PUSH_TARGET_LENGTH
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('#')
  ) {
    return '/';
  }
  const target = resolveNativeNavigationTarget(value);
  if (!target || PUBLIC_SIGNING_PATH.test(target)) return '/';
  return target;
}
