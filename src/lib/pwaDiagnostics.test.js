/**
 * ════════════════════════════════════════════════
 * FILE: pwaDiagnostics.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves local diagnostics keep useful release/route classes while refusing
 *   raw identifiers, query values, messages, and stacks.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  pwaDiagnostics
 *   Data:      none (in-memory storage only)
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import {
  PWA_DIAGNOSTICS_KEY,
  PWA_DIAGNOSTICS_LIMIT,
  classifyClientError,
  readPwaDiagnostics,
  recordPwaDiagnostic,
  routeTemplate,
} from './pwaDiagnostics.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

const RELEASE = {
  releaseId: 'upr-web-abcdef1',
  sourceKnown: true,
};

describe('privacy-safe diagnostic shaping', () => {
  it('redacts IDs and removes query/hash content from route templates', () => {
    const route = routeTemplate(
      '/jobs/2f9532b0-41b3-4cbe-8ee8-f4911433f137?customer=PrivateName#note',
    );
    expect(route).toBe('/jobs/:id');
    expect(route).not.toContain('PrivateName');
    expect(route).not.toContain('2f9532b0');
    expect(routeTemplate('/jobs/job_1')).toBe('/jobs/:id');
  });

  it('stores classes, never raw error messages or customer-bearing stack text', () => {
    const target = storage();
    recordPwaDiagnostic('react-boundary', {
      section: 'Technician dashboard',
      route: '/jobs/1234567890123456?name=PrivateName',
      error: new Error('PrivateName failed to load'),
    }, {
      storage: target,
      release: RELEASE,
      now: Date.UTC(2026, 6, 26),
    });

    const raw = target.values.get(PWA_DIAGNOSTICS_KEY);
    expect(raw).not.toContain('PrivateName');
    expect(raw).not.toContain('1234567890123456');
    expect(readPwaDiagnostics({ storage: target })[0]).toMatchObject({
      kind: 'react-boundary',
      section: 'Technician dashboard',
      route: '/jobs/:id',
      errorClass: 'error',
      releaseId: 'upr-web-abcdef1',
    });
  });

  it('keeps only the bounded newest local events', () => {
    const target = storage();
    for (let index = 0; index < PWA_DIAGNOSTICS_LIMIT + 5; index++) {
      recordPwaDiagnostic('window-error', { section: `event ${index}` }, {
        storage: target,
        release: RELEASE,
        now: Date.UTC(2026, 6, 26, 0, 0, index),
      });
    }
    const entries = readPwaDiagnostics({ storage: target });
    expect(entries).toHaveLength(PWA_DIAGNOSTICS_LIMIT);
    expect(entries[0].section).toBe('event 5');
  });

  it('classifies chunk and network failures without retaining the message', () => {
    expect(classifyClientError(new Error('Failed to fetch dynamically imported module'))).toBe('chunk-load');
    expect(classifyClientError(new TypeError('Network request failed'))).toBe('network');
  });
});
