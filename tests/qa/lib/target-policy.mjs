/**
 * ════════════════════════════════════════════════
 * FILE: target-policy.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Names the only local browser and database targets that credential-free QA may use. It rejects
 *   every unknown, hosted, production, provider, or human-browser target before a runner starts.
 *
 * DEPENDS ON:
 *   Packages:  Node.js built-ins only
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These constants are safety sentinels, not environment discovery or production configuration.
 *   - Adding a target requires a reviewed code change; wildcards and environment fallbacks are banned.
 * ════════════════════════════════════════════════
 */

import path from 'node:path';

export const PRODUCTION_PROJECT_REF = 'glsmljpabrwonfiltiqm';
export const LOCAL_BROWSER_ORIGIN = 'http://127.0.0.1:4173';
export const LOCAL_SUPABASE_ORIGIN = 'http://127.0.0.1:54321';
export const LOCAL_DATABASE_SENTINEL = 'upr-local-only-v1';

const HUMAN_PROFILE_MARKERS = [
  '/google/chrome/user data',
  '/microsoft/edge/user data',
  '/brave-browser/user data',
  '/mozilla/firefox/profiles',
  '/.mozilla/firefox/',
];
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;

function denial(kind, reason) {
  throw new Error(`${kind} denied: ${reason}`);
}

function parseUrl(value, kind) {
  if (typeof value !== 'string' || value.trim() === '') denial(kind, 'target is missing');
  try {
    return new URL(value);
  } catch {
    return denial(kind, 'target is not an absolute URL');
  }
}

export function assertBrowserTarget(value) {
  const target = parseUrl(value, 'QA target');
  if (target.origin !== LOCAL_BROWSER_ORIGIN) {
    denial('QA target', `origin ${target.origin} is not the governed local fixture`);
  }
  if (!['http:'].includes(target.protocol)) {
    denial('QA target', `protocol ${target.protocol} is not allowed`);
  }
  if (target.username || target.password) denial('QA target', 'URL credentials are forbidden');
  return Object.freeze({
    environment: 'local-fixture',
    origin: target.origin,
    href: target.href,
  });
}

export function assertLocalDatabaseTarget({ mode, projectRef, supabaseUrl } = {}) {
  if (mode !== 'local') denial('QA database target', 'mode must be exactly local');
  if (!projectRef || projectRef === PRODUCTION_PROJECT_REF) {
    denial('QA database target', 'project ref is missing or production');
  }

  const target = parseUrl(supabaseUrl, 'QA database target');
  if (target.origin !== LOCAL_SUPABASE_ORIGIN) {
    denial('QA database target', `origin ${target.origin} is not the governed local Supabase origin`);
  }
  if (target.pathname !== '/' || target.search || target.hash) {
    denial('QA database target', 'Supabase target must be an origin without a path or query');
  }
  if (target.hostname !== '127.0.0.1') {
    denial('QA database target', 'ambiguous localhost aliases are forbidden');
  }

  return Object.freeze({
    mode,
    projectRef,
    origin: target.origin,
  });
}

export function assertCdpLaunchPolicy({ transport, userDataDir, repositoryRoot } = {}) {
  if (transport !== 'pipe') denial('CDP launch', 'only pipe transport is implemented');
  if (!userDataDir || !repositoryRoot) denial('CDP launch', 'profile and repository paths are required');

  const bothWindows =
    WINDOWS_ABSOLUTE_PATH.test(userDataDir) && WINDOWS_ABSOLUTE_PATH.test(repositoryRoot);
  const bothPosix = userDataDir.startsWith('/') && repositoryRoot.startsWith('/');
  if (!bothWindows && !bothPosix) {
    denial('CDP launch', 'profile and repository must use the same absolute path dialect');
  }

  const pathDialect = bothWindows ? path.win32 : path.posix;
  const profile = pathDialect.resolve(userDataDir);
  const repository = pathDialect.resolve(repositoryRoot);
  const relative = pathDialect.relative(repository, profile);
  if (relative === '' || (!relative.startsWith('..') && !pathDialect.isAbsolute(relative))) {
    denial('CDP launch', 'the ephemeral profile must live outside the repository');
  }

  const normalized = profile.replaceAll('\\', '/').toLowerCase();
  if (HUMAN_PROFILE_MARKERS.some((marker) => normalized.includes(marker))) {
    denial('CDP launch', 'human browser profiles are never owned');
  }

  return Object.freeze({
    transport,
    userDataDir: profile,
    repositoryRoot: repository,
  });
}
