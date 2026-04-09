import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';
import ErrorBoundary from '@/components/ErrorBoundary';

// Pages
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Conversations from '@/pages/Conversations';
import Jobs from '@/pages/Jobs';
import JobPage from '@/pages/JobPage';
import ClaimsList from '@/pages/ClaimsList';
import ClaimPage from '@/pages/ClaimPage';
import Production from '@/pages/Production';
import Leads from '@/pages/Leads';
import Customers from '@/pages/Customers';
import CustomerPage from '@/pages/CustomerPage';
import Schedule from '@/pages/Schedule';
import ScheduleTemplates from '@/pages/ScheduleTemplates';
import TimeTracking from '@/pages/TimeTracking';
import Marketing from '@/pages/Marketing';
import Admin from '@/pages/Admin';
import Settings from '@/pages/Settings';
import SignPage from '@/pages/SignPage';
import SetPassword from '@/pages/SetPassword';
import Collections from '@/pages/Collections';
import DevTools from '@/pages/DevTools';
import WorkAuthSigning from '@/pages/WorkAuthSigning';
import EncircleImport from '@/pages/EncircleImport';

// Tech pages (field_tech role)
import TechLayout from '@/components/TechLayout';
import TechDash from '@/pages/tech/TechDash';
import TechSchedule from '@/pages/tech/TechSchedule';
import TechTasks from '@/pages/tech/TechTasks';
import TechClaims from '@/pages/tech/TechClaims';
import TechAppointment from '@/pages/tech/TechAppointment';
import TechNewCustomer from '@/pages/tech/TechNewCustomer';
import TechNewJob from '@/pages/tech/TechNewJob';
import TechNewAppointment from '@/pages/tech/TechNewAppointment';

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

// Redirect field_tech users from / to /tech
function HomeRedirect() {
  const { employee } = useAuth();
  if (employee?.role === 'field_tech') return <Navigate to="/tech" replace />;
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/sign/:token" element={<SignPage />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/work-auth" element={<WorkAuthSigning />} />

          {/* Tech layout — field_tech role, no sidebar */}
          <Route element={<ProtectedRoute><TechLayout /></ProtectedRoute>}>
            <Route path="tech" element={<ErrorBoundary section="TechDash"><TechDash /></ErrorBoundary>} />
            <Route path="tech/schedule" element={<ErrorBoundary section="TechSchedule"><TechSchedule /></ErrorBoundary>} />
            <Route path="tech/tasks" element={<ErrorBoundary section="TechTasks"><TechTasks /></ErrorBoundary>} />
            <Route path="tech/claims" element={<ErrorBoundary section="TechClaims"><TechClaims /></ErrorBoundary>} />
            <Route path="tech/claims/:claimId" element={<ErrorBoundary section="Claim"><ClaimPage /></ErrorBoundary>} />
            <Route path="tech/appointment/:id" element={<ErrorBoundary section="TechAppointment"><TechAppointment /></ErrorBoundary>} />
            <Route path="tech/new-customer" element={<ErrorBoundary section="TechNewCustomer"><TechNewCustomer /></ErrorBoundary>} />
            <Route path="tech/new-job" element={<ErrorBoundary section="TechNewJob"><TechNewJob /></ErrorBoundary>} />
            <Route path="tech/new-appointment" element={<ErrorBoundary section="TechNewAppointment"><TechNewAppointment /></ErrorBoundary>} />
            <Route path="tech/conversations" element={<ErrorBoundary section="Conversations"><Conversations /></ErrorBoundary>} />
          </Route>

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
            <Route path="customers" element={<ErrorBoundary section="Customers"><Customers /></ErrorBoundary>} />
            <Route path="customers/:contactId" element={<ErrorBoundary section="Customer"><CustomerPage /></ErrorBoundary>} />
            <Route path="schedule" element={<ErrorBoundary section="Schedule"><Schedule /></ErrorBoundary>} />
            <Route path="schedule/templates" element={<ErrorBoundary section="Schedule Templates"><ScheduleTemplates /></ErrorBoundary>} />

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
            <Route path="marketing" element={
              <FeatureRoute flag="page:marketing">
                <ErrorBoundary section="Marketing"><Marketing /></ErrorBoundary>
              </FeatureRoute>
            } />
            <Route path="import/encircle" element={
              <FeatureRoute flag="page:encircle_import">
                <ErrorBoundary section="Encircle Import"><EncircleImport /></ErrorBoundary>
              </FeatureRoute>
            } />

            {/* Admin-only */}
            <Route path="admin" element={<AdminRoute><ErrorBoundary section="Admin"><Admin /></ErrorBoundary></AdminRoute>} />
            <Route path="settings" element={<ErrorBoundary section="Settings"><Settings /></ErrorBoundary>} />

            {/* Dev Tools — Moroni only, not role-based */}
            <Route path="dev-tools" element={
              <DevRoute><ErrorBoundary section="DevTools"><DevTools /></ErrorBoundary></DevRoute>
            } />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
