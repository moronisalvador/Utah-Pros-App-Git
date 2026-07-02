/**
 * ════════════════════════════════════════════════
 * FILE: CrmConversations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's two-way texting screen. It reuses the exact same Conversations
 *   inbox the main app already ships — the same message threads, templates,
 *   scheduling, and Do-Not-Disturb controls — just presented inside the CRM
 *   shell so staff can text customers without leaving the CRM. On top of that
 *   it adds a small "suggested replies" helper: a few ready-to-edit draft
 *   messages based on what the customer last said. Picking one only drops the
 *   text into the message box for a person to review and send — it never sends.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/conversations
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/pages/Conversations (the shared inbox component),
 *              @/components/crm/AiReplySuggestions (the draft-only reply helper)
 *   Data:      (inherited from Conversations) reads → conversations, messages,
 *              contacts, message_templates · writes → messages/conversations via
 *              the /api/send-message worker (Twilio + consent gate)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 7 (.claude/rules/crm-wave-ownership.md). This is a thin
 *     wrapper — it does NOT re-implement messaging. Outbound SMS goes through the
 *     existing /api/send-message worker (call-only; never skip_compliance), which
 *     enforces DND/opt-in. Do not add a send path here.
 *   - AiReplySuggestions is passed through the shared inbox's optional
 *     `replyAssist(context, insertDraft)` render-prop (Conversations passes
 *     nothing in the main app, so the slot is CRM-only). `insertDraft` only fills
 *     the composer; the human still sends — no send path is added by this wiring.
 * ════════════════════════════════════════════════
 */
import Conversations from '@/pages/Conversations';
import AiReplySuggestions from '@/components/crm/AiReplySuggestions';

export default function CrmConversations() {
  return (
    <div className="crm-conversations-embed">
      <Conversations
        replyAssist={(context, insertDraft) => (
          <AiReplySuggestions context={context} onUseDraft={insertDraft} />
        )}
      />
    </div>
  );
}
