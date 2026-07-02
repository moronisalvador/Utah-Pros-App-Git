/**
 * ════════════════════════════════════════════════
 * FILE: ContactsDirectory.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The searchable, paged list of every customer/contact — the left side of the
 *   Contacts screen. Phase F ships it as a placeholder slot inside the Contacts
 *   skeleton; Phase 6a fills it with real search + pagination and wires clicking
 *   a row to open the detail panel.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none yet (Phase 6a wires get_crm_contacts)
 *   Data:      reads → none yet · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6a (.claude/rules/crm-wave-ownership.md). onSelect(contactId)
 *     is passed by the skeleton so 6a can drive the ContactDetail slot.
 * ════════════════════════════════════════════════
 */
export default function ContactsDirectory({ onSelect }) { // eslint-disable-line no-unused-vars
  return (
    <div className="crm-card">
      <p className="crm-stub-text">Contacts directory ships in Phase 6a.</p>
    </div>
  );
}
