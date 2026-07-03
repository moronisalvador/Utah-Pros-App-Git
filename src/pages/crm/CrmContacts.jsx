/**
 * ════════════════════════════════════════════════
 * FILE: CrmContacts.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Contacts screen shell. It lays out the four pieces of the contacts
 *   experience — the searchable directory, the selected-contact detail, the
 *   CSV import/export tool, and the duplicate-merge tool — and remembers which
 *   contact is currently selected so the directory and detail stay in sync.
 *   Phase F ships this skeleton (frozen for the wave); Phases 6a and 6b fill
 *   the four slot components it renders, so both can build the Contacts screen
 *   at the same time without editing this file.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/contacts
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/components/crm/ContactsDirectory (6a), ContactDetail (6a),
 *              ImportExportPanel (6b), MergeTool (6b)
 *   Data:      reads → none directly (the slot components own their data) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - FROZEN for the CRM wave (.claude/rules/crm-wave-ownership.md "Frozen
 *     in-wave"): 6a/6b edit ONLY their slot components, never this skeleton, so
 *     the two Contacts phases never collide. The contract between them is the
 *     onSelect(contactId) / contactId prop pair below.
 * ════════════════════════════════════════════════
 */
import { useState } from 'react';
import ContactsDirectory from '@/components/crm/ContactsDirectory';
import ContactDetail from '@/components/crm/ContactDetail';
import ImportExportPanel from '@/components/crm/ImportExportPanel';
import MergeTool from '@/components/crm/MergeTool';

export default function CrmContacts() {
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [tool, setTool] = useState(null); // null | 'import' | 'merge'

  return (
    <div className="crm-page">
      <div className="crm-page-header crm-page-header-row">
        <div>
          <h1 className="crm-page-title">Contacts</h1>
          <p className="crm-page-subtitle">Search, view, import and de-duplicate your customer records.</p>
        </div>
        <div className="crm-page-header-actions">
          <button
            className={`crm-btn crm-btn-ghost${tool === 'import' ? ' active' : ''}`}
            onClick={() => setTool(t => (t === 'import' ? null : 'import'))}
          >
            Import / Export
          </button>
          <button
            className={`crm-btn crm-btn-ghost${tool === 'merge' ? ' active' : ''}`}
            onClick={() => setTool(t => (t === 'merge' ? null : 'merge'))}
          >
            Find duplicates
          </button>
        </div>
      </div>

      {tool === 'import' && <ImportExportPanel />}
      {tool === 'merge' && <MergeTool />}

      <div className="crm-contacts-layout">
        <div className="crm-contacts-directory">
          <ContactsDirectory onSelect={setSelectedContactId} />
        </div>
        <div className="crm-contacts-detail">
          <ContactDetail contactId={selectedContactId} />
        </div>
      </div>
    </div>
  );
}
