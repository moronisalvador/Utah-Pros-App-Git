/**
 * ════════════════════════════════════════════════
 * FILE: index.js  (admin-mobile shared primitives barrel)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   One tidy front door for the admin-mobile building blocks. Screens can import
 *   what they need from '@/components/admin-mobile' instead of remembering each
 *   file's path.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (a re-export module)
 *   Rendered by:  n/a — imported by the admin-mobile pages
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  the sibling admin-mobile primitive files
 *   Data:      reads → none · writes → none
 *
 * NOTES / GOTCHAS:
 *   - This whole folder is FROZEN for the wave (Foundation-owned). Wave sessions
 *     import from here; a needed change is a disclosed copy-in or an F follow-up.
 * ════════════════════════════════════════════════
 */
export { default as AdminMobilePage } from './AdminMobilePage';
export { default as AdminMobileRoute } from './AdminMobileRoute';
export { default as MoneyStatCard } from './MoneyStatCard';
export { default as AmListRow } from './AmListRow';
export { default as PeriodSwitch, ADMIN_PERIODS } from './PeriodSwitch';
export { default as AmTabs } from './AmTabs';
export { canAccessAdminMobile, ADMIN_MOBILE_FLAG } from './adminMobileAccess';
export * from './href';
export * as AmIcons from './icons';
