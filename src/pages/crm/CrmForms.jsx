/**
 * ════════════════════════════════════════════════
 * FILE: CrmForms.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The embeddable lead-capture form builder — design a form, publish it, and
 *   copy an embed snippet for the website. Phase F ships it as a "coming in
 *   Phase 10" placeholder so the route/nav slot is live; Phase 10 fills it.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/forms
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  ./CrmStubPage
 *   Data:      none yet
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 10 (.claude/rules/crm-wave-ownership.md). Foundation seeds
 *     the placeholder so App.jsx (frozen in-wave) never needs re-routing.
 * ════════════════════════════════════════════════
 */
import CrmStubPage from './CrmStubPage';

export default function CrmForms() {
  return <CrmStubPage title="Forms" phase="10" />;
}
