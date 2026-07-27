/**
 * ════════════════════════════════════════════════
 * FILE: releaseIdentity.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Gives every browser bundle one privacy-safe release label and keeps query
 *   cache compatibility separate from marketing dates or maintainer memory.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads → Vite build environment only
 *
 * NOTES / GOTCHAS:
 *   - Release builds should inject `VITE_RELEASE_SHA` from the exact reviewed
 *     commit. Missing injection is visible as `sourceKnown:false`; no guessed SHA
 *     is ever reported.
 *   - Bump CACHE_COMPATIBILITY_VERSION only when persisted query shapes become
 *     incompatible. A normal compatible deploy does not need to discard cache.
 * ════════════════════════════════════════════════
 */
export const CACHE_COMPATIBILITY_VERSION = 'tech-query-v2';

function cleanSegment(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

export function buildReleaseIdentity(env = {}) {
  const target = env.VITE_BUILD_TARGET === 'native' ? 'native' : 'web';
  const rawSource = env.VITE_RELEASE_SHA || env.VITE_RELEASE_ID || '';
  const sourceKnown = !!String(rawSource).trim();
  const source = cleanSegment(rawSource, 'unversioned');
  const releaseId = `upr-${target}-${source}`;
  const cacheCompatibilityId = `${CACHE_COMPATIBILITY_VERSION}-${target}`;
  return Object.freeze({
    target,
    source,
    sourceKnown,
    releaseId,
    cacheCompatibilityId,
  });
}

export const RELEASE = buildReleaseIdentity(import.meta.env);
