/**
 * ════════════════════════════════════════════════
 * FILE: sw-target.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Validates a Web Push tap target inside the classic service-worker runtime.
 *   Only currently emitted authenticated application routes are accepted.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  public/sw.js (loaded with importScripts)
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Keep this classic-script compatible; `/sw.js` is not registered as a
 *     module worker.
 *   - Unknown or malformed targets always fall back to `/tech`.
 * ════════════════════════════════════════════════
 */
(function installPushTargetPolicy(root) {
  'use strict';

  const FALLBACK_TARGET = '/tech';
  const SIMPLE_ROUTES = new Set([
    '/tech',
    '/tech/feedback',
    '/tech-feedback',
    '/time-tracking',
    '/collections',
    '/melds',
    '/devtools',
    '/settings/feedback',
  ]);
  const ID = '[A-Za-z0-9_-]{1,128}';
  const ID_ROUTES = [
    new RegExp(`^/tech/appointment/${ID}$`),
    // PUSH-01. Notification rows written between the office-appointment bell fix
    // and that finding's repair carry link=/schedule/appointment/:id with no
    // data.url, and normalized to the '/tech' fallback — the appointment was
    // unreachable from its own push. The route exists (App.jsx) and is wrapped in
    // TechShellRedirect, so a field tech opening it still lands on
    // /tech/appointment/:id. New pushes carry the field path directly.
    new RegExp(`^/schedule/appointment/${ID}$`),
    new RegExp(`^/estimates/${ID}$`),
    new RegExp(`^/jobs/${ID}$`),
    new RegExp(`^/invoices/${ID}$`),
  ];
  const QUERY_ROUTES = new Map([
    ['/conversations', new Set(['c'])],
    ['/tech/conversations', new Set(['c'])],
    ['/crm/leads', new Set(['lead'])],
  ]);

  function hasAllowedQuery(url, allowedNames) {
    const seen = new Set();
    for (const [name, value] of url.searchParams.entries()) {
      if (!allowedNames.has(name) || seen.has(name) || !value || value.length > 128) return false;
      seen.add(name);
    }
    return true;
  }

  function isAllowedPath(url) {
    if (SIMPLE_ROUTES.has(url.pathname)) return !url.search;
    if (ID_ROUTES.some((pattern) => pattern.test(url.pathname))) return !url.search;
    const queryNames = QUERY_ROUTES.get(url.pathname);
    return !!queryNames && hasAllowedQuery(url, queryNames);
  }

  function normalizePushTarget(value, origin) {
    if (typeof value !== 'string' || !origin || value.length > 2048) return FALLBACK_TARGET;
    if (value !== value.trim() || !value.startsWith('/') || value.startsWith('//')) return FALLBACK_TARGET;
    if (value.includes('\\') || /%(?:00|2e|2f|5c)/i.test(value.split('?')[0])) return FALLBACK_TARGET;

    try {
      const url = new URL(value, origin);
      if (url.origin !== origin || url.username || url.password || url.hash) return FALLBACK_TARGET;
      if (url.pathname.includes('//') || !isAllowedPath(url)) return FALLBACK_TARGET;
      return `${url.pathname}${url.search}`;
    } catch {
      return FALLBACK_TARGET;
    }
  }

  root.UPRPushTarget = Object.freeze({
    FALLBACK_TARGET,
    normalizePushTarget,
  });
})(self);
