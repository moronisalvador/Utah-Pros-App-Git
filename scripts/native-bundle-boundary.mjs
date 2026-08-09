/**
 * ════════════════════════════════════════════════
 * FILE: native-bundle-boundary.mjs
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Defines exactly which page files may ship inside the iOS web bundle. It also
 *   checks Vite's completed module graph and stops the build if an office,
 *   settings, CRM, QuickBooks, or admin-mobile implementation slipped in.
 *
 * DEPENDS ON:
 *   Packages:  node:path
 *   Internal:  src/routes/buildTargetPages.native.jsx, vite.config.js
 *   Data:      reads  → Vite module identifiers
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This checks the graph Vite actually bundled, not import text alone.
 *   - Add a field-mobile page here deliberately; a new file is denied by default.
 * ════════════════════════════════════════════════
 */
import path from 'node:path';

export const NATIVE_PAGE_ALLOWLIST = Object.freeze([
  'src/pages/Legal.jsx',
  'src/pages/Login.jsx',
  'src/pages/ReceivePayment.jsx',
  'src/pages/SetPassword.jsx',
  'src/pages/SignPage.jsx',
  // Shared with the office shell but reachable from Tech > More > What's New.
  // Safe in the native graph: it imports React, two bundled JSON files and its
  // own CSS — no shell, no office component, no database client.
  // The stylesheet needs its own entry because this rule matches every module
  // under src/pages/, not only components; it is the first co-located CSS here.
  'src/pages/WhatsNew.css',
  'src/pages/WhatsNew.jsx',
  // Bounded billing exception (owner-directed 2026-08-06): the grouped QBO
  // receive-payment screen, gated on billing roles + feature flag at its
  // route. Its form/kit live under src/components/collections (not matched by
  // this rule); no other office or QuickBooks page gains an import path.
  'src/pages/tech/NativeOopEstimateReview.jsx',
  'src/pages/tech/TechAppointment.jsx',
  'src/pages/tech/TechClaimAlbum.jsx',
  'src/pages/tech/TechClaimDetail.jsx',
  'src/pages/tech/TechClaims.jsx',
  'src/pages/tech/TechDemoSheet.jsx',
  // Co-located stylesheet, same reason as WhatsNew.css above: this rule matches
  // every module under src/pages/, so the CSS needs its own entry beside its page.
  'src/pages/tech/TechEditAppointment.css',
  'src/pages/tech/TechEditAppointment.jsx',
  'src/pages/tech/TechFeedback.jsx',
  'src/pages/tech/TechHelp.jsx',
  'src/pages/tech/TechJobAlbum.jsx',
  'src/pages/tech/TechJobDetail.jsx',
  'src/pages/tech/TechJobDocuments.jsx',
  'src/pages/tech/TechMore.jsx',
  'src/pages/tech/TechNewAppointment.jsx',
  'src/pages/tech/TechNewCustomer.jsx',
  'src/pages/tech/TechNewEvent.jsx',
  'src/pages/tech/TechNewJob.jsx',
  'src/pages/tech/TechOOPPricingConfigured.jsx',
  'src/pages/tech/TechRoomDetail.jsx',
  'src/pages/tech/TechSettings.jsx',
  'src/pages/tech/TechTasks.jsx',
  // Bounded office-surface exceptions, admitted ONE PAGE AT A TIME. The modules
  // they compose are NATIVE_ADMIN_MOBILE_ALLOWLIST below; the invoice and
  // lead-centre screens still gain no import path.
  //
  //   New Estimate (owner-directed 2026-08-07) — role-gated to BILLING_EDIT_ROLES
  //     at its native routes. TWO pages, not one: the builder's Send button and
  //     header both navigate to the detail page, so porting the builder alone
  //     would dead-end.
  //   Collections + Dashboard (owner-directed 2026-08-08) — the office A/R and
  //     overview screens on the phone. Their money content is gated twice: the
  //     screens drop the financial tabs/cards unless canAccess('overview_financials')
  //     (so a gated RPC is never even fetched), and the five money reports are
  //     server-gated to billing_edit_access() by ledger 20260808050037. Invoice
  //     detail is still NOT ported, so collFormat nulls invoice deep-links on
  //     native rather than pointing rows at a route that does not resolve.
  //
  // Listed HERE rather than beside the other tech pages because this array is
  // asserted to equal its own .sort(): 'admin/' orders after every 'Tech*.jsx'
  // and before 'tech*.js', since code-unit order puts 'T' < 'a' < 't'.
  'src/pages/tech/admin/AdminCollections.jsx',
  'src/pages/tech/admin/AdminDash.jsx',
  'src/pages/tech/admin/AdminEstimateDetail.jsx',
  'src/pages/tech/admin/AdminEstimateEditor.jsx',
  'src/pages/tech/admin/AdminLeadCenter.jsx',
  'src/pages/tech/admin/AdminLeadDetail.jsx',
  'src/pages/tech/techAppointmentCrew.js',
  'src/pages/tech/techConstants.js',
  'src/pages/tech/techFormConstants.js',
  'src/pages/tech/techHelpContent.jsx',
  'src/pages/tech/v2/TechDashV2.jsx',
  'src/pages/tech/v2/TechJobHub.jsx',
  'src/pages/tech/v2/TechMessagesV2.jsx',
  'src/pages/tech/v2/TechScheduleV2.jsx',
  'src/pages/tech/v2/dash/AttentionStrip.jsx',
  'src/pages/tech/v2/dash/ComingUp.jsx',
  'src/pages/tech/v2/dash/CompletedRows.jsx',
  'src/pages/tech/v2/dash/CreateFAB.jsx',
  'src/pages/tech/v2/dash/DashHeader.jsx',
  'src/pages/tech/v2/dash/MiniTimeline.jsx',
  'src/pages/tech/v2/dash/MyNumbers.jsx',
  'src/pages/tech/v2/dash/NowNextHero.jsx',
  'src/pages/tech/v2/dash/PhotoCaptureButton.jsx',
  'src/pages/tech/v2/dash/dashHelpers.js',
  'src/pages/tech/v2/hub/AdminJobMenu.jsx',
  'src/pages/tech/v2/hub/HubActionBar.jsx',
  'src/pages/tech/v2/hub/HubBelowFold.jsx',
  'src/pages/tech/v2/hub/HubChecklist.jsx',
  'src/pages/tech/v2/hub/HubDock.jsx',
  'src/pages/tech/v2/hub/HubHeader.jsx',
  'src/pages/tech/v2/hub/HubMoreSheet.jsx',
  'src/pages/tech/v2/hub/HubStage.jsx',
  'src/pages/tech/v2/hub/HubTools.jsx',
  'src/pages/tech/v2/hub/JobClaimSection.jsx',
  'src/pages/tech/v2/hub/JobStage.jsx',
  'src/pages/tech/v2/hub/PhotosNotes.jsx',
  'src/pages/tech/v2/hub/hubChecklistState.js',
  'src/pages/tech/v2/hub/hubHelpers.js',
  'src/pages/tech/v2/hub/hubStageState.js',
  'src/pages/tech/v2/hub/useVisitClock.js',
  'src/pages/tech/v2/job-hub.css',
  'src/pages/tech/v2/messages/Composer.jsx',
  'src/pages/tech/v2/messages/ConvoList.jsx',
  'src/pages/tech/v2/messages/ConvoRow.jsx',
  'src/pages/tech/v2/messages/NewConversationView.jsx',
  'src/pages/tech/v2/messages/TechMsgsPane.jsx',
  'src/pages/tech/v2/messages/ThreadView.jsx',
  'src/pages/tech/v2/messages/accessRevocation.js',
  'src/pages/tech/v2/messages/mediaUpload.js',
  'src/pages/tech/v2/messages/msgDateUtils.js',
  'src/pages/tech/v2/messages/msgsSelectors.js',
  'src/pages/tech/v2/messages/useComposerAttachments.js',
  'src/pages/tech/v2/messages/useConvoMutations.js',
  'src/pages/tech/v2/messages/useServiceSmsConsent.js',
  'src/pages/tech/v2/messages/useTechConversations.js',
  'src/pages/tech/v2/messages/useTemplates.js',
  'src/pages/tech/v2/messages/useThread.js',
  'src/pages/tech/v2/schedule/AgendaView.jsx',
  'src/pages/tech/v2/schedule/CreatePicker.jsx',
  'src/pages/tech/v2/schedule/CrewAvatars.jsx',
  'src/pages/tech/v2/schedule/DayTimeline.jsx',
  'src/pages/tech/v2/schedule/ScheduleHeader.jsx',
  'src/pages/tech/v2/schedule/ScheduleRow.jsx',
  'src/pages/tech/v2/schedule/WeekStrip.jsx',
  'src/pages/tech/v2/schedule/filterStore.js',
  'src/pages/tech/v2/schedule/scheduleFormat.js',
  'src/pages/tech/v2/schedule/scheduleSelectors.js',
  'src/pages/tech/v2/schedule/useScheduleData.js',
]);

const allowedNativePages = new Set(NATIVE_PAGE_ALLOWLIST);

export const NATIVE_SHARED_SETTINGS_ALLOWLIST = Object.freeze([
  'src/components/settings/AccountDeletionPanel.jsx',
  'src/components/settings/NotificationPrefsMatrix.jsx',
]);

const allowedNativeSharedSettings = new Set(NATIVE_SHARED_SETTINGS_ALLOWLIST);

// The bounded receive-payment slice (owner-directed 2026-08-06): exactly the
// modules the allowlisted ReceivePayment page composes. Everything else under
// src/components/collections stays web-only — QboAttachments, the ledgers,
// the editors' kits, all of it.
export const NATIVE_COLLECTIONS_ALLOWLIST = Object.freeze([
  'src/components/collections/ReceivePaymentForm.jsx',
  'src/components/collections/ReceivePaymentMobileFlow.jsx',
  'src/components/collections/collKit.jsx',
  'src/components/collections/collTokens.js',
  'src/components/collections/paymentAllocation.js',
]);

const allowedNativeCollections = new Set(NATIVE_COLLECTIONS_ALLOWLIST);

// The bounded office-surface slice: exactly the modules the four admitted pages
// compose — New Estimate (owner-directed 2026-08-07) plus Collections and
// Dashboard (owner-directed 2026-08-08). The leads rows, the invoice subtree
// (PaymentSheet, recordPayment) and deliberately the barrel (index.js) and
// AdminMobileRoute stay web-only, so no native module can reach an unported
// screen or the all-four "Admin" menu through a re-export.
//
// The barrel exclusion is load-bearing in BOTH directions. Native aliases
// '@/components/admin-mobile' to a denying shim, which is what keeps that menu off
// the phone — but it also means a screen importing primitives FROM the barrel
// silently receives undefined and renders blank, with the build still green. Every
// module below is therefore reached by its concrete path; see the import comments
// on AdminCollections, AdminDash and the four collections tabs.
export const NATIVE_ADMIN_MOBILE_ALLOWLIST = Object.freeze([
  'src/components/admin-mobile/AdminMobilePage.jsx',
  // The four shared primitives the Collections and Dashboard screens compose.
  'src/components/admin-mobile/AmListRow.jsx',
  'src/components/admin-mobile/AmTabs.jsx',
  'src/components/admin-mobile/MoneyStatCard.jsx',
  'src/components/admin-mobile/PeriodSwitch.jsx',
  // Collections: the four tabs, their shared row/aging math and their small UI kit.
  'src/components/admin-mobile/collections/ArAgingTab.jsx',
  'src/components/admin-mobile/collections/EstimatesTab.jsx',
  'src/components/admin-mobile/collections/InvoicesTab.jsx',
  'src/components/admin-mobile/collections/PaymentsTab.jsx',
  'src/components/admin-mobile/collections/collFormat.js',
  'src/components/admin-mobile/collections/collUi.jsx',
  // Dashboard: the card shell, the three card groups, their shapers, the fixed
  // widget plan (which owns the financial gate) and the shared fetch hook.
  'src/components/admin-mobile/dash/DashCard.jsx',
  'src/components/admin-mobile/dash/FinancialCards.jsx',
  'src/components/admin-mobile/dash/OpsCards.jsx',
  'src/components/admin-mobile/dash/WorkCards.jsx',
  'src/components/admin-mobile/dash/dashFormat.js',
  'src/components/admin-mobile/dash/dashPlan.js',
  'src/components/admin-mobile/dash/useDashWidget.js',
  'src/components/admin-mobile/estimate/CatalogPicker.jsx',
  'src/components/admin-mobile/estimate/EstimateCreateForm.jsx',
  'src/components/admin-mobile/estimate/EstimateHeader.jsx',
  'src/components/admin-mobile/estimate/EstimateLines.jsx',
  'src/components/admin-mobile/estimate/LineItemCard.jsx',
  'src/components/admin-mobile/estimate/estimateActions.js',
  'src/components/admin-mobile/estimate/estimateBuilder.js',
  'src/components/admin-mobile/href.js',
  // AdminMobilePage's back chevron. A pure leaf — zero imports, SVG only. Found by
  // the module-graph guard, not by reading the imports: it is a transitive pull.
  'src/components/admin-mobile/icons.jsx',
  // Lead Center (owner-directed 2026-08-08). The list stays a scannable list:
  // the recording, transcript, contact block, stage mover and activity timeline
  // all live on the pushed detail screen, so there is no accordion row here.
  'src/components/admin-mobile/leads/LeadContactCard.jsx',
  'src/components/admin-mobile/leads/LeadRow.jsx',
  'src/components/admin-mobile/leads/LeadStageMover.jsx',
  'src/components/admin-mobile/leads/RecordingPlayer.jsx',
  'src/components/admin-mobile/leads/TranscriptView.jsx',
  'src/components/admin-mobile/leads/leadFormat.js',
]);

const allowedNativeAdminMobile = new Set(NATIVE_ADMIN_MOBILE_ALLOWLIST);

const FORBIDDEN_NATIVE_MODULES = new Set([
  'src/components/CrmLayout.jsx',
  'src/components/Layout.jsx',
  'src/components/SettingsLayout.jsx',
  'src/routes/buildTargetPages.js',
  'src/routes/buildTargetPages.web.jsx',
]);

// The bounded CRM slice (owner-directed 2026-08-08): exactly the modules the
// native lead detail screen composes. This replaced a blanket
// 'src/components/crm/' prefix ban when Lead Center was admitted — the same
// move the collections and admin-mobile bans made before it — so everything
// else under crm/ (CrmLayout's kit, the kanban, the campaign and automation
// surfaces) is still denied by default and a NEW file under crm/ still fails
// the native build unless it is named here.
//
// ActivityTimeline is REUSED rather than reimplemented on purpose. The desktop
// lead card already renders it, and a second native timeline reading the same
// get_lead_activity RPC is exactly the cross-shell duplication the
// reconciliation plan exists to stop. Its imports are all native-safe already:
// AuthContext, @/lib/transcript, @/lib/toast, TabLoading, ui/ErrorState.
export const NATIVE_CRM_ALLOWLIST = Object.freeze([
  'src/components/crm/ActivityTimeline.jsx',
]);

const allowedNativeCrm = new Set(NATIVE_CRM_ALLOWLIST);

const FORBIDDEN_NATIVE_PREFIXES = Object.freeze([]);

function withoutViteSuffix(moduleId) {
  const nul = moduleId.indexOf('\0');
  if (nul === 0) return '';
  const query = moduleId.indexOf('?');
  return query === -1 ? moduleId : moduleId.slice(0, query);
}

export function repositoryModulePath(moduleId, repositoryRoot) {
  if (typeof moduleId !== 'string' || !moduleId) return null;
  const cleanId = withoutViteSuffix(moduleId);
  if (!cleanId || !path.isAbsolute(cleanId)) return null;
  const relative = path.relative(path.resolve(repositoryRoot), cleanId);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
  return relative.split(path.sep).join('/');
}

export function nativeBundleViolation(moduleId, repositoryRoot) {
  const relative = repositoryModulePath(moduleId, repositoryRoot);
  if (!relative) return null;

  if (relative.startsWith('src/pages/') && !allowedNativePages.has(relative)) {
    return `${relative} is not in the native page allowlist`;
  }
  if (FORBIDDEN_NATIVE_MODULES.has(relative)) {
    return `${relative} is a web-only shell or page registry`;
  }
  if (
    relative.startsWith('src/components/settings/')
    && !allowedNativeSharedSettings.has(relative)
  ) {
    return `${relative} is not in the native shared-settings allowlist`;
  }
  if (
    relative.startsWith('src/components/collections/')
    && !allowedNativeCollections.has(relative)
  ) {
    return `${relative} is not in the native collections allowlist`;
  }
  // Deny-by-default, same shape as the collections carve-out above: this replaced a
  // blanket prefix ban when the New Estimate slice was admitted, so adding a file
  // under src/components/admin-mobile still fails the native build unless it is
  // named in NATIVE_ADMIN_MOBILE_ALLOWLIST.
  if (
    relative.startsWith('src/components/admin-mobile/')
    && !allowedNativeAdminMobile.has(relative)
  ) {
    return `${relative} is not in the native admin-mobile allowlist`;
  }
  // Deny-by-default, same shape as the three carve-outs above.
  if (
    relative.startsWith('src/components/crm/')
    && !allowedNativeCrm.has(relative)
  ) {
    return `${relative} is not in the native CRM allowlist`;
  }
  if (FORBIDDEN_NATIVE_PREFIXES.some((prefix) => relative.startsWith(prefix))) {
    return `${relative} belongs to a web-only implementation subtree`;
  }
  return null;
}

export function assertNativeBundleBoundary(moduleRecords, repositoryRoot) {
  const violations = [];
  for (const record of moduleRecords) {
    const moduleId = typeof record === 'string' ? record : record?.id;
    const violation = nativeBundleViolation(moduleId, repositoryRoot);
    if (!violation) continue;
    const chunk = typeof record === 'string' ? '' : record?.chunk;
    violations.push(chunk ? `${violation} (chunk: ${chunk})` : violation);
  }

  const uniqueViolations = [...new Set(violations)].sort();
  if (uniqueViolations.length === 0) return;
  throw new Error(
    `Native bundle boundary refused ${uniqueViolations.length} module(s):\n`
    + uniqueViolations.map((violation) => `- ${violation}`).join('\n'),
  );
}

export function resolveBuildTarget(value) {
  const target = String(value || 'web').trim().toLowerCase();
  if (target === 'web' || target === 'native') return target;
  throw new Error(`VITE_BUILD_TARGET must be exactly "web" or "native"; received "${value}"`);
}
