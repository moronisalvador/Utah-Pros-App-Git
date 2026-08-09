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

// The admin-mobile pages the native build may carry, named one at a time.
//
// A blanket `doesNotMatch(/\/admin\//)` stood here until 2026-08-07 and was the
// right rule while ZERO admin pages were ported. The owner-directed New Estimate
// exception ported exactly two, so the blanket ban became a rule that forbade
// something the app is supposed to do — it failed CI on `dev` and blocked a
// promotion. The subtree ban is what mattered and it is kept: an admin page still
// cannot arrive by being under src/pages/tech/admin/, only by being written here
// deliberately, which is a reviewed edit.
//
// Collections + Dashboard joined them on 2026-08-08 by the same owner-directed,
// one-page-at-a-time route. Still unported and still refused: Lead Center (blocked
// on retiring lead_status as a state machine) and invoice detail (blocked on the
// record-payment write path, which has no idempotency key).
//
// tests/qa/unit/native-bundle-boundary.test.js asserts the same set from the other
// direction (the native route registry imports these four and none of the unported
// admin screens). Both files encode this boundary; change them together.
const NATIVE_ADMIN_PAGE_EXCEPTIONS = Object.freeze([
  'src/pages/tech/admin/AdminCollections.jsx',
  'src/pages/tech/admin/AdminDash.jsx',
  'src/pages/tech/admin/AdminEstimateDetail.jsx',
  'src/pages/tech/admin/AdminEstimateEditor.jsx',
  'src/pages/tech/admin/AdminLeadCenter.jsx',
  'src/pages/tech/admin/AdminLeadDetail.jsx',
]);

test('the explicit page allowlist is sorted, unique, present, and admits only the named admin pages', () => {
  assert.deepEqual(NATIVE_PAGE_ALLOWLIST, [...NATIVE_PAGE_ALLOWLIST].sort());
  assert.equal(new Set(NATIVE_PAGE_ALLOWLIST).size, NATIVE_PAGE_ALLOWLIST.length);
  for (const relative of NATIVE_PAGE_ALLOWLIST) {
    assert.equal(existsSync(moduleId(relative)), true, `${relative} must exist`);
    if (relative.includes('/admin/')) {
      assert.ok(
        NATIVE_ADMIN_PAGE_EXCEPTIONS.includes(relative),
        `${relative} is an admin page outside the named office-surface exceptions`,
      );
    }
    assert.doesNotMatch(relative, /\.(?:test|spec)\./);
  }
});

test('every named admin page exception is actually allowlisted and still exists', () => {
  // Guards the other direction: an exception that is removed from the allowlist,
  // or renamed on disk, must fail here rather than quietly widen what /admin/ means.
  for (const relative of NATIVE_ADMIN_PAGE_EXCEPTIONS) {
    assert.ok(
      NATIVE_PAGE_ALLOWLIST.includes(relative),
      `${relative} is named as an admin exception but is not in NATIVE_PAGE_ALLOWLIST`,
    );
    assert.equal(existsSync(moduleId(relative)), true, `${relative} must exist`);
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
