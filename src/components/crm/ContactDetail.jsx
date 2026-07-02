/**
 * ════════════════════════════════════════════════
 * FILE: ContactDetail.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The right side of the Contacts screen — the read-only detail for whichever
 *   contact is selected: their info, tags, a do-not-contact badge, and their
 *   full activity timeline. Phase F ships it as a placeholder slot; Phase 6a
 *   fills it (reusing the shared ActivityTimeline component) and Phase 6b adds
 *   the owner/lifecycle setters.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none yet (Phase 6a wires get_crm_contacts / get_contact_consent
 *              + @/components/crm/ActivityTimeline)
 *   Data:      reads → none yet · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6a (.claude/rules/crm-wave-ownership.md). Receives the
 *     selected contactId from the skeleton; renders nothing until one is chosen.
 * ════════════════════════════════════════════════
 */
export default function ContactDetail({ contactId }) {
  if (!contactId) {
    return <p className="crm-panel-empty">Select a contact to see their details.</p>;
  }
  return (
    <div className="crm-card">
      <p className="crm-stub-text">Contact detail ships in Phase 6a.</p>
    </div>
  );
}
