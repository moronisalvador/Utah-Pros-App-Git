import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import Layout from '@/components/Layout';
import ProtectedRoute from '@/components/ProtectedRoute';

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

// Admin-only route guard — belt-and-suspenders on top of Admin.jsx's own check
function AdminRoute({ children }) {
  const { employee } = useAuth();
  if (!employee) return <Navigate to="/" replace />;
  if (employee.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          <Route path="/sign/:token" element={<SignPage />} />

          {/* Protected — all wrapped in Layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="conversations" element={<Conversations />} />

            {/* Nested job routes — prevents /jobs/new from matching :jobId */}
            <Route path="jobs">
              <Route index element={<Jobs />} />
              {/* /jobs/new: redirect to /jobs — CreateJobModal opens via Layout */}
              <Route path="new" element={<Navigate to="/jobs" replace />} />
              <Route path=":jobId" element={<JobPage />} />
            </Route>

            <Route path="production" element={<Production />} />
            <Route path="leads" element={<Leads />} />
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:contactId" element={<CustomerPage />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="schedule/templates" element={<ScheduleTemplates />} />
            <Route path="time-tracking" element={<TimeTracking />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="admin" element={<AdminRoute><Admin /></AdminRoute>} />
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
