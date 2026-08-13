/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateEditor.jsx  (Admin Mobile — estimate create compatibility)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES: Keeps the established customer-first estimate creation route.
 * Once a draft exists it opens the shared financial-document detail page; the
 * legacy /edit route redirects there so there is only one line editing model.
 * ════════════════════════════════════════════════
 */
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import EstimateCreateForm from '@/components/admin-mobile/estimate/EstimateCreateForm';
import { adminEstimateHref } from '@/components/admin-mobile/href';

export default function AdminEstimateEditor() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const { db, employee, isFeatureEnabled } = useAuth();
  const billingEnabled = isFeatureEnabled('feature:billing');
  if (!billingEnabled) return <AdminMobilePage title="New estimate" back={() => navigate(-1)}><div className="am-stub">Billing is turned off (feature flag <code>feature:billing</code>).</div></AdminMobilePage>;
  if (estimateId) return <Navigate to={adminEstimateHref(estimateId)} replace />;
  return <AdminMobilePage title="New estimate" back={() => navigate(-1)}><EstimateCreateForm db={db} employee={employee} onCreated={(row) => navigate(adminEstimateHref(row.id), { replace: true })} onOpenExisting={(id) => navigate(adminEstimateHref(id))} /></AdminMobilePage>;
}
