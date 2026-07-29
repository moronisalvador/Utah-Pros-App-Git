/**
 * ════════════════════════════════════════════════
 * FILE: nativeApiFetch.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Inside the installed iPhone app, sends server requests to the real website
 *   instead of to nowhere. The app's screens ask for things like
 *   "/api/send-message". On the website that already points at the right place.
 *   In the app there is no website underneath, so those requests quietly went
 *   nowhere and features looked broken for no visible reason. This redirects
 *   just those requests to the real address. On the website it does nothing at
 *   all.
 *
 * Exports:
 *   installNativeApiFetch()   patch fetch on native; returns an uninstall fn
 *   rewriteApiRequestUrl()    the pure rewrite rule (exported for tests)
 *
 * DEPENDS ON:
 *   Packages:  @capacitor/core
 *   Internal:  ./nativeApiOrigin.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - WHY A GLOBAL PATCH. There are ~38 files calling fetch('/api/...'), spread
 *     across pages, hooks and libraries. Threading a helper through all of them
 *     means every missed site stays silently broken, and a NEW call site added
 *     later is broken by default. Patching once at boot fixes every present and
 *     future caller, and the rule is narrow enough to reason about: same-origin
 *     requests whose path starts with /api/ and nothing else.
 *   - IT DOES NOTHING ON WEB. install() returns immediately unless
 *     Capacitor.isNativePlatform(). The PWA's fetch is never touched, which is
 *     what keeps the frozen web behaviour byte-identical.
 *   - Only SAME-ORIGIN requests are rewritten. A call that already names a host
 *     — Supabase REST, Storage, a third party — is passed through untouched.
 *     That is why creating a job kept working in the app while the Encircle sync
 *     beside it failed: one was absolute, the other relative.
 *   - The rewritten request is CROSS-ORIGIN, so the Worker must allow the app's
 *     origin in functions/lib/cors.js. The Workers authorize on the Bearer
 *     session, not on Origin; CORS is a browser convenience here, not the gate.
 *   - Failure is loud, not silent. That is the whole point: the bug this fixes
 *     was invisible because Capacitor answered unknown paths from the bundle
 *     with a 200 and an HTML body, so response.ok stayed true and callers saw an
 *     empty object instead of an error.
 * ════════════════════════════════════════════════
 */
import { Capacitor } from '@capacitor/core';
import { isApiPath, resolveNativeApiOrigin } from './nativeApiOrigin.js';

/**
 * The rewrite rule, as a pure function.
 *
 * @param input     the fetch input (string, URL, or Request)
 * @param pageOrigin the origin the app's own document is served from
 * @param apiOrigin  the https origin to send /api calls to
 * @returns the absolute URL to use, or null to leave the request alone
 */
export function rewriteApiRequestUrl(input, pageOrigin, apiOrigin) {
  if (!pageOrigin || !apiOrigin) return null;

  const raw = typeof input === 'string' ? input
    : (input instanceof URL ? input.href
      : (input && typeof input.url === 'string' ? input.url : null));
  if (raw === null) return null;

  let base;
  let url;
  try {
    base = new URL(pageOrigin);
    url = new URL(raw, base);
  } catch {
    return null;
  }

  // Compare protocol + host, NOT url.origin. `capacitor:` is a non-special
  // scheme, and the URL spec defines origin for those as the opaque string
  // "null" — verified in node: new URL('/api/x','capacitor://localhost').origin
  // === "null". Comparing origins therefore fails to match a relative path
  // (making this whole rewrite a silent no-op), and would ALSO report two
  // different custom-scheme hosts as the same origin, since both are "null".
  // Absolute calls elsewhere — Supabase, Storage, a provider — are not ours.
  if (url.protocol !== base.protocol || url.host !== base.host) return null;
  if (!isApiPath(url.pathname)) return null;

  return `${apiOrigin}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Patch globalThis.fetch on native so /api calls reach the deployed Workers.
 *
 * Idempotent: calling it twice installs one patch. Returns an uninstall that
 * restores the previous fetch, so a test can put the environment back.
 */
export function installNativeApiFetch(options = {}) {
  const {
    platform = Capacitor,
    scope = typeof globalThis !== 'undefined' ? globalThis : null,
    env = import.meta.env,
    pageOrigin = typeof location !== 'undefined' ? location.origin : null,
  } = options;

  const noop = () => {};
  if (!scope || typeof scope.fetch !== 'function') return noop;
  if (!platform?.isNativePlatform?.()) return noop;   // web: never touched
  if (scope.fetch.__uprNativeApiFetch) return noop;   // already installed

  const apiOrigin = resolveNativeApiOrigin(env);
  const original = scope.fetch;

  const patched = function fetch(input, init) {
    let target;
    try {
      target = rewriteApiRequestUrl(input, pageOrigin, apiOrigin);
    } catch {
      target = null;                                   // never break a request
    }
    if (!target) return original.call(this, input, init);

    // A Request carries method, headers, body, signal and mode; rebuilding it
    // against the new URL preserves all of them. A plain string/URL just needs
    // the caller's init passed through unchanged.
    if (typeof Request !== 'undefined' && input instanceof Request) {
      return original.call(this, new Request(target, input), init);
    }
    return original.call(this, target, init);
  };
  patched.__uprNativeApiFetch = true;

  scope.fetch = patched;
  return function uninstall() {
    if (scope.fetch === patched) scope.fetch = original;
  };
}
