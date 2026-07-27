/**
 * ════════════════════════════════════════════════
 * FILE: pwaDiagnostics.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps a small, local support trail for browser/render failures. It records
 *   release, route template, event class, and section only—never IDs, query
 *   values, error messages, stacks, employee data, or customer content.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  releaseIdentity
 *   Data:      reads/writes → sessionStorage `upr:pwa-diagnostics:v1`
 *
 * NOTES / GOTCHAS:
 *   - This is local containment evidence, not a monitoring provider.
 *   - Call `installPwaDiagnostics()` once at bootstrap; cleanup is returned for
 *     tests and non-browser runtimes.
 * ════════════════════════════════════════════════
 */
import { RELEASE } from './releaseIdentity.js';

export const PWA_DIAGNOSTICS_KEY = 'upr:pwa-diagnostics:v1';
export const PWA_DIAGNOSTICS_LIMIT = 20;

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const OPAQUE_SEGMENT = /^[a-z0-9_-]{16,}$/i;
const DYNAMIC_ROUTE_PARENTS = new Set([
  'appointment',
  'appointments',
  'claim',
  'claims',
  'conversation',
  'conversations',
  'customer',
  'customers',
  'estimate',
  'estimates',
  'invoice',
  'invoices',
  'job',
  'jobs',
  'lead',
  'leads',
  'room',
  'rooms',
]);
const SAFE_KINDS = new Set([
  'react-boundary',
  'window-error',
  'unhandled-rejection',
  'service-worker',
  'account-state',
  'install',
]);

function safeStorage(override) {
  if (override) return override;
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function cleanLabel(value, fallback = 'unknown') {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9 _.-]+/g, '')
    .trim()
    .slice(0, 48);
  return cleaned || fallback;
}

export function routeTemplate(value) {
  try {
    const url = new URL(value || '/', 'https://upr.invalid');
    const rawSegments = url.pathname.split('/');
    const segments = rawSegments.map((segment, index) => {
      if (!segment) return segment;
      const parent = rawSegments[index - 1]?.toLowerCase();
      if (
        DYNAMIC_ROUTE_PARENTS.has(parent)
        || /^\d+$/.test(segment)
        || UUID_SEGMENT.test(segment)
        || OPAQUE_SEGMENT.test(segment)
      ) {
        return ':id';
      }
      return segment.replace(/[^a-zA-Z0-9._~-]/g, '').slice(0, 40) || ':segment';
    });
    return segments.join('/') || '/';
  } catch {
    return '/unknown';
  }
}

export function classifyClientError(error) {
  const name = cleanLabel(error?.name, 'Error');
  const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  if (/chunk|dynamically imported module|module script/.test(text)) return 'chunk-load';
  if (/network|fetch|offline|abort/.test(text)) return 'network';
  if (/syntax/.test(text)) return 'syntax';
  if (/quota|storage/.test(text)) return 'storage';
  return cleanLabel(name, 'runtime').toLowerCase();
}

export function readPwaDiagnostics({ storage } = {}) {
  try {
    const raw = safeStorage(storage)?.getItem(PWA_DIAGNOSTICS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-PWA_DIAGNOSTICS_LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordPwaDiagnostic(kind, {
  section,
  route = globalThis.location?.pathname || '/',
  error,
  detail,
} = {}, {
  storage,
  now = Date.now(),
  release = RELEASE,
} = {}) {
  const event = {
    at: new Date(now).toISOString(),
    kind: SAFE_KINDS.has(kind) ? kind : 'window-error',
    section: cleanLabel(section || detail, 'app'),
    route: routeTemplate(route),
    errorClass: classifyClientError(error),
    releaseId: release.releaseId,
    releaseKnown: release.sourceKnown,
  };
  try {
    const target = safeStorage(storage);
    if (!target) return event;
    const entries = readPwaDiagnostics({ storage: target });
    target.setItem(
      PWA_DIAGNOSTICS_KEY,
      JSON.stringify([...entries, event].slice(-PWA_DIAGNOSTICS_LIMIT)),
    );
  } catch {
    // Diagnostics must never become a new application failure.
  }
  return event;
}

export function installPwaDiagnostics(target = globalThis.window) {
  if (!target?.addEventListener) return () => {};
  const onError = (event) => {
    recordPwaDiagnostic('window-error', {
      section: 'window',
      error: event?.error,
      route: target.location?.pathname,
    });
  };
  const onRejection = (event) => {
    recordPwaDiagnostic('unhandled-rejection', {
      section: 'promise',
      error: event?.reason,
      route: target.location?.pathname,
    });
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
