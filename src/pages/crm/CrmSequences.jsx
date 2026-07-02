/**
 * ════════════════════════════════════════════════
 * FILE: CrmSequences.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The drip / nurture sequence builder — ordered follow-up steps (email or
 *   text) sent on a delay. Phase F ships it as a "coming in Phase 8"
 *   placeholder so the route/nav slot is live; Phase 8 fills it.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/sequences
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./CrmStubPage
 *   Data:      none yet
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 8 (.claude/rules/crm-wave-ownership.md). Foundation seeds
 *     the placeholder so App.jsx (frozen in-wave) never needs re-routing.
 * ════════════════════════════════════════════════
 */
import CrmStubPage from './CrmStubPage';

export default function CrmSequences() {
  return <CrmStubPage title="Sequences" phase="8" />;
}
