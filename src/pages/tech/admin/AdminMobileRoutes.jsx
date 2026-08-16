/**
 * ════════════════════════════════════════════════
 * FILE: AdminMobileRoutes.jsx  (Admin Mobile — subrouter)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little map of web addresses for every admin screen inside the field-tech
 *   app. The main app hands off anything starting with /tech/admin/ to this file,
 *   which then decides which admin screen to show. Everything here is behind the
 *   doorman (admins only, and only when the "Admin Mobile" switch is on), so a
 *   field tech or a switched-off admin is bounced back to the tech home.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/*  (mounted by the one delegating line in App.jsx)
 *   Rendered by:  src/App.jsx (TechRoutes → the tech/admin/* delegating route)
 *
 * DEPENDS ON:
 *   Packages:  react (lazy/Suspense), react-router-dom (Routes/Route/Navigate)
 *   Internal:  @/components/admin-mobile (AdminMobileRoute), @/components/TabLoading,
 *              the stub pages in this folder
 *   Data:      reads → none · writes → none (routing only)
 *
 * NOTES / GOTCHAS:
 *   - FROZEN for the wave: Foundation owns the route wiring. A wave session fills
 *     its stub page; it does NOT re-wire routes here. The route strings are the
 *     frozen contract mirrored by @/components/admin-mobile/href.js — keep them in
 *     sync if either changes.
 *   - Paths are RELATIVE to the /tech/admin mount point (e.g. "dash", not
 *     "/tech/admin/dash"). The whole subtree is wrapped once in AdminMobileRoute.
 *   - Pages are lazy so each screen is its own chunk once wave phases flesh them
 *     out; the nested Suspense keeps a fallback local to the admin surface.
 * ════════════════════════════════════════════════
 */
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AdminMobileRoute from '@/components/admin-mobile/AdminMobileRoute';
import TabLoading from '@/components/TabLoading';

const AdminDash = lazy(() => import('./AdminDash'));
const AdminCollections = lazy(() => import('./AdminCollections'));
const AdminInvoiceDetail = lazy(() => import('./AdminInvoiceDetail'));
const AdminInvoiceCreate = lazy(() => import('./AdminInvoiceCreate'));
const AdminInvoiceLineEdit = lazy(() => import('./AdminInvoiceLineEdit'));
const AdminInvoicePay = lazy(() => import('./AdminInvoicePay'));
const AdminEstimateDetail = lazy(() => import('./AdminEstimateDetail'));
const AdminEstimateEditor = lazy(() => import('./AdminEstimateEditor'));
const AdminEstimateLineEdit = lazy(() => import('./AdminEstimateLineEdit'));
const AdminLeadCenter = lazy(() => import('./AdminLeadCenter'));
const AdminLeadDetail = lazy(() => import('./AdminLeadDetail'));

function BillingRoute({ children }) {
  const { isFeatureEnabled } = useAuth();
  return isFeatureEnabled('feature:billing')
    ? children
    : <Navigate to="/tech" replace />;
}

function DocumentCommandRoute({ children }) {
  const { isStrictFeatureEnabled } = useAuth();
  return isStrictFeatureEnabled('feature:qbo_document_command_v2')
    ? children
    : <Navigate to="/tech/admin/collections" replace />;
}

export default function AdminMobileRoutes() {
  return (
    <AdminMobileRoute>
      <Suspense fallback={<TabLoading />}>
        <Routes>
          <Route index element={<AdminDash />} />
          <Route path="dash" element={<AdminDash />} />
          <Route path="collections" element={<AdminCollections />} />
          <Route path="invoice/new" element={<BillingRoute><AdminInvoiceCreate /></BillingRoute>} />
          <Route path="invoice/:invoiceId/line/:lineId" element={<BillingRoute><DocumentCommandRoute><AdminInvoiceLineEdit /></DocumentCommandRoute></BillingRoute>} />
          <Route path="invoice/:invoiceId/pay" element={<BillingRoute><AdminInvoicePay /></BillingRoute>} />
          <Route path="invoice/:invoiceId" element={<BillingRoute><AdminInvoiceDetail /></BillingRoute>} />
          <Route path="estimate/new" element={<BillingRoute><AdminEstimateEditor /></BillingRoute>} />
          <Route path="estimate/:estimateId/line/:lineId" element={<BillingRoute><DocumentCommandRoute><AdminEstimateLineEdit /></DocumentCommandRoute></BillingRoute>} />
          <Route path="estimate/:estimateId/edit" element={<BillingRoute><AdminEstimateEditor /></BillingRoute>} />
          <Route path="estimate/:estimateId" element={<BillingRoute><AdminEstimateDetail /></BillingRoute>} />
          <Route path="leads" element={<AdminLeadCenter />} />
          <Route path="leads/:leadId" element={<AdminLeadDetail />} />
          {/* Unknown admin path → back to the admin dashboard. */}
          <Route path="*" element={<Navigate to="/tech/admin/dash" replace />} />
        </Routes>
      </Suspense>
    </AdminMobileRoute>
  );
}
