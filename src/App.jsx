import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

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
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:jobId" element={<JobPage />} />
            <Route path="production" element={<Production />} />
            <Route path="leads" element={<Leads />} />
            <Route path="customers/:contactId" element={<CustomerPage />} />
            <Route path="customers" element={<Customers />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="schedule/templates" element={<ScheduleTemplates />} />
            <Route path="time-tracking" element={<TimeTracking />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="admin" element={<Admin />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          {/* Public — no auth */}
          <Route path="/sign/:token" element={<SignPage />} />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
