/**
 * ════════════════════════════════════════════════
 * FILE: ContactDetail.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The right side of the Contacts screen — the read-only detail for whichever
 *   contact is selected: their name and ways to reach them, their tags, a clear
 *   "do not contact" warning if they've opted out of texts or email, and their
 *   full activity timeline (every call, text, note, estimate, job and task).
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a slot component of /crm/contacts
 *   Rendered by:  src/pages/crm/CrmContacts.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db),
 *              @/components/crm/ActivityTimeline
 *   Data:      reads  → contacts (direct select by id), get_contact_consent RPC,
 *                       get_contact_activity RPC (via ActivityTimeline) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 6a (.claude/rules/crm-wave-ownership.md). Read-only — the
 *     owner/lifecycle setters land in Phase 6b. Receives the selected contactId
 *     from the skeleton; renders a prompt until one is chosen.
 *   - The do-not-contact badge is the unified read from get_contact_consent
 *     (SMS do-not-disturb ∪ SMS opt-out ∪ email suppression) — never re-derive
 *     it from raw contact columns here; that RPC is the single source of truth.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import ActivityTimeline from '@/components/crm/ActivityTimeline';
import { err } from '@/lib/toast';

const asTags = (tags) => {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') { try { const p = JSON.parse(tags); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
};

export default function ContactDetail({ contactId }) {
  const { db } = useAuth();
  const [contact, setContact] = useState(null);
  const [consent, setConsent] = useState(null);
  const [loading, setLoading] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    if (!contactId) { setContact(null); setConsent(null); return; }
    setLoading(true);
    try {
      const [row] = await db.select('contacts', `id=eq.${contactId}&select=*`);
      setContact(row || null);
      const c = await db.rpc('get_contact_consent', { p_contact_id: contactId });
      setConsent(c || null);
    } catch {
      err('Failed to load contact');
      setContact(null); setConsent(null);
    } finally {
      setLoading(false);
    }
  }, [contactId, db]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Render ──────────────
  if (!contactId) return <p className="crm-panel-empty">Select a contact to see their details.</p>;
  if (loading) return <p className="crm-panel-empty">Loading…</p>;
  if (!contact) return <p className="crm-panel-empty">Contact not found.</p>;

  const tags = asTags(contact.tags);
  const dnc = consent?.do_not_contact;
  const reasons = [];
  if (consent?.sms?.dnd) reasons.push('SMS do-not-disturb');
  if (consent?.sms?.opted_out) reasons.push(`SMS opt-out${consent.sms.opt_out_reason ? ` (${consent.sms.opt_out_reason})` : ''}`);
  if (consent?.email?.suppressed) reasons.push(`Email suppressed${consent.email.reason ? ` (${consent.email.reason})` : ''}`);

  return (
    <div className="crm-card crm-detail">
      <div className="crm-detail-head">
        <div>
          <div className="crm-panel-title">{contact.name || contact.phone || 'Unnamed contact'}</div>
          {contact.company && <div className="crm-panel-subtitle">{contact.company}</div>}
        </div>
        {consent && (
          <span className={`crm-dnc-badge${dnc ? ' is-dnc' : ' is-ok'}`}>
            {dnc ? 'Do not contact' : 'Contactable'}
          </span>
        )}
      </div>

      {dnc && reasons.length > 0 && (
        <div className="crm-dnc-reasons">{reasons.join(' · ')}</div>
      )}

      <div className="crm-panel-section">
        <div className="crm-panel-row"><span>Phone</span><span>{contact.phone || '—'}</span></div>
        <div className="crm-panel-row"><span>Email</span><span>{contact.email || '—'}</span></div>
        {contact.lifecycle_status && <div className="crm-panel-row"><span>Lifecycle</span><span>{contact.lifecycle_status}</span></div>}
        {contact.role && <div className="crm-panel-row"><span>Role</span><span>{contact.role}</span></div>}
        {contact.referral_source && <div className="crm-panel-row"><span>Referral</span><span>{contact.referral_source}</span></div>}
        {(contact.billing_city || contact.billing_state) && (
          <div className="crm-panel-row"><span>Location</span><span>{[contact.billing_city, contact.billing_state].filter(Boolean).join(', ')}</span></div>
        )}
      </div>

      {tags.length > 0 && (
        <div className="crm-panel-section">
          <div className="crm-panel-section-title">Tags</div>
          <div className="crm-detail-tags">
            {tags.map((t, i) => <span key={i} className="crm-detail-tag">{String(t)}</span>)}
          </div>
        </div>
      )}

      <div className="crm-panel-section">
        <div className="crm-panel-section-title">Activity</div>
        <ActivityTimeline contactId={contactId} />
      </div>
    </div>
  );
}
