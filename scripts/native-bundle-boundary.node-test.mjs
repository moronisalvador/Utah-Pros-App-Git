/**
 * ════════════════════════════════════════════════
 * FILE: native-bundle-boundary.node-test.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves that the native build accepts only its named public and field-mobile
 *   pages. It also proves that office, CRM, settings, QuickBooks, and
 *   admin-mobile implementation files stop the build.
 *
 * DEPENDS ON:
 *   Packages:  node:assert, node:fs, node:path, node:test
 *   Internal:  scripts/native-bundle-boundary.mjs, src/pages/
 *   Data:      reads  → native allowlisted source paths
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - These are pure graph checks; the native Vite build exercises the same
 *     assertion against the real generated bundle.
 * ════════════════════════════════════════════════
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  NATIVE_PAGE_ALLOWLIST,
  NATIVE_SHARED_SETTINGS_ALLOWLIST,
  assertNativeBundleBoundary,
  nativeBundleViolation,
  repositoryModulePath,
  resolveBuildTarget,
} from './native-bundle-boundary.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const moduleId = (relative) => path.join(repositoryRoot, ...relative.split('/'));

test('the explicit page allowlist is sorted, unique, present, and excludes tests/admin-mobile pages', () => {
  assert.deepEqual(NATIVE_PAGE_ALLOWLIST, [...NATIVE_PAGE_ALLOWLIST].sort());
  assert.equal(new Set(NATIVE_PAGE_ALLOWLIST).size, NATIVE_PAGE_ALLOWLIST.length);
  for (const relative of NATIVE_PAGE_ALLOWLIST) {
    assert.equal(existsSync(moduleId(relative)), true, `${relative} must exist`);
    assert.doesNotMatch(relative, /\/admin\//);
    assert.doesNotMatch(relative, /\.(?:test|spec)\./);
  }
});

test('the shared-settings exception is exact, sorted, unique, and present', () => {
  assert.deepEqual(
    NATIVE_SHARED_SETTINGS_ALLOWLIST,
    [...NATIVE_SHARED_SETTINGS_ALLOWLIST].sort(),
  );
  assert.equal(
    new Set(NATIVE_SHARED_SETTINGS_ALLOWLIST).size,
    NATIVE_SHARED_SETTINGS_ALLOWLIST.length,
  );
  for (const relative of NATIVE_SHARED_SETTINGS_ALLOWLIST) {
    assert.equal(existsSync(moduleId(relative)), true, `${relative} must exist`);
    assert.equal(nativeBundleViolation(moduleId(relative), repositoryRoot), null);
  }
});

test('normalizes real Vite file identifiers back to repository paths', () => {
  assert.equal(
    repositoryModulePath(`${moduleId('src/pages/Login.jsx')}?v=123`, repositoryRoot),
    'src/pages/Login.jsx',
  );
  assert.equal(repositoryModulePath('\0vite/modulepreload-polyfill.js', repositoryRoot), null);
  assert.equal(repositoryModulePath('/outside/repository.jsx', repositoryRoot), null);
});

test('accepts public and field-mobile page modules named in the allowlist', () => {
  assert.equal(nativeBundleViolation(moduleId('src/pages/Login.jsx'), repositoryRoot), null);
  assert.equal(
    nativeBundleViolation(moduleId('src/pages/tech/techAppointmentCrew.js'), repositoryRoot),
    null,
  );
  assert.equal(
    nativeBundleViolation(moduleId('src/pages/tech/v2/TechMessagesV2.jsx'), repositoryRoot),
    null,
  );
});

test('rejects desktop, CRM, settings, and admin-mobile page modules', () => {
  assert.match(
    nativeBundleViolation(moduleId('src/pages/Dashboard.jsx'), repositoryRoot),
    /not in the native page allowlist/,
  );
  assert.match(
    nativeBundleViolation(moduleId('src/pages/crm/CrmLeads.jsx'), repositoryRoot),
    /not in the native page allowlist/,
  );
  assert.match(
    nativeBundleViolation(moduleId('src/pages/settings/SettingsHome.jsx'), repositoryRoot),
    /not in the native page allowlist/,
  );
  assert.match(
    nativeBundleViolation(
      moduleId('src/pages/tech/admin/AdminMobileRoutes.jsx'),
      repositoryRoot,
    ),
    /not in the native page allowlist/,
  );
});

test('rejects web-only shells and implementation subtrees', () => {
  for (const relative of [
    'src/components/Layout.jsx',
    'src/components/SettingsLayout.jsx',
    'src/components/CrmLayout.jsx',
    'src/components/admin-mobile/adminMobileAccess.js',
    'src/components/collections/QboAttachments.jsx',
    'src/components/crm/CrmLayoutSlot.jsx',
    'src/components/settings/AppearanceSection.jsx',
    'src/routes/buildTargetPages.web.jsx',
  ]) {
    assert.ok(nativeBundleViolation(moduleId(relative), repositoryRoot), relative);
  }
});

test('the aggregate assertion reports chunk ownership and all violations', () => {
  assert.throws(
    () => assertNativeBundleBoundary([
      { id: moduleId('src/pages/Dashboard.jsx'), chunk: 'assets/Dashboard.js' },
      {
        id: moduleId('src/components/admin-mobile/index.js'),
        chunk: 'assets/admin-mobile.js',
      },
    ], repositoryRoot),
    (error) => {
      assert.match(error.message, /Native bundle boundary refused 2 module/);
      assert.match(error.message, /assets\/Dashboard\.js/);
      assert.match(error.message, /assets\/admin-mobile\.js/);
      return true;
    },
  );
});

test('build target selection defaults to web and rejects ambiguous values', () => {
  assert.equal(resolveBuildTarget(undefined), 'web');
  assert.equal(resolveBuildTarget(' WEB '), 'web');
  assert.equal(resolveBuildTarget('native'), 'native');
  assert.throws(() => resolveBuildTarget('ios'), /must be exactly "web" or "native"/);
});
