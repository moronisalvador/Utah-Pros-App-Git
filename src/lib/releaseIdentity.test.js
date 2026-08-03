/**
 * ════════════════════════════════════════════════
 * FILE: releaseIdentity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Pins release/source normalization and the separate cache-compatibility ID.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  releaseIdentity
 *   Data:      none
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { buildReleaseIdentity, CACHE_COMPATIBILITY_VERSION } from './releaseIdentity.js';

describe('buildReleaseIdentity', () => {
  it('uses the privacy-safe v3 cache compatibility generation', () => {
    expect(CACHE_COMPATIBILITY_VERSION).toBe('tech-query-v3');
  });

  it('binds an injected reviewed source to the web release', () => {
    expect(buildReleaseIdentity({ VITE_RELEASE_SHA: 'ABCDEF123456' })).toEqual({
      target: 'web',
      source: 'abcdef123456',
      sourceKnown: true,
      releaseId: 'upr-web-abcdef123456',
      cacheCompatibilityId: `${CACHE_COMPATIBILITY_VERSION}-web`,
    });
  });

  it('keeps native and web compatibility identities separate', () => {
    const native = buildReleaseIdentity({
      VITE_BUILD_TARGET: 'native',
      VITE_RELEASE_SHA: 'abcdef1',
    });
    expect(native.target).toBe('native');
    expect(native.cacheCompatibilityId).toBe(`${CACHE_COMPATIBILITY_VERSION}-native`);
  });

  it('reports missing source injection honestly without guessing a commit', () => {
    expect(buildReleaseIdentity({})).toMatchObject({
      source: 'unversioned',
      sourceKnown: false,
      releaseId: 'upr-web-unversioned',
    });
  });
});
