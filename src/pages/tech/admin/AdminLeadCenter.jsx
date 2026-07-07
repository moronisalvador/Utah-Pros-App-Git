/**
 * ════════════════════════════════════════════════
 * FILE: AdminLeadCenter.jsx  (Admin Mobile — Lead Center STUB)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The lead center inside the field-tech app — the list of inbound leads with
 *   call-recording playback and transcripts. Right now it's an empty placeholder.
 *   Phase P5 fills in the real list + player + transcript view (copied in from the
 *   CRM call-log components, never editing them).
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/leads  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (JSX)
 *   Internal:  @/components/admin-mobile (AdminMobilePage)
 *   Data:      reads → none yet (P5 wires get_inbound_leads) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - STUB: no feature logic. P5 owns this file next; move_lead_to_stage /
 *     get_contact_activity are CRM REPLACEs — call-only, never re-REPLACE.
 * ════════════════════════════════════════════════
 */
import { AdminMobilePage } from '@/components/admin-mobile';

export default function AdminLeadCenter() {
  return (
    <AdminMobilePage title="Lead Center" subtitle="Inbound leads & calls">
      <div className="am-stub">Lead Center coming soon.</div>
    </AdminMobilePage>
  );
}
