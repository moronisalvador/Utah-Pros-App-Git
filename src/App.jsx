/**
 * ════════════════════════════════════════════════
 * FILE: App.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Builds the application shell and decides which screen each URL opens. It
 *   keeps the browser product complete while packaging only field, account,
 *   legal, support, and signing screens into the iPhone product.
 *
 * WHERE IT LIVES:
 *   Route:        all application routes
 *   Rendered by:  src/main.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  contexts, route registry, layouts, guards, native security,
 *              account cleanup, route restoration
 *   Data:      reads  → none directly (AuthProvider and routed screens own reads)
 *              writes → none directly (AuthProvider and routed screens own writes)
 *
 * NOTES / GOTCHAS:
 *   - Vite selects separate web/native page registries before bundling. A native
 *     build fails if a forbidden desktop implementation enters its module graph.
 *   - Native links wait for the authenticated account-owner lease; saved-route
 *     restoration runs first so a newer external link remains the final intent.
 * ════════════════════════════════════════════════
 */
import { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { officeToTechPath } from '@/lib/techShellRoutes';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import '@/i18n'; // initialize the translation engine once, at app entry
import ProtectedRoute from '@/components/ProtectedRoute';
import FieldShellRoute from '@/components/FieldShellRoute';
import PublicNativeShell from '@/components/PublicNativeShell';
import ErrorBoundary from '@/components/ErrorBoundary';
import NativeNavigationBridge from '@/components/NativeNavigationBridge';
import NativeUpdateHealthGate from '@/components/NativeUpdateHealthGate';
import RouteRestorer from '@/components/RouteRestorer';
import { useNavDirection } from '@/lib/useNavDirection';
import { hideSplash } from '@/lib/nativeAppearance';
import { anySettingsChildVisible } from '@/lib/navItems';
import { OOP_PRICING_ROLES } from '@/lib/oopPricingAccess';
import { isMoroni } from '@/lib/owner';
import { SETTINGS_REDIRECTS } from '@/lib/settingsRedirects';
import { getAccountLandingPath } from '@/contexts/authBootstrap';
import targetPages, {
  IS_NATIVE_BUILD,
} from '@/routes/buildTargetPages';

import TechLayout from '@/components/TechLayout';

// Vite selects a complete web registry or a deliberately small native registry
// before Rollup builds the graph. The native graph cannot import office, CRM,
// QBO, desktop settings, or real admin-mobile implementations.
const {
  AdminDemoSheetBuilder,
  AdminFeedback,
  AdminIntegrations,
  AdminMobileRoutes,
  ClaimCollectionPage,
  ClaimPage,
  ClaimsList,
  Collections,
  Commissions,
  Conversations,
  CrmAttribution,
  CrmAutomations,
  CrmCallLog,
  CrmCampaigns,
  CrmContacts,
  CrmConversations,
  CrmForms,
  CrmIntegrations,
  CrmLayout,
  CrmLeads,
  CrmOverview,
  CrmReports,
  CrmRoadmap,
  CrmSequences,
  CrmSettings,
  CrmTasks,
  CustomerPage,
  Customers,
  Dashboard,
  DevTools,
  EncircleImport,
  EstimateEditor,
  Feedback,
  Help,
  HomebuildingAnalysis,
  InvoiceEditor,
  JobPage,
  Jobs,
  JobsClosed,
  Layout,
  Leads,
  ListsAndValues,
  Login,
  Marketing,
  Melds,
  MyAccount,
  NewBuildSimulator,
  NotificationDefaults,
  NotificationPresentation,
  NotificationsSettings,
  OOPPricing,
  OopPricingSettings,
  PageAccess,
  PaymentSettings,
  PrivacyPolicy,
  Production,
  PublicRoadmap,
  ReceivePayment,
  Roles,
  Schedule,
  ScheduleTemplates,
  SetPassword,
  SettingsHome,
  SettingsLayout,
  SignPage,
  Status,
  Support,
  Team,
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
  Templates,
  TemplatesEditor,
  TermsOfService,
  TimeTracking,
  WhatsNew,
} = targetPages;

const IS_NATIVE = IS_NATIVE_BUILD;

// SAFE-02: stamp the native root marker so CSS can scope device-shell rules
// (safe-area insets) to the Capacitor build ONLY. Set at module scope rather
// than in an effect so the very first paint already has it — a route that
// gained its inset one frame late would visibly jump under the Dynamic Island.
// env(safe-area-inset-*) is 0 in a browser regardless; the marker makes the
// PWA's exemption structural instead of incidental.
if (IS_NATIVE && typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-native', 'true');
}

// ── Route guards ──────────────────────────────────────────────────────────────

// Admin-only pages (role check)
function AdminRoute({ children }) {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/" replace />;
  if (employee.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function RoleRoute({ roles, children }) {
  const { employee } = useAuth();
  if (!employee || !roles.includes(employee.role)) return <Navigate to="/" replace />;
  return children;
}

// Feature-flagged pages — redirects to / when flag is disabled
// No flag row is generally unrestricted. OOP Pricing is the deliberate
// fail-closed exception because its calculator and quote data are role-gated.
function FeatureRoute({ flag, children }) {
  const { isFeatureEnabled } = useAuth();
  if (!isFeatureEnabled(flag)) return <Navigate to="/" replace />;
  return children;
}

// Dev Tools — hardcoded to Moroni only, not role-based
// Even other admins can't access this via direct URL
function DevRoute({ children }) {
  const { employee } = useAuth();
  if (!isMoroni(employee)) return <Navigate to="/" replace />;
  return children;
}

// Moroni-only pages (same hardcoded email gate as Dev Tools) — private analysis
// surfaces that even other admins can't reach via direct URL.
function MoroniRoute({ children }) {
  const { employee } = useAuth();
  if (!isMoroni(employee)) return <Navigate to="/" replace />;
  return children;
}

// Settings hub index (/settings) — GC3: reachable when ANY child settings page
// is visible to the user (keeps the override-only supervisor's path alive and,
// per GC8, every employee sees at least their Personal group). The individual
// sub-routes keep their own per-page guards.
function SettingsIndexRoute({ children }) {
  const { employee, canAccess } = useAuth();
  if (!employee) return <Navigate to="/" replace />;
  const ctx = { canAccess, employee, isMoroni: isMoroni(employee) };
  if (!anySettingsChildVisible(ctx)) return <Navigate to="/" replace />;
  return children;
}

// Permission-gated pages — pass when canAccess(navKey) is true. Admins always
// pass (canAccess returns true for role 'admin'); non-admins pass via a
// role nav_permission OR a per-employee page-access override. Used for pages
// that were once admin-only but can now be granted to specific non-admins.
function AccessRoute({ navKey, children }) {
  const { employee, canAccess } = useAuth();
  if (!employee) return <Navigate to="/" replace />;
  if (!canAccess(navKey)) return <Navigate to="/" replace />;
  return children;
}

// Redirect field_tech users from / to /tech (web only — native always redirects)
// and crm_partner users straight into the CRM (they have no access to Dashboard).
function HomeRedirect() {
  const { employee } = useAuth();
  const landingPath = getAccountLandingPath(employee?.role);
  if (landingPath !== '/') return <Navigate to={landingPath} replace />;
  return <ErrorBoundary section="Dashboard"><Dashboard /></ErrorBoundary>;
}

// Send field techs to the tech shell when they land on an office route that has a
// field equivalent.
//
// WHY THIS EXISTS: notification links are stored server-side as absolute office
// paths, and nothing knows who will receive them. The bell navigates to
// `item.link` and push opens `data.url` verbatim — neither is role-aware. So a
// tech tapping a message notification landed on `/conversations` (the office
// inbox rendered narrow) while the SAME event delivered by push went to
// `/tech/conversations`. Job notifications pointed at `/jobs/<id>`, the office
// job page, which is not the screen the field team uses.
//
// Fixing it here rather than at each link site is deliberate: four of those
// `/conversations` links are baked into SQL migrations, so they cannot be changed
// without a migration, and any link hardcoded later is covered automatically.
//
// Only `field_tech` is redirected — office, admin, supervisor, PM and estimator
// all legitimately use these pages, and trapping them in the tech shell would be
// a worse bug than the one being fixed. Query string and hash are preserved
// because the message links carry `?c=<conversationId>`.
// The office->field mapping lives in @/lib/techShellRoutes so this and
// NotificationBell cannot drift apart. Adding an escape route is one line there.
function TechShellRedirect({ children }) {
  const { employee } = useAuth();
  const location = useLocation();
  if (employee?.role === 'field_tech') {
    const techPath = officeToTechPath(location.pathname);
    if (techPath) return <Navigate to={`${techPath}${location.search}${location.hash}`} replace />;
  }
  return children;
}

// ─────────────────────────────────────────────────────────────────────────────

function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>404</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Page not found</div>
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>That page doesn't exist or was moved.</div>
      <a href="/" style={{ padding: '10px 24px', borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>Go to Dashboard</a>
    </div>
  );
}

// Fallback shown while a lazy page chunk downloads.
function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'var(--text-tertiary)', fontSize: 13 }}>
      Loading…
    </div>
  );
}

// Tech Mobile v2 cutover complete (Phase C): the legacy TechDash/TechSchedule
// pages are gone, so /tech and /tech/schedule render nothing in the <Outlet/> —
// the PERSISTENT v2 panes in TechLayout (always mounted; the flags stay on for
// everyone) cover the screen at those paths instead.

// Shared tech routes — used by both native and web trees
function TechRoutes() {
  return (
    <Route
      element={(
        // AUTH-01: ProtectedRoute proves WHO you are; FieldShellRoute decides
        // whether the field shell is yours at all. Before this, any signed-in
        // account — including the external crm_partner identity — could render
        // every /tech/* screen by typing the URL, tapping a notification, or
        // following a Universal Link. The landing redirect only fires on '/'.
        <ProtectedRoute>
          <FieldShellRoute>
            <TechLayout nativeBuild={IS_NATIVE} />
          </FieldShellRoute>
        </ProtectedRoute>
      )}
    >
      <Route path="tech" element={null} />
      <Route path="tech/schedule" element={null} />
      <Route path="tech/tasks" element={<ErrorBoundary section="TechTasks"><TechTasks /></ErrorBoundary>} />
      <Route path="tech/claims" element={<ErrorBoundary section="TechClaims"><TechClaims /></ErrorBoundary>} />
      <Route path="tech/claims/:claimId" element={<ErrorBoundary section="TechClaimDetail"><TechClaimDetail /></ErrorBoundary>} />
      <Route path="tech/claims/:claimId/photos" element={<ErrorBoundary section="TechClaimAlbum"><TechClaimAlbum /></ErrorBoundary>} />
      {/* NAV-01: TechClaimDetail gates the rooms grid on page:tech_rooms and
          skips get_claim_rooms entirely when it is off, but this route had no
          guard — so a flag-off user reaching the URL directly, or by back-nav
          after the flag flipped, landed on an ungated screen. */}
      <Route path="tech/claims/:claimId/rooms/:roomId" element={<FeatureRoute flag="page:tech_rooms"><ErrorBoundary section="TechRoomDetail"><TechRoomDetail /></ErrorBoundary></FeatureRoute>} />
      <Route path="tech/jobs/:jobId" element={<ErrorBoundary section="TechJobDetail"><TechJobDetail /></ErrorBoundary>} />
      {/* Tech Mobile v2 M1 — Job Hub. Flag-gated (page:tech_job_hub). v2 nav
          (apptHref/jobHref) repoints to the hub PER-USER for whoever the flag is
          on for (AuthContext → setHubNav); everyone else keeps legacy links, so
          they never reach here. This FeatureRoute still guards direct-URL access
          (a flag-off visitor is bounced to /). M2 opens the flag to all techs. */}
      <Route path="tech/job/:jobId" element={<FeatureRoute flag="page:tech_job_hub"><ErrorBoundary section="TechJobHub"><TechJobHub /></ErrorBoundary></FeatureRoute>} />
      <Route path="tech/jobs/:jobId/photos" element={<ErrorBoundary section="TechJobAlbum"><TechJobAlbum /></ErrorBoundary>} />
      <Route path="tech/jobs/:jobId/documents" element={<ErrorBoundary section="TechJobDocuments"><TechJobDocuments /></ErrorBoundary>} />
      <Route path="tech/appointment/:id/edit" element={<ErrorBoundary section="TechEditAppointment"><TechEditAppointment /></ErrorBoundary>} />
      <Route path="tech/appointment/:id" element={<ErrorBoundary section="TechAppointment"><TechAppointment /></ErrorBoundary>} />
      <Route path="tech/new-customer" element={<ErrorBoundary section="TechNewCustomer"><TechNewCustomer /></ErrorBoundary>} />
      <Route path="tech/new-job" element={<ErrorBoundary section="TechNewJob"><TechNewJob /></ErrorBoundary>} />
      <Route path="tech/new-appointment" element={<ErrorBoundary section="TechNewAppointment"><TechNewAppointment /></ErrorBoundary>} />
      <Route path="tech/new-event" element={<ErrorBoundary section="TechNewEvent"><TechNewEvent /></ErrorBoundary>} />
      <Route path="tech/conversations" element={IS_NATIVE ? null : <ErrorBoundary section="Conversations"><Conversations /></ErrorBoundary>} />
      <Route path="tech/feedback" element={<ErrorBoundary section="TechFeedback"><TechFeedback /></ErrorBoundary>} />
      <Route path="tech/more" element={<ErrorBoundary section="TechMore"><TechMore /></ErrorBoundary>} />
      <Route path="tech/settings" element={<ErrorBoundary section="TechSettings"><TechSettings /></ErrorBoundary>} />
      <Route path="tech/help" element={<ErrorBoundary section="TechHelp"><TechHelp /></ErrorBoundary>} />
      {/* What's New — the SAME page the office shell serves at /whats-new, not a
          tech copy. It reads no database and every colour is a token, so the
          tech shell's dark theme ([data-theme="dark"] .tech-layout) re-themes it
          for free and there is one record, not two that drift apart.
          In the native registry too, so the iOS app carries it. */}
      <Route path="tech/whats-new" element={<ErrorBoundary section="What's New"><WhatsNew /></ErrorBoundary>} />
      {/* Legal/support INSIDE the field shell. Apple requires these reachable in-app,
          and TechSettings links them. The office copies at /privacy, /terms and
          /support render with no shell at all — correct pre-login, but a dead end
          from the PWA/Capacitor container, where there is no browser back button:
          a tech who tapped Privacy had to force-quit. Same components, tech chrome,
          bottom nav intact. The office routes stay for the logged-out case. */}
      <Route path="tech/legal/privacy" element={<ErrorBoundary section="PrivacyPolicy"><PrivacyPolicy /></ErrorBoundary>} />
      <Route path="tech/legal/terms" element={<ErrorBoundary section="TermsOfService"><TermsOfService /></ErrorBoundary>} />
      <Route path="tech/legal/support" element={<ErrorBoundary section="Support"><Support /></ErrorBoundary>} />
      <Route path="tech/tools/oop-pricing" element={
        <RoleRoute roles={OOP_PRICING_ROLES}>
          <FeatureRoute flag="tool:oop_pricing">
            <ErrorBoundary section="TechOOPPricing"><TechOOPPricing /></ErrorBoundary>
          </FeatureRoute>
        </RoleRoute>
      } />
      <Route path="tech/tools/demo-sheet" element={
        <ErrorBoundary section="TechDemoSheet"><TechDemoSheet /></ErrorBoundary>
      } />
      {!IS_NATIVE && (
        <Route path="tech/admin/*" element={<ErrorBoundary section="AdminMobile"><AdminMobileRoutes /></ErrorBoundary>} />
      )}
    </Route>
  );
}

// Native build: /login + /tech/* only. Everything else → /tech.
function NativeRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* SAFE-02: these sit OUTSIDE TechRoutes, so none of them was inside
            `.tech-layout` — the only element applying a top inset. On a Dynamic
            Island device the signing header collided with the Island. The shell
            is the public half's single inset owner and picks the status-icon
            colour from the chrome behind it: login and signing are dark, the
            password and legal pages are light. */}
        <Route path="/login" element={<PublicNativeShell surface="dark"><Login /></PublicNativeShell>} />
        <Route path="/sign/:token" element={<PublicNativeShell surface="dark"><SignPage /></PublicNativeShell>} />
        {/* Short form. /sign/:token remains for links already sent live. */}
        <Route path="/s/:code" element={<PublicNativeShell surface="dark"><SignPage /></PublicNativeShell>} />
        <Route path="/set-password" element={<PublicNativeShell surface="light"><SetPassword /></PublicNativeShell>} />
        <Route path="/privacy" element={<PublicNativeShell surface="light"><PrivacyPolicy /></PublicNativeShell>} />
        <Route path="/terms" element={<PublicNativeShell surface="light"><TermsOfService /></PublicNativeShell>} />
        <Route path="/support" element={<PublicNativeShell surface="light"><Support /></PublicNativeShell>} />
        {TechRoutes()}
        <Route path="/" element={<Navigate to="/tech" replace />} />
        <Route path="*" element={<Navigate to="/tech" replace />} />
      </Routes>
      <NativeUpdateHealthGate />
    </Suspense>
  );
}

// Web build: full app — tech routes + admin/settings/devtools under Layout.
function WebRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/sign/:token" element={<SignPage />} />
      {/* Short form. /sign/:token remains for links already sent live. */}
      <Route path="/s/:code" element={<SignPage />} />
      <Route path="/set-password" element={<SetPassword />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
      <Route path="/support" element={<Support />} />
      {/* Public CRM build-status page — mirrors /crm/roadmap for a logged-out
          visitor via the anon-granted get_crm_build_progress RPC. The ONLY
          public CRM surface; every other /crm/* route stays behind page:crm. */}
      <Route path="/status" element={<ErrorBoundary section="Status"><Status /></ErrorBoundary>} />
      {/* Public, read-only roadmap at the short /roadmap URL (utahpros.app/roadmap)
          — no login, not tied to the DB (content is a hand-kept file in
          @/lib/roadmapData). Also linked from the side menu. The old
          /roadmap/public path redirects here so earlier links keep working. */}
      <Route path="/roadmap" element={<ErrorBoundary section="Roadmap"><PublicRoadmap /></ErrorBoundary>} />
      <Route path="/roadmap/public" element={<Navigate to="/roadmap" replace />} />


      {/* Tech layout — field_tech role, no sidebar */}
      {TechRoutes()}

      {/* Protected — all wrapped in Layout */}
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<HomeRedirect />} />
        {/* Bell message notifications point here; techs belong in the field inbox. */}
        <Route path="conversations" element={
          <TechShellRedirect>
            <ErrorBoundary section="Conversations"><Conversations /></ErrorBoundary>
          </TechShellRedirect>
        } />

        <Route path="claims">
          <Route index element={<ErrorBoundary section="Claims"><ClaimsList /></ErrorBoundary>} />
          <Route path=":claimId" element={
            <TechShellRedirect>
              <ErrorBoundary section="Claim"><ClaimPage /></ErrorBoundary>
            </TechShellRedirect>
          } />
        </Route>

        <Route path="jobs">
          <Route index element={<ErrorBoundary section="Jobs"><Jobs /></ErrorBoundary>} />
          <Route path="new" element={<Navigate to="/jobs" replace />} />
          <Route path="closed" element={<ErrorBoundary section="Jobs Closed"><JobsClosed /></ErrorBoundary>} />
          {/* Job notifications point here. jobHref() (not a hardcoded path) so this
              follows the Job Hub flag when it opens, per the tech-v2 manifest. */}
          <Route path=":jobId" element={
            <TechShellRedirect>
              <ErrorBoundary section="Job"><JobPage /></ErrorBoundary>
            </TechShellRedirect>
          } />
        </Route>

        <Route path="production" element={<ErrorBoundary section="Production"><Production /></ErrorBoundary>} />

        {/* Property Meld restoration melds — owner-only preview (no nav link yet) */}
        <Route path="melds" element={
          <MoroniRoute><ErrorBoundary section="Melds"><Melds /></ErrorBoundary></MoroniRoute>
        } />

        {/* Homebuilding Entry Analysis — private to Moroni (side-nav link is Moroni-only too) */}
        <Route path="homebuilding" element={
          <MoroniRoute><ErrorBoundary section="Homebuilding Analysis"><HomebuildingAnalysis /></ErrorBoundary></MoroniRoute>
        } />
        <Route path="homebuilding/build" element={
          <MoroniRoute><ErrorBoundary section="New Build Simulator"><NewBuildSimulator /></ErrorBoundary></MoroniRoute>
        } />
        <Route path="customers" element={<ErrorBoundary section="Customers"><Customers /></ErrorBoundary>} />
        <Route path="customers/:contactId" element={<ErrorBoundary section="Customer"><CustomerPage /></ErrorBoundary>} />
        {/* No notification links here today, but a tech who reaches the office
            schedule any other way (a shared link, a stale bookmark) belongs in the
            field schedule, which is the screen built for a phone. */}
        <Route path="schedule" element={
          <TechShellRedirect>
            <ErrorBoundary section="Schedule"><Schedule /></ErrorBoundary>
          </TechShellRedirect>
        } />
        {/* The office appointment destination. Until this existed, /tech/appointment/:id
            was the ONLY appointment screen in the app, so notify.js pointed every
            appointment notification at it and desktop users clicking the bell landed in
            the mobile tech UI. ClaimPage already linked here and simply 404'd.
            Renders the same Schedule board, which opens the appointment's edit modal
            from the URL. TechShellRedirect still sends field techs to /tech/appointment/:id. */}
        <Route path="schedule/appointment/:apptId" element={
          <TechShellRedirect>
            <ErrorBoundary section="Schedule"><Schedule /></ErrorBoundary>
          </TechShellRedirect>
        } />
        <Route path="schedule/templates" element={<ErrorBoundary section="Schedule Templates"><ScheduleTemplates /></ErrorBoundary>} />
        <Route path="invoices/:invoiceId" element={<ErrorBoundary section="Invoice"><InvoiceEditor /></ErrorBoundary>} />

        {/* Feature-flagged pages — Sidebar hides the link AND direct URL redirects to / */}
        <Route path="leads" element={
          <FeatureRoute flag="page:leads">
            <ErrorBoundary section="Leads"><Leads /></ErrorBoundary>
          </FeatureRoute>
        } />
        <Route path="time-tracking" element={
          <FeatureRoute flag="page:time_tracking">
            <ErrorBoundary section="Time Tracking"><TimeTracking /></ErrorBoundary>
          </FeatureRoute>
        } />
        <Route path="collections" element={
          <FeatureRoute flag="page:collections">
            <ErrorBoundary section="Collections"><Collections /></ErrorBoundary>
          </FeatureRoute>
        } />
        <Route path="collections/receive-payment" element={
          <AdminRoute><FeatureRoute flag="feature:qbo_receive_payment"><ErrorBoundary section="Receive payment"><ReceivePayment /></ErrorBoundary></FeatureRoute></AdminRoute>
        } />
        <Route path="collections/:claimId" element={
          <FeatureRoute flag="page:collections">
            <ErrorBoundary section="ClaimCollection"><ClaimCollectionPage /></ErrorBoundary>
          </FeatureRoute>
        } />
        {/* Estimates list now lives as a tab in Collections ("My Money") — redirect the
            standalone route there. The editor /estimates/:id below is unchanged. */}
        <Route path="estimates" element={<Navigate to="/collections?tab=estimates" replace />} />
        <Route path="estimates/:estimateId" element={
          <FeatureRoute flag="page:estimates">
            <ErrorBoundary section="Estimate"><EstimateEditor /></ErrorBoundary>
          </FeatureRoute>
        } />
        <Route path="marketing" element={
          <FeatureRoute flag="page:marketing">
            <ErrorBoundary section="Marketing"><Marketing /></ErrorBoundary>
          </FeatureRoute>
        } />
        <Route path="import/encircle" element={
          <RoleRoute roles={['admin', 'office', 'project_manager']}>
            <ErrorBoundary section="Encircle Import"><EncircleImport /></ErrorBoundary>
          </RoleRoute>
        } />

        {/* Send Feedback (desktop) — deliberately ungated: every logged-in
            employee may report a bug / suggest an improvement.
            Feedback Media Phase F (docs/feedback-media-roadmap.md). */}
        <Route path="feedback" element={
          <ErrorBoundary section="Feedback"><Feedback /></ErrorBoundary>
        } />

        {/* What's New — the record of everything built, fixed and improved.
            Deliberately ungated like /feedback and /help: every logged-in
            employee should be able to see what shipped. Reads no database at
            all; the content is bundled (hand-written highlights in
            src/data/changelog/ plus src/data/changelog-activity.json, which is
            generated from the project history by npm run generate:changelog). */}
        <Route path="whats-new" element={
          <ErrorBoundary section="What's New"><WhatsNew /></ErrorBoundary>
        } />

        {/* CRM (docs/crm-roadmap.md) — invisible to everyone but Moroni until each
            phase is ready for wider rollout (page:crm dev_only_user_id flag). */}
        <Route path="crm" element={
          <FeatureRoute flag="page:crm">
            <ErrorBoundary section="CRM"><CrmLayout /></ErrorBoundary>
          </FeatureRoute>
        }>
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="roadmap" element={<CrmRoadmap />} />
          <Route path="overview" element={<CrmOverview />} />
          <Route path="leads" element={<CrmLeads />} />
          <Route path="contacts" element={<CrmContacts />} />
          <Route path="conversations" element={<CrmConversations />} />
          <Route path="call-log" element={<CrmCallLog />} />
          <Route path="tasks" element={<CrmTasks />} />
          <Route path="sequences" element={<CrmSequences />} />
          <Route path="automations" element={<CrmAutomations />} />
          <Route path="forms" element={<CrmForms />} />
          <Route path="attribution" element={<CrmAttribution />} />
          <Route path="reports" element={<CrmReports />} />
          <Route path="campaigns" element={<CrmCampaigns />} />
          <Route path="integrations" element={<CrmIntegrations />} />
          <Route path="settings" element={<CrmSettings />} />
        </Route>

        {/* Tools */}
        <Route path="tools/oop-pricing" element={
          <RoleRoute roles={OOP_PRICING_ROLES}>
            <FeatureRoute flag="tool:oop_pricing">
              <ErrorBoundary section="OOP Pricing"><OOPPricing /></ErrorBoundary>
            </FeatureRoute>
          </RoleRoute>
        } />

        {/* Help — unwrapped from the settings hub shell (it's a knowledge surface,
            not a settings page). Renders directly inside the main Layout. */}
        <Route path="help" element={<ErrorBoundary section="Help"><Help /></ErrorBoundary>} />

        {/* Settings hub — grouped left rail on desktop (≥1024px); on mobile/iPad
            SettingsLayout hides the rail and /settings is the tappable index
            (SettingsHome). Settings Overhaul Phase F: Settings.jsx + Admin.jsx
            dissolved into the routed sub-pages below. GC gates per the roadmap. */}
        <Route element={<SettingsLayout />}>
          {/* Index — GC3 any-visible-child gate. */}
          <Route path="settings" element={<SettingsIndexRoute><ErrorBoundary section="Settings"><SettingsHome /></ErrorBoundary></SettingsIndexRoute>} />

          {/* Workspace + pricing: Lists, Templates, and Commissions gate on
              canAccess('settings'); Scope Sheets uses demo_sheet_builder; Payments self-guards
              with canEditBilling; OOP Pricing is admin-only and excluded from native. */}
          <Route path="settings/lists" element={<AccessRoute navKey="settings"><ErrorBoundary section="Lists & Values"><ListsAndValues /></ErrorBoundary></AccessRoute>} />
          <Route path="settings/templates" element={<AccessRoute navKey="settings"><ErrorBoundary section="Templates"><Templates /></ErrorBoundary></AccessRoute>} />
          <Route path="settings/templates/:docType" element={<AccessRoute navKey="settings"><ErrorBoundary section="Templates Editor"><TemplatesEditor /></ErrorBoundary></AccessRoute>} />
          <Route path="settings/commissions" element={<AccessRoute navKey="settings"><ErrorBoundary section="Commissions"><Commissions /></ErrorBoundary></AccessRoute>} />
          <Route path="settings/payments" element={<ErrorBoundary section="Payment Settings"><PaymentSettings /></ErrorBoundary>} />
          <Route path="settings/scope-sheets" element={<AccessRoute navKey="demo_sheet_builder"><ErrorBoundary section="Scope Sheets"><AdminDemoSheetBuilder /></ErrorBoundary></AccessRoute>} />
          {!IS_NATIVE && (
            <Route path="settings/oop-pricing" element={<AdminRoute><ErrorBoundary section="OOP Pricing Settings"><OopPricingSettings /></ErrorBoundary></AdminRoute>} />
          )}

          {/* Team & access — all AdminRoute (unchanged effective access). */}
          <Route path="settings/team" element={<AdminRoute><ErrorBoundary section="Team"><Team /></ErrorBoundary></AdminRoute>} />
          <Route path="settings/roles" element={<AdminRoute><ErrorBoundary section="Roles"><Roles /></ErrorBoundary></AdminRoute>} />
          <Route path="settings/page-access" element={<AdminRoute><ErrorBoundary section="Page Access"><PageAccess /></ErrorBoundary></AdminRoute>} />
          <Route path="settings/notification-defaults" element={<AdminRoute><ErrorBoundary section="Notification Defaults"><NotificationDefaults /></ErrorBoundary></AdminRoute>} />
          {!IS_NATIVE && (
            <Route path="settings/notification-presentation" element={<AdminRoute><ErrorBoundary section="Notification Presentation"><NotificationPresentation /></ErrorBoundary></AdminRoute>} />
          )}
          <Route path="settings/feedback" element={<AdminRoute><ErrorBoundary section="Feedback Inbox"><AdminFeedback /></ErrorBoundary></AdminRoute>} />

          {/* Connections. */}
          <Route path="settings/integrations" element={<AdminRoute><ErrorBoundary section="Integrations"><AdminIntegrations /></ErrorBoundary></AdminRoute>} />

          {/* Personal — GC8 (owner-approved): visible to every employee, no route gate. */}
          <Route path="settings/my-account" element={<ErrorBoundary section="My Account"><MyAccount /></ErrorBoundary>} />
          <Route path="settings/notifications" element={<ErrorBoundary section="Notifications"><NotificationsSettings /></ErrorBoundary>} />

          {/* Owner — Dev Tools (Moroni only, not role-based). */}
          <Route path="dev-tools" element={<DevRoute><ErrorBoundary section="DevTools"><DevTools /></ErrorBoundary></DevRoute>} />
        </Route>

        {/* Permanent redirects — retired routes → new settings IA. Mounted OUTSIDE
            SettingsLayout so they don't flash the hub shell. notifications.link
            rows already store /tech-feedback, so these stay permanent
            (src/lib/settingsRedirects.js). */}
        {SETTINGS_REDIRECTS.map(r => (
          <Route key={r.from} path={r.from} element={<Navigate to={r.to} replace />} />
        ))}
        {/* Carriers/Referrals collapsed into Lists & Values (Settings Overhaul
            P10) — kept as inline routes rather than in settingsRedirects.js,
            which the P10/wave manifest freezes to Foundation. */}
        <Route path="settings/carriers" element={<Navigate to="/settings/lists" replace />} />
        <Route path="settings/referrals" element={<Navigate to="/settings/lists" replace />} />
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

// Route persistence is account-owned. Mount only after Auth has published the
// employee and the immutable opaque owner lease from completed cleanup.
function AuthenticatedRouteRestorer() {
  const { employee, pwaOwnerLease } = useAuth();
  if (!employee || !pwaOwnerLease) return null;
  return (
    <RouteRestorer
      key={pwaOwnerLease.epoch}
      authVerified
      ownerLease={pwaOwnerLease}
    />
  );
}

// Null-render tracker: keeps html[data-nav] in sync with the router so the
// directional page-push View Transition (index.css) knows forward vs Back.
function NavDirectionTracker() {
  useNavDirection();
  return null;
}

// Toggles root-level classes for owner-gated UI previews so their CSS (index.css)
// activates ONLY when the feature flag is on — instantly reversible in
// DevTools → Flags, no deploy. Renders nothing. Must live inside <AuthProvider>.
function UiFlagClasses() {
  const { isFeatureEnabled } = useAuth();
  const pageTransitions = isFeatureEnabled('feature:page_transitions');
  const liquidGlass = isFeatureEnabled('feature:liquid_glass');
  useEffect(() => {
    document.documentElement.classList.toggle('ui-vt', !!pageTransitions);
  }, [pageTransitions]);
  useEffect(() => {
    document.documentElement.classList.toggle('ui-glass', !!liquidGlass);
  }, [liquidGlass]);
  return null;
}

export default function App() {
  useEffect(() => {
    // Shell status bar is driven by ThemeProvider (light vs dark); individual
    // gradient-hero screens still override it on mount/unmount.
    // Clear the native splash once the React tree has mounted
    hideSplash();
  }, []);
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter>
          {/* Sets html[data-nav]=forward|back each navigation so the directional
              View-Transition page push (index.css) reverses on Back. Renders nothing. */}
          <NavDirectionTracker />
          <AuthProvider>
            {/* Home-screen-PWA eviction recovery is account-owned and remains
                inert until Auth publishes a verified opaque owner lease. */}
            <AuthenticatedRouteRestorer />
            {/* Restorer runs first; an accepted cold/warm native intent then
                wins as the newest route after account readiness. */}
            <NativeNavigationBridge enabled={IS_NATIVE} />
            {/* Owner-gated preview classes (page transitions / liquid glass) —
                reads feature flags, so must be inside AuthProvider. */}
            <UiFlagClasses />
            {IS_NATIVE ? <NativeRoutes /> : <WebRoutes />}
          </AuthProvider>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}
