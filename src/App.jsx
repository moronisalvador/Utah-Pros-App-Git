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
import WorkAuthDemo from '@/pages/WorkAuthDemo';

// Admin-only route guard — belt-and-suspenders on top of Admin.jsx's own check
function AdminRoute({ children }) {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/" replace />;
  if (employee.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

// Simple 404 page
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
          <Route path="/work-auth" element={<WorkAuthDemo />} />

          {/* Protected — all wrapped in Layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<ErrorBoundary section="Dashboard"><Dashboard /></ErrorBoundary>} />
            <Route path="conversations" element={<ErrorBoundary section="Conversations"><Conversations /></ErrorBoundary>} />

            <Route path="jobs">
              <Route index element={<ErrorBoundary section="Jobs"><Jobs /></ErrorBoundary>} />
              <Route path="new" element={<Navigate to="/jobs" replace />} />
              <Route path=":jobId" element={<ErrorBoundary section="Job"><JobPage /></ErrorBoundary>} />
            </Route>

            <Route path="production" element={<ErrorBoundary section="Production"><Production /></ErrorBoundary>} />
            <Route path="leads" element={<ErrorBoundary section="Leads"><Leads /></ErrorBoundary>} />
            <Route path="customers" element={<ErrorBoundary section="Customers"><Customers /></ErrorBoundary>} />
            <Route path="customers/:contactId" element={<ErrorBoundary section="Customer"><CustomerPage /></ErrorBoundary>} />
            <Route path="schedule" element={<ErrorBoundary section="Schedule"><Schedule /></ErrorBoundary>} />
            <Route path="schedule/templates" element={<ErrorBoundary section="Schedule Templates"><ScheduleTemplates /></ErrorBoundary>} />
            <Route path="time-tracking" element={<ErrorBoundary section="Time Tracking"><TimeTracking /></ErrorBoundary>} />
            <Route path="marketing" element={<ErrorBoundary section="Marketing"><Marketing /></ErrorBoundary>} />
            <Route path="admin" element={<AdminRoute><ErrorBoundary section="Admin"><Admin /></ErrorBoundary></AdminRoute>} />
            <Route path="settings" element={<ErrorBoundary section="Settings"><Settings /></ErrorBoundary>} />
          </Route>

          {/* 404 — explicit not-found page instead of silent redirect */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
