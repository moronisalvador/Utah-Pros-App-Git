/**
 * NAV-01 — native route outcomes are guarded and reachable.
 *
 * Two of the finding's confirmed defects are fixed here; the rest are staged
 * because they are authorization or product decisions rather than mechanical
 * ones (see the commit message).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('NAV-01 — room detail is feature-guarded', () => {
  it('wraps the room route in the same flag its parent grid uses', () => {
    // TechClaimDetail gates the rooms grid on page:tech_rooms and skips
    // get_claim_rooms entirely when off, but the route itself had no guard —
    // so a direct URL, or back-nav after the flag flipped, reached an ungated
    // screen. TechRoomDetail.jsx contains no isFeatureEnabled call of its own.
    const app = read('src/App.jsx');
    const at = app.indexOf('tech/claims/:claimId/rooms/:roomId');
    expect(at).toBeGreaterThan(-1);
    const route = app.slice(at, app.indexOf('/>', at));
    expect(route).toContain('FeatureRoute flag="page:tech_rooms"');
  });

  it('uses the same flag the parent screen gates on', () => {
    const claimDetail = read('src/pages/tech/TechClaimDetail.jsx');
    expect(claimDetail).toContain('page:tech_rooms');
  });
});

describe('NAV-01 — the Admin view affordance', () => {
  it('asks canAccessAdminMobile, not a bare role check', () => {
    // adminDashHref() is '/tech/admin/dash' on web and '/tech' on native, so a
    // role-only gate meant an admin tapped "Admin view" on iOS and silently
    // stayed put. The shim hard-returns false, so the item now disappears.
    const dash = read('src/pages/tech/v2/TechDashV2.jsx');
    expect(dash).toContain('canAccessAdminMobile({');
    expect(dash).not.toMatch(/const isAdmin = employee\?\.role === 'admin';/);
  });

  it('passes the flag too, which the role check ignored', () => {
    // On web this additionally respects page:admin_mobile — the previous check
    // would have shown the item to an admin with the flag off.
    const dash = read('src/pages/tech/v2/TechDashV2.jsx');
    expect(dash).toContain('flagEnabled: isFeatureEnabled(ADMIN_MOBILE_FLAG)');
  });

  it('matches the call shape TechMore already uses', () => {
    // Two different call shapes for one predicate is how they drift.
    const more = read('src/pages/tech/TechMore.jsx');
    expect(more).toContain('canAccessAdminMobile({');
    expect(more).toContain('flagEnabled: isFeatureEnabled(ADMIN_MOBILE_FLAG)');
  });

  it('keeps the native shim denying and the web predicate real', () => {
    const shim = read('src/routes/nativeAdminMobileShim.js');
    expect(shim).toMatch(/export function canAccessAdminMobile\(\) \{\s*\n\s*return false;/);
    expect(shim).toContain('ADMIN_MOBILE_FLAG');
    const real = read('src/components/admin-mobile/adminMobileAccess.js');
    // The point of this assertion is that the REAL predicate is a real decision,
    // not the shim's unconditional `return false`. It pinned the literal
    // `role === 'admin'` until 2026-08-08, when the owner's role-adaptive mobile
    // decision widened it to the three office roles; the intent is unchanged.
    expect(real).toMatch(/ADMIN_MOBILE_ROLES\.includes\(role\)\s*&&\s*flagEnabled === true/);
    expect(real).not.toMatch(/return false;\s*\}/);
  });
});

describe('NAV-01 — native admin deep-link boundary', () => {
  const NATIVE_ADMIN_PATHS = [
    'tech/admin/estimate/new',
    'tech/admin/estimate/:estimateId/edit',
    'tech/admin/estimate/:estimateId',
    'tech/admin/leads',
    'tech/admin/leads/:leadId',
    'tech/admin/collections',
    'tech/admin/dash',
    'tech/admin/invoice/:invoiceId/line/:lineId',
    'tech/admin/invoice/:invoiceId/pay',
    'tech/admin/invoice/:invoiceId',
  ];

  it('keeps every native /tech/admin deep link behind the canonical dark-launch flag', async () => {
    // App.jsx cannot import AdminMobileRoute in the native graph: that web
    // subrouter is deliberately excluded from iOS. Each native route therefore
    // repeats its one flag gate locally, then retains its own role/capability
    // wrappers. This source check covers the actual route declarations instead
    // of only the link affordances, which a direct URL bypasses.
    const app = read('src/App.jsx');
    expect(app).toContain(
      "ADMIN_MOBILE_FLAG,\n  ADMIN_MOBILE_ROLES,\n} from '@/components/admin-mobile/adminMobileAccess'",
    );

    for (const path of NATIVE_ADMIN_PATHS) {
      const at = app.indexOf(`path="${path}"`);
      expect(at, `${path} must be a declared native route`).toBeGreaterThan(-1);
      const route = app.slice(at, app.indexOf('/>', at));
      expect(route, `${path} must fail closed when page:admin_mobile is off`)
        .toContain('<FeatureRoute flag={ADMIN_MOBILE_FLAG}>');
      expect(route, `${path} must retain its role boundary`).toContain('<RoleRoute roles={');
    }
  });

  it('denies a native deep link with the flag off and admits only an eligible role with it on', async () => {
    // This is the same truth table AdminMobileRoute uses on web. Keeping it
    // alongside the native source contract makes the native copy explicit
    // without importing the native-denied AdminMobileRoutes graph.
    const { canAccessAdminMobile } = await import(
      '../../../src/components/admin-mobile/adminMobileAccess.js'
    );

    expect(canAccessAdminMobile({ role: 'admin', flagEnabled: false })).toBe(false);
    expect(canAccessAdminMobile({ role: 'field_tech', flagEnabled: true })).toBe(false);
    expect(canAccessAdminMobile({ role: 'office', flagEnabled: true })).toBe(true);
  });
});

describe('NAV-01 — phantom role removed', () => {
  it('no longer admits "manager" to the field shell', () => {
    // 'manager' is in neither AuthContext.SUPPORTED_EMPLOYEE_ROLES nor
    // navKeys ROLES, so no session can hold it.
    const bootstrap = read('src/contexts/authBootstrap.js');
    const at = bootstrap.indexOf('FIELD_SHELL_ROLES');
    const list = bootstrap.slice(at, bootstrap.indexOf(']', at));
    expect(list).not.toContain("'manager'");
  });

  it('records that four other manager gates are still open', () => {
    // Left deliberately: `role === 'admin' || role === 'manager'` is currently
    // equivalent to admin-only, so every one of these DENIES today. Changing
    // them GRANTS access — an authorization decision, not a rename.
    const stillDead = [
      'src/pages/tech/TechJobDetail.jsx',
      'src/pages/tech/TechClaimDetail.jsx',
      'src/pages/ClaimPage.jsx',
      'src/pages/tech/v2/TechJobHub.jsx',
    ];
    for (const file of stillDead) {
      expect(read(file), file).toContain("=== 'manager'");
    }
  });

  it('BILLING_EDIT_ROLES was RESOLVED 2026-08-04 — decided, not renamed', () => {
    // This one used to be listed above as a dead 'manager' gate awaiting an
    // authorization decision. The owner made it: billing editing widened to
    // office + project_manager, and the dead literal was dropped rather than
    // carried forward. Server-side parity shipped in the same change
    // (public.billing_edit_access), so this is no longer an open UI-only gate.
    // Full contract: tests/qa/unit/billing-editor-role-boundary.test.js.
    const claimUtils = read('src/lib/claimUtils.js');
    expect(claimUtils).toContain("export const BILLING_EDIT_ROLES = ['admin', 'office', 'project_manager']");
    expect(claimUtils).not.toContain("['admin', 'manager']");
    // Payout authority did NOT widen with it — moving money out stays admin-only.
    expect(claimUtils).toContain("export const PAYOUT_MANAGE_ROLES = ['admin']");
  });
});
