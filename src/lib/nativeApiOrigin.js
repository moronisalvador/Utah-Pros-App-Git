/**
 * ════════════════════════════════════════════════
 * FILE: nativeApiOrigin.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Tells the installed iPhone app which website address to send its server
 *   requests to. On the website itself this is never needed — a request for
 *   "/api/something" already goes to the right place. Inside the app there is no
 *   website underneath, so the same request goes nowhere and the feature quietly
 *   fails. This works out the full address to use instead.
 *
 * Exports:
 *   DEFAULT_NATIVE_API_ORIGIN  the origin used when nothing is configured
 *   resolveNativeApiOrigin()   validated origin for this build
 *   isApiPath()                whether a pathname is a Pages Function route
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  ./nativeHosts.js (NATIVE_APP_HTTPS_HOSTS)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - WHY THIS EXISTS. capacitor.config.json sets no server.url, no
 *     server.hostname and no iosScheme, so Capacitor iOS serves the bundled app
 *     from the custom-scheme origin `capacitor://localhost`. A relative
 *     fetch('/api/x') resolves against THAT origin, so it is answered by
 *     Capacitor's local bundle handler instead of Cloudflare. Confirmed on
 *     device 2026-07-28: creating a job succeeded (Supabase, absolute URL) while
 *     the Encircle sync fired in the same tap failed (/api/..., relative).
 *   - The origin is ALLOWLISTED, not free-form. It must be https and its host
 *     must already appear in NATIVE_APP_HTTPS_HOSTS — the same list that governs
 *     universal links and copied signing URLs. A build cannot be pointed at an
 *     arbitrary host by setting one environment variable, and there is exactly
 *     one list of trusted hosts rather than two that can drift apart.
 *   - Reused by the build script, which fails the native build outright on an
 *     invalid value rather than letting a misconfigured app ship.
 * ════════════════════════════════════════════════
 */
import { NATIVE_APP_HTTPS_HOSTS } from './nativeHosts.js';

/**
 * Dev is the default on purpose. A build that forgets to declare its origin
 * should talk to dev.utahpros.app, never to production — the safe direction for
 * an accident is "the test app hits the test site", not the reverse.
 */
export const DEFAULT_NATIVE_API_ORIGIN = 'https://dev.utahpros.app';

/** Pages Functions all live under this prefix; nothing else is rewritten. */
export function isApiPath(pathname) {
  return typeof pathname === 'string' && pathname.startsWith('/api/');
}

/**
 * The https origin this native build should send /api calls to.
 *
 * Returns null when the value is present but not trustworthy, so the caller can
 * decide: the build script fails, the runtime falls back to the default.
 */
export function parseNativeApiOrigin(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // https only — a custom scheme or http origin would silently downgrade every
  // authenticated request the app makes.
  if (url.protocol !== 'https:') return null;
  if (!NATIVE_APP_HTTPS_HOSTS.includes(url.hostname)) return null;
  // Reject anything carrying a path, query or fragment: those would be dropped
  // when composing the request URL, so accepting them would be misleading.
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

export function resolveNativeApiOrigin(env) {
  return parseNativeApiOrigin(env?.VITE_NATIVE_API_ORIGIN) || DEFAULT_NATIVE_API_ORIGIN;
}
