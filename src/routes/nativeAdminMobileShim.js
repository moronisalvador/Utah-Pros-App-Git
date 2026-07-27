/**
 * ════════════════════════════════════════════════
 * FILE: nativeAdminMobileShim.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Keeps admin-mobile links and menu checks harmless inside the field-only iOS
 *   bundle. It always denies access and sends any leftover admin link back to
 *   the field home without loading the real admin screens or their money tools.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  none
 *   Data:      reads  → none
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Vite uses this file only for native builds.
 *   - The empty icon set is safe because canAccessAdminMobile always returns
 *     false, so TechMore never constructs the native-excluded admin menu.
 * ════════════════════════════════════════════════
 */
export const ADMIN_MOBILE_BASE = '/tech';
export const ADMIN_MOBILE_FLAG = 'page:admin_mobile';
export const AmIcons = Object.freeze({});

export function canAccessAdminMobile() {
  return false;
}

export const adminDashHref = () => ADMIN_MOBILE_BASE;
export const adminCollectionsHref = () => ADMIN_MOBILE_BASE;
export const adminLeadsHref = () => ADMIN_MOBILE_BASE;
export const adminInvoiceHref = () => ADMIN_MOBILE_BASE;
export const adminEstimateHref = () => ADMIN_MOBILE_BASE;
export const adminEstimateEditorHref = () => ADMIN_MOBILE_BASE;
