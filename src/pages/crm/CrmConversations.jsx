/**
 * ════════════════════════════════════════════════
 * FILE: CrmConversations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM's two-way texting/click-to-call screen. Phase F ships it as a
 *   "coming in Phase 7" placeholder so the route/nav slot is live; Phase 7
 *   fills it (embedding the existing Conversations components in the CRM shell).
 *
 * WHERE IT LIVES:
 *   Route:        /crm/conversations
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./CrmStubPage
 *   Data:      none yet
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 7 (.claude/rules/crm-wave-ownership.md). Foundation seeds
 *     the placeholder so App.jsx (frozen in-wave) never needs re-routing.
 * ════════════════════════════════════════════════
 */
import CrmStubPage from './CrmStubPage';

export default function CrmConversations() {
  return <CrmStubPage title="Conversations" phase="7" />;
}
