/**
 * ════════════════════════════════════════════════
 * FILE: MergeTool.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Contacts tool for finding duplicate customer records and safely folding
 *   them into one. Phase F ships it as a placeholder slot; Phase 6b fills it,
 *   surfacing get_duplicate_contacts + the (now CRM-safe) merge_contacts.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none yet (Phase 6b wires get_duplicate_contacts + merge_contacts)
 *   Data:      reads → none yet · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6b (.claude/rules/crm-wave-ownership.md). merge_contacts
 *     was made CRM-history-safe by Foundation (P0 fix).
 * ════════════════════════════════════════════════
 */
export default function MergeTool() {
  return (
    <div className="crm-card">
      <p className="crm-stub-text">Duplicate detection &amp; merge ships in Phase 6b.</p>
    </div>
  );
}
