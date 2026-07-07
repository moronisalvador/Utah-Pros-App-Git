/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateDetail.jsx  (Admin Mobile — Estimate detail STUB)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single-estimate screen inside the field-tech app — view it, send it, and
 *   convert it to an invoice. Right now it's an empty placeholder that shows which
 *   estimate was opened. Phase P4a fills in the real view + send + convert flow.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/:estimateId  (inside AdminMobileRoutes)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useParams, useNavigate)
 *   Internal:  @/components/admin-mobile (AdminMobilePage)
 *   Data:      reads → none yet · writes → none yet (P4a wires /api/qbo-estimate)
 *
 * NOTES / GOTCHAS:
 *   - STUB: no feature logic. P4a owns this file next; the QBO workers and
 *     convert_estimate_to_invoice are call-only (never edited).
 * ════════════════════════════════════════════════
 */
import { useParams, useNavigate } from 'react-router-dom';
import { AdminMobilePage } from '@/components/admin-mobile';

export default function AdminEstimateDetail() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  return (
    <AdminMobilePage title="Estimate" subtitle={estimateId} back={() => navigate(-1)}>
      <div className="am-stub">Estimate detail coming soon.</div>
    </AdminMobilePage>
  );
}
