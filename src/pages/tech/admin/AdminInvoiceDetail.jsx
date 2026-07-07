/**
 * ════════════════════════════════════════════════
 * FILE: AdminInvoiceDetail.jsx  (Admin Mobile — Invoice detail STUB)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The single-invoice screen inside the field-tech app — view it, send it, and
 *   record a payment already received. Right now it's an empty placeholder that
 *   just shows which invoice was opened. Phase P3 fills in the real view + send +
 *   record-payment flow (the money path — finding F-1).
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/invoice/:invoiceId  (inside AdminMobileRoutes)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom (useParams, useNavigate)
 *   Internal:  @/components/admin-mobile (AdminMobilePage)
 *   Data:      reads → none yet · writes → none yet (P3 wires payments + qbo-*)
 *
 * NOTES / GOTCHAS:
 *   - STUB: no feature logic. P3 owns this file next. The record-payment insert
 *     must write ONLY the safe column set and NEVER the trigger-owned columns
 *     (amount_paid/status/paid_at) — finding F-1, tested.
 * ════════════════════════════════════════════════
 */
import { useParams, useNavigate } from 'react-router-dom';
import { AdminMobilePage } from '@/components/admin-mobile';

export default function AdminInvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  return (
    <AdminMobilePage title="Invoice" subtitle={invoiceId} back={() => navigate(-1)}>
      <div className="am-stub">Invoice detail coming soon.</div>
    </AdminMobilePage>
  );
}
