/**
 * ════════════════════════════════════════════════
 * FILE: buildTargetPages.native.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Lists the small, deliberate set of screens allowed inside the iOS bundle:
 *   login and recovery, public signing/legal/support, and field-mobile work.
 *   Office, CRM, desktop settings, QuickBooks, and admin-mobile screens have no
 *   import path from this file.
 *
 * DEPENDS ON:
 *   Packages:  none directly
 *   Internal:  src/routes/lazyRetry.js, src/pages/Login.jsx,
 *              src/pages/{SignPage,SetPassword,Legal}.jsx, src/pages/tech/
 *   Data:      reads  → none directly
 *              writes → none directly
 *
 * NOTES / GOTCHAS:
 *   - Vite selects this file only when VITE_BUILD_TARGET=native.
 *   - The module-graph guard in vite.config.js independently rejects a forbidden
 *     page even if someone later adds an accidental transitive import.
 * ════════════════════════════════════════════════
 */
import Login from '@/pages/Login';

import { lazyRetry } from './lazyRetry.js';

const SignPage = lazyRetry(() => import('@/pages/SignPage'));
const SetPassword = lazyRetry(() => import('@/pages/SetPassword'));
const PrivacyPolicy = lazyRetry(() => import('@/pages/Legal')
  .then((module) => ({ default: module.PrivacyPolicy })));
const TermsOfService = lazyRetry(() => import('@/pages/Legal')
  .then((module) => ({ default: module.TermsOfService })));
const Support = lazyRetry(() => import('@/pages/Legal')
  .then((module) => ({ default: module.Support })));
const TechSettings = lazyRetry(() => import('@/pages/tech/TechSettings'));
const TechTasks = lazyRetry(() => import('@/pages/tech/TechTasks'));
const TechClaims = lazyRetry(() => import('@/pages/tech/TechClaims'));
const TechClaimDetail = lazyRetry(() => import('@/pages/tech/TechClaimDetail'));
const TechClaimAlbum = lazyRetry(() => import('@/pages/tech/TechClaimAlbum'));
const TechRoomDetail = lazyRetry(() => import('@/pages/tech/TechRoomDetail'));
const TechJobDetail = lazyRetry(() => import('@/pages/tech/TechJobDetail'));
const TechJobHub = lazyRetry(() => import('@/pages/tech/v2/TechJobHub'));
const TechJobAlbum = lazyRetry(() => import('@/pages/tech/TechJobAlbum'));
const TechJobDocuments = lazyRetry(() => import('@/pages/tech/TechJobDocuments'));
const TechAppointment = lazyRetry(() => import('@/pages/tech/TechAppointment'));
const TechNewCustomer = lazyRetry(() => import('@/pages/tech/TechNewCustomer'));
const TechNewJob = lazyRetry(() => import('@/pages/tech/TechNewJob'));
const TechNewAppointment = lazyRetry(() => import('@/pages/tech/TechNewAppointment'));
const TechNewEvent = lazyRetry(() => import('@/pages/tech/TechNewEvent'));
const TechEditAppointment = lazyRetry(() => import('@/pages/tech/TechEditAppointment'));
const TechFeedback = lazyRetry(() => import('@/pages/tech/TechFeedback'));
const TechMore = lazyRetry(() => import('@/pages/tech/TechMore'));
const TechHelp = lazyRetry(() => import('@/pages/tech/TechHelp'));
// Shared with the office shell — same page, reached from Tech > More.
const WhatsNew = lazyRetry(() => import('@/pages/WhatsNew'));
const NativeOopEstimateReview = lazyRetry(() => import('@/pages/tech/NativeOopEstimateReview'));
const TechOOPPricing = lazyRetry(() => import('@/pages/tech/TechOOPPricingConfigured'));
const TechDemoSheet = lazyRetry(() => import('@/pages/tech/TechDemoSheet'));
// Bounded billing exception (owner-directed 2026-08-06, same pattern as the
// OOP estimate review): the grouped QBO receive-payment screen, role- and
// flag-gated at its route. This imports ONE office page; broad office,
// QuickBooks-admin, and collections surfaces remain excluded.
const ReceivePayment = lazyRetry(() => import('@/pages/ReceivePayment'));

export const IS_NATIVE_BUILD = true;

export default Object.freeze({
  Login,
  NativeOopEstimateReview,
  PrivacyPolicy,
  ReceivePayment,
  SetPassword,
  SignPage,
  Support,
  TechAppointment,
  TechClaimAlbum,
  TechClaimDetail,
  TechClaims,
  TechDemoSheet,
  TechEditAppointment,
  TechFeedback,
  TechHelp,
  TechJobAlbum,
  TechJobDetail,
  TechJobDocuments,
  TechJobHub,
  TechMore,
  TechNewAppointment,
  TechNewCustomer,
  TechNewEvent,
  TechNewJob,
  TechOOPPricing,
  TechRoomDetail,
  TechSettings,
  TechTasks,
  TermsOfService,
  WhatsNew,
});
