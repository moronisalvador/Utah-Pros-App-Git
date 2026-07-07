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
import AdminMobileRoute from '@/components/admin-mobile/AdminMobileRoute';
import TabLoading from '@/components/TabLoading';

const AdminDash = lazy(() => import('./AdminDash'));
const AdminCollections = lazy(() => import('./AdminCollections'));
const AdminInvoiceDetail = lazy(() => import('./AdminInvoiceDetail'));
const AdminEstimateDetail = lazy(() => import('./AdminEstimateDetail'));
const AdminEstimateEditor = lazy(() => import('./AdminEstimateEditor'));
const AdminLeadCenter = lazy(() => import('./AdminLeadCenter'));

export default function AdminMobileRoutes() {
  return (
    <AdminMobileRoute>
      <Suspense fallback={<TabLoading />}>
        <Routes>
          <Route index element={<AdminDash />} />
          <Route path="dash" element={<AdminDash />} />
          <Route path="collections" element={<AdminCollections />} />
          <Route path="invoice/:invoiceId" element={<AdminInvoiceDetail />} />
          <Route path="estimate/new" element={<AdminEstimateEditor />} />
          <Route path="estimate/:estimateId/edit" element={<AdminEstimateEditor />} />
          <Route path="estimate/:estimateId" element={<AdminEstimateDetail />} />
          <Route path="leads" element={<AdminLeadCenter />} />
          {/* Unknown admin path → back to the admin dashboard. */}
          <Route path="*" element={<Navigate to="/tech/admin/dash" replace />} />
        </Routes>
      </Suspense>
    </AdminMobileRoute>
  );
}
