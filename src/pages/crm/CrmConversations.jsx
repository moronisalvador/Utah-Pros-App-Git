/**
 * ════════════════════════════════════════════════
 * FILE: CrmConversations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's two-way texting screen. It reuses the exact same Conversations
 *   inbox the main app already ships — the same message threads, templates,
 *   scheduling, and Do-Not-Disturb controls — just presented inside the CRM
 *   shell so staff can text customers without leaving the CRM.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/conversations
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/pages/Conversations (the shared inbox component)
 *   Data:      (inherited from Conversations) reads → conversations, messages,
 *              contacts, message_templates · writes → messages/conversations via
 *              the /api/send-message worker (Twilio + consent gate)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 7 (.claude/rules/crm-wave-ownership.md). This is a thin
 *     wrapper — it does NOT re-implement messaging. Outbound SMS goes through the
 *     existing /api/send-message worker (call-only; never skip_compliance), which
 *     enforces DND/opt-in. Do not add a send path here.
 * ════════════════════════════════════════════════
 */
import Conversations from '@/pages/Conversations';

export default function CrmConversations() {
  return (
    <div className="crm-conversations-embed">
      <Conversations />
    </div>
  );
}
