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
  NATIVE_ADMIN_MOBILE_ALLOWLIST,
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
      // Bounded office-surface exceptions, one page at a time. New Estimate
      // (2026-08-07): build an estimate on the phone and send it — TWO pages,
      // because the builder's Send button and header navigate to the detail
      // screen, which owns the send. Collections + Dashboard (2026-08-08): the
      // office A/R and overview screens, role-gated at their routes and gated
      // again inside each screen on canAccess('overview_financials'). Their
      // shared modules are NATIVE_ADMIN_MOBILE_ALLOWLIST; the invoice and
      // lead-centre screens and the barrel stay denied (asserted below).
      '@/pages/tech/admin/AdminCollections',
      '@/pages/tech/admin/AdminDash',
      '@/pages/tech/admin/AdminEstimateDetail',
      '@/pages/tech/admin/AdminEstimateEditor',
      '@/pages/tech/admin/AdminInvoiceDetail',
      '@/pages/tech/admin/AdminLeadCenter',
      '@/pages/tech/admin/AdminLeadDetail',
      '@/pages/tech/v2/TechJobHub',
    ]);
    expect(source).not.toMatch(/@\/pages\/(?:crm|settings)\//);
    expect(source).not.toContain('@/pages/Conversations');
    expect(source).toContain("import('@/pages/tech/NativeOopEstimateReview')");
    // The admin-mobile pages are admitted ONE AT A TIME, never as a subtree. A
    // blanket '@/pages/tech/admin/' ban used to stand here; these assertions are
    // what replaced it, so admitting another page is a deliberate edit rather than
    // something a glob quietly lets through. AdminMobileRoutes — the web router
    // that would drag EVERY admin screen in at once — stays refused.
    expect(source).toContain("import('@/pages/tech/admin/AdminEstimateEditor')");
    expect(source).toContain("import('@/pages/tech/admin/AdminEstimateDetail')");
    expect(source).toContain("import('@/pages/tech/admin/AdminCollections')");
    expect(source).toContain("import('@/pages/tech/admin/AdminDash')");
    expect(source).toContain("import('@/pages/tech/admin/AdminInvoiceDetail')");
    expect(source).toContain("import('@/pages/tech/admin/AdminLeadCenter')");
    expect(source).toContain("import('@/pages/tech/admin/AdminLeadDetail')");
    expect(source).not.toContain('@/pages/tech/admin/AdminMobileRoutes');
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
      // The barrel stays denied even though most of its subtree is now allowed —
      // it re-exports AdminMobileRoute and the leads/invoice primitives, and the
      // native build additionally aliases it to the denying shim. That shim is what
      // keeps TechMore's all-four "Admin" menu off the phone, and it is also why
      // every admitted screen imports its primitives by concrete path: a barrel
      // import resolves to the shim and renders blank with the build still green.
      'src/components/admin-mobile/index.js',
      'src/components/admin-mobile/adminMobileAccess.js',
      'src/components/admin-mobile/AdminMobileRoute.jsx',
      'src/pages/tech/admin/AdminMobileRoutes.jsx',
    ]) {
      expect(nativeBundleViolation(moduleId(relative), repositoryRoot), relative)
        .toBeTruthy();
    }
  });

  it('admits exactly the modules the four admitted pages compose', () => {
    for (const relative of NATIVE_ADMIN_MOBILE_ALLOWLIST) {
      expect(nativeBundleViolation(moduleId(relative), repositoryRoot), relative).toBeNull();
    }
    // Deny-by-default survived the carve-out: a NEW file under admin-mobile is
    // still refused, which is the property the blanket prefix ban used to provide.
    expect(nativeBundleViolation(
      moduleId('src/components/admin-mobile/estimate/SomethingNew.jsx'),
      repositoryRoot,
    )).toBeTruthy();
  });

  it('never lets a natively-shipped module reach the shimmed barrel', () => {
    // The defect this catches is SILENT. Native aliases '@/components/admin-mobile'
    // to nativeAdminMobileShim.js, which exports no components — so a barrel import
    // leaves AdminMobilePage/AmTabs/PeriodSwitch/AmListRow/MoneyStatCard undefined
    // and the screen renders blank while the build stays green and the graph guard
    // stays silent (the shim is a legal module; the barrel never enters the graph).
    // Found 2026-08-08: all four Collections tabs plus both new pages did exactly
    // this. Only a running app or this assertion catches it.
    const barrelImport = /from\s+'@\/components\/admin-mobile'/;
    const nativeAdminMobile = NATIVE_ADMIN_MOBILE_ALLOWLIST
      .filter((relative) => /\.jsx?$/.test(relative));
    // DERIVED from the page allowlist, not hand-listed: the hand-listed version
    // named four pages and silently stopped covering Lead Center, Lead Detail and
    // invoice detail as they were admitted — which is precisely how a barrel
    // import gets back in through the one file nobody remembered to add.
    const nativeAdminPages = NATIVE_PAGE_ALLOWLIST
      .filter((relative) => relative.includes('/admin/') && /\.jsx?$/.test(relative));
    expect(nativeAdminPages.length).toBeGreaterThanOrEqual(7);
    for (const relative of [...nativeAdminMobile, ...nativeAdminPages]) {
      expect(read(relative), `${relative} must import admin-mobile primitives by concrete path`)
        .not.toMatch(barrelImport);
    }
  });

  it('re-opens the invoice deep-link now that the route resolves in both builds', () => {
    // This test used to pin the OPPOSITE: collFormat nulled invoiceHref on native
    // because AdminInvoiceDetail had no native route, so AR, Invoices and Payments
    // rows were deliberately non-tappable. The page now ships natively at the same
    // path, so the build-target guard is gone — kept as a test rather than deleted
    // so re-adding a native-only null is a visible, argued change.
    const collFormat = read('src/components/admin-mobile/collections/collFormat.js');
    expect(collFormat).not.toContain('VITE_BUILD_TARGET');
    expect(collFormat).not.toContain('IS_NATIVE_BUILD');
    // Still ONE helper for all three row builders — a direct adminInvoiceHref call
    // in a row builder is what let the three drift apart in the first place.
    expect(collFormat).toMatch(/const invoiceHref = \(invoiceId\) => \(invoiceId \? adminInvoiceHref\(invoiceId\) : null\);/);
    expect(collFormat.match(/href: invoiceHref\(r\.invoice_id\),/g)).toHaveLength(3);
    expect(collFormat).not.toMatch(/href: adminInvoiceHref\(/);
    expect(collFormat).toContain('href: adminEstimateHref(r.estimate_id),');
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
