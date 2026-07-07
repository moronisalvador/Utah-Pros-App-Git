/**
 * ════════════════════════════════════════════════
 * FILE: AdminEstimateEditor.jsx  (Admin Mobile — Estimate builder STUB)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The estimate builder inside the field-tech app — create a new estimate and
 *   add/edit its line items. Right now it's an empty placeholder that shows
 *   whether you opened it to create a new estimate or edit an existing one. Phase
 *   P4b (deferrable) fills in the real create + line-item builder.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/estimate/new  and  /tech/admin/estimate/:estimateId/edit
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useParams, useNavigate)
 *   Internal:  @/components/admin-mobile (AdminMobilePage)
 *   Data:      reads → none yet · writes → none yet (P4b wires create + line items)
 *
 * NOTES / GOTCHAS:
 *   - STUB: no feature logic. P4b owns this file next; estimate_line_items.line_total
 *     is GENERATED — never written.
 * ════════════════════════════════════════════════
 */
import { useParams, useNavigate } from 'react-router-dom';
import { AdminMobilePage } from '@/components/admin-mobile';

export default function AdminEstimateEditor() {
  const { estimateId } = useParams();
  const navigate = useNavigate();
  const mode = estimateId ? `Edit ${estimateId}` : 'New estimate';
  return (
    <AdminMobilePage title="Estimate builder" subtitle={mode} back={() => navigate(-1)}>
      <div className="am-stub">Estimate builder coming soon.</div>
    </AdminMobilePage>
  );
}
