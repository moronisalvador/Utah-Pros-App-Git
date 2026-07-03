import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Layout from '@/components/Layout';
import SettingsLayout from '@/components/SettingsLayout';
import ProtectedRoute from '@/components/ProtectedRoute';
import ErrorBoundary from '@/components/ErrorBoundary';
import { statusBarDark, hideSplash } from '@/lib/nativeAppearance';
import {
  checkBiometricAvailable,
  isBiometricEnabled,
  verifyBiometric,
  setBiometricEnabled,
  enablePrivacyScreen,
} from '@/lib/nativeBiometric';
import { realtimeClient } from '@/lib/realtime';
import { shouldReloadForStaleChunk, buildResetUrl } from '@/lib/staleChunkReload';

// Pages — lazy-loaded so each becomes its own chunk. Keeps the initial bundle
// small (esp. the native tech app, which never loads admin/desktop pages).
// Login + the layout shells stay eager (critical path).
import Login from '@/pages/Login';
import TechLayout from '@/components/TechLayout';

// Wrap React.lazy so a failed dynamic import — almost always a STALE CHUNK after a new
// deploy (the hashed file this already-open tab references no longer exists on the server) —
// triggers a single automatic page reload to fetch the current chunk map, instead of dropping
// the user on the "ran into a problem" screen.
//
// The guard is a TIMESTAMP cooldown (shouldReloadForStaleChunk), NOT a boolean flag. The old
// flag-based guard cleared itself on every successful chunk load, so a sibling chunk loading
// fine re-armed the reload — and a persistently-missing chunk (e.g. an edge-poisoned /crm
// chunk) looped the page forever. A timestamp can't be cleared by unrelated successes: we
// recover at most once per window, then surface the error to the ErrorBoundary.
//
// Recovery goes through /reset (not a plain reload): /reset is served with
// `Clear-Site-Data: "cache"` (public/_headers), which evicts the browser's HTTP cache of a
// poisoned `immutable` /assets/*.js — the one thing a plain reload (or even DevTools "Clear
// site data") can miss — then returns to the original path. Zero user action, no logout.
const CHUNK_RELOAD_KEY = 'chunkReloadAt';
function lazyRetry(factory) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
      if (shouldReloadForStaleChunk(Date.now(), last)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        window.location.replace(buildResetUrl(window.location.pathname + window.location.search));
        return new Promise(() => {}); // hold render until the redirect takes over
      }
      throw err; // recovered recently and still failing → surface to the ErrorBoundary
    }
  });
}

const Dashboard = lazyRetry(() => import('@/pages/Dashboard'));
const Conversations = lazyRetry(() => import('@/pages/Conversations'));
const Jobs = lazyRetry(() => import('@/pages/Jobs'));
const JobPage = lazyRetry(() => import('@/pages/JobPage'));
const ClaimsList = lazyRetry(() => import('@/pages/ClaimsList'));
const ClaimPage = lazyRetry(() => import('@/pages/ClaimPage'));
const Production = lazyRetry(() => import('@/pages/Production'));
const Leads = lazyRetry(() => import('@/pages/Leads'));
const Customers = lazyRetry(() => import('@/pages/Customers'));
const CustomerPage = lazyRetry(() => import('@/pages/CustomerPage'));
const Schedule = lazyRetry(() => import('@/pages/Schedule'));
const ScheduleTemplates = lazyRetry(() => import('@/pages/ScheduleTemplates'));
const TimeTracking = lazyRetry(() => import('@/pages/TimeTracking'));
const Marketing = lazyRetry(() => import('@/pages/Marketing'));
const Admin = lazyRetry(() => import('@/pages/Admin'));
const Settings = lazyRetry(() => import('@/pages/Settings'));
const SignPage = lazyRetry(() => import('@/pages/SignPage'));
const SetPassword = lazyRetry(() => import('@/pages/SetPassword'));
const Collections = lazyRetry(() => import('@/pages/Collections'));
const ClaimCollectionPage = lazyRetry(() => import('@/pages/ClaimCollectionPage'));
const DevTools = lazyRetry(() => import('@/pages/DevTools'));
const Status = lazyRetry(() => import('@/pages/Status'));
const PublicRoadmap = lazyRetry(() => import('@/pages/PublicRoadmap'));
const PrivacyPolicy = lazyRetry(() => import('@/pages/Legal').then(m => ({ default: m.PrivacyPolicy })));
const TermsOfService = lazyRetry(() => import('@/pages/Legal').then(m => ({ default: m.TermsOfService })));
const AdminFeedback = lazyRetry(() => import('@/pages/AdminFeedback'));
const Feedback = lazyRetry(() => import('@/pages/Feedback'));
const OOPPricing = lazyRetry(() => import('@/pages/OOPPricing'));
const AdminDemoSheetBuilder = lazyRetry(() => import('@/pages/AdminDemoSheetBuilder'));
const AdminIntegrations = lazyRetry(() => import('@/pages/admin/AdminIntegrations'));
const EncircleImport = lazyRetry(() => import('@/pages/EncircleImport'));
const Help = lazyRetry(() => import('@/pages/Help'));
const InvoiceEditor = lazyRetry(() => import('@/pages/InvoiceEditor'));
const EstimateEditor = lazyRetry(() => import('@/pages/EstimateEditor'));
const PaymentSettings = lazyRetry(() => import('@/pages/PaymentSettings'));
const HomebuildingAnalysis = lazyRetry(() => import('@/pages/HomebuildingAnalysis'));
const NewBuildSimulator = lazyRetry(() => import('@/pages/NewBuildSimulator'));
const CrmLayout = lazyRetry(() => import('@/components/CrmLayout'));
const CrmRoadmap = lazyRetry(() => import('@/pages/crm/CrmRoadmap'));
const CrmOverview = lazyRetry(() => import('@/pages/crm/CrmOverview'));
const CrmLeads = lazyRetry(() => import('@/pages/crm/CrmLeads'));
const CrmCallLog = lazyRetry(() => import('@/pages/crm/CrmCallLog'));
const CrmTasks = lazyRetry(() => import('@/pages/crm/CrmTasks'));
const CrmAttribution = lazyRetry(() => import('@/pages/crm/CrmAttribution'));
const CrmReports = lazyRetry(() => import('@/pages/crm/CrmReports'));
const CrmCampaigns = lazyRetry(() => import('@/pages/crm/CrmCampaigns'));
const CrmIntegrations = lazyRetry(() => import('@/pages/crm/CrmIntegrations'));
const CrmSettings = lazyRetry(() => import('@/pages/crm/CrmSettings'));
const CrmContacts = lazyRetry(() => import('@/pages/crm/CrmContacts'));
const CrmConversations = lazyRetry(() => import('@/pages/crm/CrmConversations'));
const CrmSequences = lazyRetry(() => import('@/pages/crm/CrmSequences'));
const CrmAutomations = lazyRetry(() => import('@/pages/crm/CrmAutomations'));
const CrmForms = lazyRetry(() => import('@/pages/crm/CrmForms'));

// Tech pages (field_tech role)
const TechDash = lazyRetry(() => import('@/pages/tech/TechDash'));
const TechSchedule = lazyRetry(() => import('@/pages/tech/TechSchedule'));
const TechTasks = lazyRetry(() => import('@/pages/tech/TechTasks'));
const TechClaims = lazyRetry(() => import('@/pages/tech/TechClaims'));
const TechClaimDetail = lazyRetry(() => import('@/pages/tech/TechClaimDetail'));
const TechClaimAlbum = lazyRetry(() => import('@/pages/tech/TechClaimAlbum'));
const TechRoomDetail = lazyRetry(() => import('@/pages/tech/TechRoomDetail'));
const TechJobDetail = lazyRetry(() => import('@/pages/tech/TechJobDetail'));
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
const TechOOPPricing = lazyRetry(() => import('@/pages/tech/TechOOPPricing'));
const TechDemoSheet = lazyRetry(() => import('@/pages/tech/TechDemoSheet'));

// Native builds (iOS via Capacitor) render only /login + /tech/*.
// Admin surfaces are browser-only — see CAPACITOR-TASK.md Phase 2.
const IS_NATIVE = import.meta.env.VITE_BUILD_TARGET === 'native';

// ── Route guards ──────────────────────────────────────────────────────────────

// Admin-only pages (role check)
function AdminRoute({ children }) {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/" replace />;
  if (employee.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

// Feature-flagged pages — redirects to / when flag is disabled
// No flag row in DB = unrestricted (isFeatureEnabled returns true)
function FeatureRoute({ flag, children }) {
  const { isFeatureEnabled } = useAuth();
  if (!isFeatureEnabled(flag)) return <Navigate to="/" replace />;
  return children;
}

// Dev Tools — hardcoded to Moroni only, not role-based
// Even other admins can't access this via direct URL
function DevRoute({ children }) {
  const { employee } = useAuth();
  if (employee?.email !== 'moroni@utah-pros.com') return <Navigate to="/" replace />;
  return children;
}

// Moroni-only pages (same hardcoded email gate as Dev Tools) — private analysis
// surfaces that even other admins can't reach via direct URL.
function MoroniRoute({ children }) {
  const { employee } = useAuth();
  if (employee?.email !== 'moroni@utah-pros.com') return <Navigate to="/" replace />;
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
  if (employee?.role === 'field_tech') return <Navigate to="/tech" replace />;
  if (employee?.role === 'crm_partner') return <Navigate to="/crm/leads" replace />;
  return <ErrorBoundary section="Dashboard"><Dashboard /></ErrorBoundary>;
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

// Tech Mobile v2 component-level swaps. When the v2 flag is on, the PERSISTENT
// pane in TechLayout renders the screen (kept alive across navigation), so the
// route yields null here; when off, the legacy page renders in the <Outlet/>.
// Flag rows are seeded enabled:false + dev-only, so only the owner sees v2 during
// the wave — every other tech gets the legacy page, byte-identical.
function TechDashSwap() {
  const { isFeatureEnabled } = useAuth();
  if (isFeatureEnabled('page:tech_dash_v2')) return null;
  return <ErrorBoundary section="TechDash"><TechDash /></ErrorBoundary>;
}
function TechScheduleSwap() {
  const { isFeatureEnabled } = useAuth();
  if (isFeatureEnabled('page:tech_sched_v2')) return null;
  return <ErrorBoundary section="TechSchedule"><TechSchedule /></ErrorBoundary>;
}

// Shared tech routes — used by both native and web trees
function TechRoutes() {
  return (
    <Route element={<ProtectedRoute><TechLayout /></ProtectedRoute>}>
      <Route path="tech" element={<TechDashSwap />} />
      <Route path="tech/schedule" element={<TechScheduleSwap />} />
      <Route path="tech/tasks" element={<ErrorBoundary section="TechTasks"><TechTasks /></ErrorBoundary>} />
      <Route path="tech/claims" element={<ErrorBoundary section="TechClaims"><TechClaims /></ErrorBoundary>} />
      <Route path="tech/claims/:claimId" element={<ErrorBoundary section="TechClaimDetail"><TechClaimDetail /></ErrorBoundary>} />
      <Route path="tech/claims/:claimId/photos" element={<ErrorBoundary section="TechClaimAlbum"><TechClaimAlbum /></ErrorBoundary>} />
      <Route path="tech/claims/:claimId/rooms/:roomId" element={<ErrorBoundary section="TechRoomDetail"><TechRoomDetail /></ErrorBoundary>} />
      <Route path="tech/jobs/:jobId" element={<ErrorBoundary section="TechJobDetail"><TechJobDetail /></ErrorBoundary>} />
      <Route path="tech/jobs/:jobId/photos" element={<ErrorBoundary section="TechJobAlbum"><TechJobAlbum /></ErrorBoundary>} />
      <Route path="tech/jobs/:jobId/documents" element={<ErrorBoundary section="TechJobDocuments"><TechJobDocuments /></ErrorBoundary>} />
      <Route path="tech/appointment/:id/edit" element={<ErrorBoundary section="TechEditAppointment"><TechEditAppointment /></ErrorBoundary>} />
      <Route path="tech/appointment/:id" element={<ErrorBoundary section="TechAppointment"><TechAppointment /></ErrorBoundary>} />
      <Route path="tech/new-customer" element={<ErrorBoundary section="TechNewCustomer"><TechNewCustomer /></ErrorBoundary>} />
      <Route path="tech/new-job" element={<ErrorBoundary section="TechNewJob"><TechNewJob /></ErrorBoundary>} />
      <Route path="tech/new-appointment" element={<ErrorBoundary section="TechNewAppointment"><TechNewAppointment /></ErrorBoundary>} />
      <Route path="tech/new-event" element={<ErrorBoundary section="TechNewEvent"><TechNewEvent /></ErrorBoundary>} />
      <Route path="tech/conversations" element={<ErrorBoundary section="Conversations"><Conversations /></ErrorBoundary>} />
      <Route path="tech/feedback" element={<ErrorBoundary section="TechFeedback"><TechFeedback /></ErrorBoundary>} />
      <Route path="tech/more" element={<ErrorBoundary section="TechMore"><TechMore /></ErrorBoundary>} />
      <Route path="tech/help" element={<ErrorBoundary section="TechHelp"><TechHelp /></ErrorBoundary>} />
      <Route path="tech/tools/oop-pricing" element={
        <FeatureRoute flag="tool:oop_pricing">
          <ErrorBoundary section="TechOOPPricing"><TechOOPPricing /></ErrorBoundary>
        </FeatureRoute>
      } />
      <Route path="tech/tools/demo-sheet" element={
        <ErrorBoundary section="TechDemoSheet"><TechDemoSheet /></ErrorBoundary>
      } />
    </Route>
  );
}

// Native build: /login + /tech/* only. Everything else → /tech.
function NativeRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/sign/:token" element={<SignPage />} />
        <Route path="/set-password" element={<SetPassword />} />
        {TechRoutes()}
        <Route path="/" element={<Navigate to="/tech" replace />} />
        <Route path="*" element={<Navigate to="/tech" replace />} />
      </Routes>
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
      <Route path="/set-password" element={<SetPassword />} />
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/terms" element={<TermsOfService />} />
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
        <Route path="conversations" element={<ErrorBoundary section="Conversations"><Conversations /></ErrorBoundary>} />

        <Route path="claims">
          <Route index element={<ErrorBoundary section="Claims"><ClaimsList /></ErrorBoundary>} />
          <Route path=":claimId" element={<ErrorBoundary section="Claim"><ClaimPage /></ErrorBoundary>} />
        </Route>

        <Route path="jobs">
          <Route index element={<ErrorBoundary section="Jobs"><Jobs /></ErrorBoundary>} />
          <Route path="new" element={<Navigate to="/jobs" replace />} />
          <Route path=":jobId" element={<ErrorBoundary section="Job"><JobPage /></ErrorBoundary>} />
        </Route>

        <Route path="production" element={<ErrorBoundary section="Production"><Production /></ErrorBoundary>} />

        {/* Homebuilding Entry Analysis — private to Moroni (side-nav link is Moroni-only too) */}
        <Route path="homebuilding" element={
          <MoroniRoute><ErrorBoundary section="Homebuilding Analysis"><HomebuildingAnalysis /></ErrorBoundary></MoroniRoute>
        } />
        <Route path="homebuilding/build" element={
          <MoroniRoute><ErrorBoundary section="New Build Simulator"><NewBuildSimulator /></ErrorBoundary></MoroniRoute>
        } />
        <Route path="customers" element={<ErrorBoundary section="Customers"><Customers /></ErrorBoundary>} />
        <Route path="customers/:contactId" element={<ErrorBoundary section="Customer"><CustomerPage /></ErrorBoundary>} />
        <Route path="schedule" element={<ErrorBoundary section="Schedule"><Schedule /></ErrorBoundary>} />
        <Route path="schedule/templates" element={<ErrorBoundary section="Schedule Templates"><ScheduleTemplates /></ErrorBoundary>} />
        <Route path="invoices/:invoiceId" element={<ErrorBoundary section="Invoice"><InvoiceEditor /></ErrorBoundary>} />
        <Route path="payments/settings" element={<ErrorBoundary section="Payment Settings"><PaymentSettings /></ErrorBoundary>} />

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
          <ErrorBoundary section="Encircle Import"><EncircleImport /></ErrorBoundary>
        } />

        {/* Send Feedback (desktop) — deliberately ungated: every logged-in
            employee may report a bug / suggest an improvement.
            Feedback Media Phase F (docs/feedback-media-roadmap.md). */}
        <Route path="feedback" element={
          <ErrorBoundary section="Feedback"><Feedback /></ErrorBoundary>
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
          <FeatureRoute flag="tool:oop_pricing">
            <ErrorBoundary section="OOP Pricing"><OOPPricing /></ErrorBoundary>
          </FeatureRoute>
        } />

        {/* Settings hub — system pages share a left sub-nav on desktop (≥1280px);
            on mobile/iPad SettingsLayout is a passthrough so each page renders
            exactly as before. Paths + per-route guards are unchanged. */}
        <Route element={<SettingsLayout />}>
          <Route path="settings" element={<ErrorBoundary section="Settings"><Settings /></ErrorBoundary>} />
          <Route path="help" element={<ErrorBoundary section="Help"><Help /></ErrorBoundary>} />
          <Route path="admin" element={<AdminRoute><ErrorBoundary section="Admin"><Admin /></ErrorBoundary></AdminRoute>} />
          <Route path="admin/demo-sheet-builder" element={<AccessRoute navKey="demo_sheet_builder"><ErrorBoundary section="AdminDemoSheetBuilder"><AdminDemoSheetBuilder /></ErrorBoundary></AccessRoute>} />
          <Route path="admin/integrations" element={<AdminRoute><ErrorBoundary section="AdminIntegrations"><AdminIntegrations /></ErrorBoundary></AdminRoute>} />
          <Route path="tech-feedback" element={<AdminRoute><ErrorBoundary section="AdminFeedback"><AdminFeedback /></ErrorBoundary></AdminRoute>} />
          {/* Dev Tools — Moroni only, not role-based */}
          <Route path="dev-tools" element={<DevRoute><ErrorBoundary section="DevTools"><DevTools /></ErrorBoundary></DevRoute>} />
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

// Cold-launch biometric gate. On native, if the user has a stored session and
// opted into biometric unlock, block UI rendering until Face ID / Touch ID /
// passcode succeeds. On cancel or failure, sign out and fall through to /login.
// Web is passthrough — no gate.
function BiometricGate({ children }) {
  const [gate, setGate] = useState(() => (IS_NATIVE ? 'checking' : 'open'));
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!IS_NATIVE) return;
    let cancelled = false;

    (async () => {
      try {
        const { data } = await realtimeClient.auth.getSession();
        const hasSession = !!data?.session;
        if (!hasSession) { if (!cancelled) setGate('open'); return; }

        const [available, enabled] = await Promise.all([
          checkBiometricAvailable(),
          Promise.resolve(isBiometricEnabled()),
        ]);
        if (!available || !enabled) { if (!cancelled) setGate('open'); return; }

        const ok = await verifyBiometric('Unlock UPR');
        if (cancelled) return;
        if (ok) { setGate('open'); return; }

        // Failed or cancelled — sign out and let the login screen render
        setBiometricEnabled(false);
        await realtimeClient.auth.signOut();
        setGate('open');
      } catch {
        if (!cancelled) setGate('open');
      }
    })();

    return () => { cancelled = true; };
  }, [retry]);

  if (gate === 'checking') {
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: 'var(--bg-primary)', color: 'var(--text-secondary)',
        fontFamily: 'var(--font-sans)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 16,
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, fontWeight: 800, letterSpacing: -1,
        }}>U</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Unlocking UPR…</div>
        <button
          onClick={() => { setGate('checking'); setRetry(r => r + 1); }}
          style={{
            marginTop: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600,
            color: 'var(--accent)', background: 'transparent', border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          Retry Face ID
        </button>
      </div>
    );
  }

  return children;
}

export default function App() {
  useEffect(() => {
    // Default appearance for the app shell — individual screens can override
    statusBarDark();
    // Blur the app snapshot in the app-switcher / on background
    enablePrivacyScreen();
    // Clear the native splash once the React tree has mounted
    hideSplash();
    // notifyAppReady() is already called in src/main.jsx before React mounts —
    // that's the Capgo-recommended placement and earlier = safer rollback behavior
  }, []);
  return (
    <BrowserRouter>
      <BiometricGate>
        <AuthProvider>
          {IS_NATIVE ? <NativeRoutes /> : <WebRoutes />}
        </AuthProvider>
      </BiometricGate>
    </BrowserRouter>
  );
}
