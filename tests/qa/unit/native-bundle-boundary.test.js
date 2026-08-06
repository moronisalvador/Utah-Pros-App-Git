/**
 * ════════════════════════════════════════════════
 * FILE: native-bundle-boundary.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps the iOS web bundle limited to public account entry/legal screens and
 *   field-mobile work. It proves that Vite selects separate page lists, replaces
 *   admin-mobile helpers with a denying shim, and checks the final native graph.
 *
 * DEPENDS ON:
 *   Packages:  node:fs, node:path, node:url, vitest
 *   Internal:  vite.config.js, scripts/native-bundle-boundary.mjs,
 *              src/routes/buildTargetPages.*, src/App.jsx
 *   Data:      reads  → repository source only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This is a credential-free source contract. `npm run build:native` is the
 *     separate proof that the guard accepts the real completed Vite graph.
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NATIVE_PAGE_ALLOWLIST,
  NATIVE_SHARED_SETTINGS_ALLOWLIST,
  nativeBundleViolation,
} from '../../../scripts/native-bundle-boundary.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const read = (relative) => readFileSync(path.join(repositoryRoot, relative), 'utf8');
const moduleId = (relative) => path.join(repositoryRoot, ...relative.split('/'));

function importedPages(source) {
  return [...new Set([...source.matchAll(
    /(?:from\s+|import\s*\()\s*['"](@\/pages\/[^'"]+)['"]/g,
  )].map((match) => match[1]))].sort();
}

function commaSeparatedNames(source, pattern) {
  const match = source.match(pattern);
  expect(match).toBeTruthy();
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

describe('native build target page registry', () => {
  it('imports only public account/legal and field-mobile entry pages', () => {
    const source = read('src/routes/buildTargetPages.native.jsx');
    expect(importedPages(source)).toEqual([
      '@/pages/Legal',
      '@/pages/Login',
      // Bounded billing exception (owner-directed 2026-08-06, OOP-review
      // pattern): the grouped receive-payment screen, gated on billing roles +
      // feature:qbo_receive_payment at its native route. Its four collections
      // modules are the ONLY carve-out in NATIVE_COLLECTIONS_ALLOWLIST.
      '@/pages/ReceivePayment',
      '@/pages/SetPassword',
      '@/pages/SignPage',
      // Office-shell page deliberately shared into the native graph so techs
      // reach it from More > What's New. Admitted because it pulls in nothing
      // else: React, two bundled JSON files, its own CSS. No shell, no db.
      '@/pages/WhatsNew',
      '@/pages/tech/NativeOopEstimateReview',
      '@/pages/tech/TechAppointment',
      '@/pages/tech/TechClaimAlbum',
      '@/pages/tech/TechClaimDetail',
      '@/pages/tech/TechClaims',
      '@/pages/tech/TechDemoSheet',
      '@/pages/tech/TechEditAppointment',
      '@/pages/tech/TechFeedback',
      '@/pages/tech/TechHelp',
      '@/pages/tech/TechJobAlbum',
      '@/pages/tech/TechJobDetail',
      '@/pages/tech/TechJobDocuments',
      '@/pages/tech/TechMore',
      '@/pages/tech/TechNewAppointment',
      '@/pages/tech/TechNewCustomer',
      '@/pages/tech/TechNewEvent',
      '@/pages/tech/TechNewJob',
      '@/pages/tech/TechOOPPricingConfigured',
      '@/pages/tech/TechRoomDetail',
      '@/pages/tech/TechSettings',
      '@/pages/tech/TechTasks',
      '@/pages/tech/v2/TechJobHub',
    ]);
    expect(source).not.toMatch(/@\/pages\/(?:crm|settings)\//);
    expect(source).not.toContain('@/pages/Conversations');
    expect(source).not.toContain('@/pages/tech/admin/');
    expect(source).toContain("import('@/pages/tech/NativeOopEstimateReview')");
  });

  it('keeps the browser registry complete instead of shrinking the web app', () => {
    const source = read('src/routes/buildTargetPages.web.jsx');
    const app = read('src/App.jsx');
    expect(source).toContain("import Layout from '@/components/Layout'");
    expect(source).toContain("import SettingsLayout from '@/components/SettingsLayout'");
    expect(source).toContain("import('@/pages/Dashboard')");
    expect(source).toContain("import('@/pages/Conversations')");
    expect(source).toContain("import('@/pages/settings/SettingsHome')");
    expect(source).toContain("import('@/pages/crm/CrmOverview')");
    expect(source).toContain("import('@/pages/tech/admin/AdminMobileRoutes')");

    const declaredLazyPages = [...source.matchAll(
      /^const ([A-Z][A-Za-z0-9]*) = lazyRetry/gm,
    )].map((match) => match[1]);
    const exportedPages = commaSeparatedNames(
      source,
      /export default Object\.freeze\(\{\n([\s\S]*?)\n\}\);/,
    );
    const appTargetPages = commaSeparatedNames(
      app,
      /const \{\n([\s\S]*?)\n\} = targetPages;/,
    );

    expect(exportedPages).toEqual(
      expect.arrayContaining(declaredLazyPages),
    );
    expect(appTargetPages).toEqual(
      expect.arrayContaining(exportedPages),
    );
  });
});

describe('native Vite graph enforcement', () => {
  it('selects target-specific pages and the denying admin-mobile shim before @ aliasing', () => {
    const source = read('vite.config.js');
    const pageAlias = source.indexOf("find: '@/routes/buildTargetPages'");
    const adminAlias = source.indexOf('find: /^@\\/components\\/admin-mobile');
    const rootAlias = source.indexOf("find: '@'");

    expect(pageAlias).toBeGreaterThan(-1);
    expect(adminAlias).toBeGreaterThan(pageAlias);
    expect(rootAlias).toBeGreaterThan(adminAlias);
    expect(source).toContain('nativeBundleBoundaryPlugin(rootDir)');
    expect(source).toContain('assertNativeBundleBoundary(moduleRecords, repositoryRoot)');
    expect(source).toContain('buildTargetPages.${buildTarget}.jsx');
    expect(source).toContain('nativeAdminMobileShim.js');
  });

  it('denies representative desktop, CRM, settings, QBO, and admin-mobile modules', () => {
    for (const relative of [
      'src/pages/Dashboard.jsx',
      'src/pages/Conversations.jsx',
      'src/pages/settings/SettingsHome.jsx',
      'src/pages/settings/OopPricingBuilder.jsx',
      'src/pages/crm/CrmOverview.jsx',
      'src/pages/tech/admin/AdminMobileRoutes.jsx',
      'src/components/Layout.jsx',
      'src/components/SettingsLayout.jsx',
      'src/components/CrmLayout.jsx',
      'src/components/collections/QboAttachments.jsx',
      'src/components/admin-mobile/index.js',
    ]) {
      expect(nativeBundleViolation(moduleId(relative), repositoryRoot), relative)
        .toBeTruthy();
    }
  });

  it('keeps every allowlisted field/public page accepted by the graph checker', () => {
    for (const relative of [
      ...NATIVE_PAGE_ALLOWLIST,
      ...NATIVE_SHARED_SETTINGS_ALLOWLIST,
    ]) {
      expect(nativeBundleViolation(moduleId(relative), repositoryRoot), relative).toBeNull();
    }
  });
});

describe('App target integration', () => {
  it('uses the selected registry instead of importing every page into both targets', () => {
    const source = read('src/App.jsx');
    expect(source).toContain("from '@/routes/buildTargetPages'");
    expect(source).toContain('const IS_NATIVE = IS_NATIVE_BUILD');
    expect(source).not.toMatch(/from ['"]@\/pages\//);
    expect(source).not.toMatch(/import\s*\(\s*['"]@\/pages\//);
    expect(source).not.toContain('function lazyRetry');
  });

  it('keeps native public legal/support plus the narrow OOP estimate review route', () => {
    const source = read('src/App.jsx');
    const nativeRoutes = source.slice(
      source.indexOf('function NativeRoutes()'),
      source.indexOf('function WebRoutes()'),
    );
    const techRoutes = source.slice(
      source.indexOf('function TechRoutes()'),
      source.indexOf('function NativeRoutes()'),
    );

    expect(nativeRoutes).toContain('<Route path="/privacy"');
    expect(nativeRoutes).toContain('<Route path="/terms"');
    expect(nativeRoutes).toContain('<Route path="/support"');
    expect(techRoutes).toMatch(
      /path="tech\/conversations"[\s\S]*?IS_NATIVE\s*\?\s*null\s*:/,
    );
    expect(techRoutes).toMatch(
      /\{!IS_NATIVE\s*&&\s*\(\s*<Route path="tech\/admin\/\*"/,
    );
    expect(techRoutes).toContain('path="tech/tools/oop-pricing/estimate/:estimateId"');
    expect(techRoutes).toContain('<AdminRoute><FeatureRoute flag="tool:oop_pricing">');
    expect(techRoutes).toContain('<NativeOopEstimateReview />');
  });
});
