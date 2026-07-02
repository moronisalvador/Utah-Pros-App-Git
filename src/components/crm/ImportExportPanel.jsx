/**
 * ════════════════════════════════════════════════
 * FILE: ImportExportPanel.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Contacts tool for bringing customers in from a spreadsheet (CSV import
 *   with column mapping + de-duplication) and sending them back out (CSV
 *   export). Phase F ships it as a placeholder slot; Phase 6b fills it.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none yet (Phase 6b wires import_contacts + crm_import_batches)
 *   Data:      reads → none yet · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6b (.claude/rules/crm-wave-ownership.md).
 * ════════════════════════════════════════════════
 */
export default function ImportExportPanel() {
  return (
    <div className="crm-card">
      <p className="crm-stub-text">CSV import / export ships in Phase 6b.</p>
    </div>
  );
}
