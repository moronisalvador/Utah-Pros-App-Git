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
// Bounded New Estimate exception (owner-directed 2026-08-07): build an estimate on
// the phone and send it to the customer. Role-gated to BILLING_EDIT_ROLES at the
// routes. Two pages because the builder's Send button and header both navigate to
// the detail screen — the detail page owns the send. Convert-to-invoice is disabled
// natively (its destination, the invoice screen, stays web-only).
const AdminEstimateEditor = lazyRetry(() => import('@/pages/tech/admin/AdminEstimateEditor'));
const AdminEstimateDetail = lazyRetry(() => import('@/pages/tech/admin/AdminEstimateDetail'));
// Bounded Collections + Dashboard exception (owner-directed 2026-08-08): the office
// A/R and overview screens on the phone, role-gated to BILLING_EDIT_ROLES at their
// routes. Their money content is gated a second time INSIDE each screen on
// canAccess('overview_financials'), which drops the financial tabs/cards so their
// RPCs are never fetched — and those five reports are server-gated to
// billing_edit_access() as of ledger 20260808050037, so the phone can never render a
// number the database would refuse. Invoice detail stays web-only (its record-payment
// write path still has no idempotency key), so invoice rows are non-tappable here.
const AdminCollections = lazyRetry(() => import('@/pages/tech/admin/AdminCollections'));
const AdminDash = lazyRetry(() => import('@/pages/tech/admin/AdminDash'));
// Bounded Lead Center exception (owner-directed 2026-08-08): the inbound-lead
// list and one lead's own screen — contact, stage mover, recording, transcript
// and the desktop's own activity timeline, reused rather than rebuilt. Gated at
// the More row and the routes on canAccess('crm_leads'|'crm_call_log'), the same
// nav keys public.crm_lead_access() resolves server-side, so the phone never
// offers a screen the database would refuse. The detail screen is PUSHED, not a
// sheet: five sections inside a list row would be an accordion wall.
const AdminLeadCenter = lazyRetry(() => import('@/pages/tech/admin/AdminLeadCenter'));
const AdminLeadDetail = lazyRetry(() => import('@/pages/tech/admin/AdminLeadDetail'));

export const IS_NATIVE_BUILD = true;

export default Object.freeze({
  AdminCollections,
  AdminDash,
  AdminEstimateDetail,
  AdminEstimateEditor,
  AdminLeadCenter,
  AdminLeadDetail,
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
