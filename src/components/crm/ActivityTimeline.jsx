/**
 * ════════════════════════════════════════════════
 * FILE: ActivityTimeline.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Shows one contact's history as a vertical timeline — every call, text,
 *   note, estimate, campaign email, job, and task tied to them, newest first.
 *   Extracted from the Leads detail panel (Phase F) so the same timeline can be
 *   reused unchanged on the Contacts detail screen (Phase 6a) and anywhere else
 *   a contact's activity needs to show.
 *
 * WHERE IT LIVES:
 *   Route:        n/a — a shared CRM component
 *   Rendered by:  src/pages/crm/CrmLeads.jsx (LeadDetailPanel) and, in the
 *                 wave, ContactDetail.jsx (Phase 6a)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db)
 *   Data:      reads → get_contact_activity RPC · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Self-loading: pass a contactId and it fetches its own data. Caller is
 *     responsible for the "no linked contact yet" case (render nothing / its own
 *     message when contactId is falsy) — this component assumes it has an id.
 *   - Behavior-identical to the original inline Leads timeline: same RPC, same
 *     error toast, same .crm-timeline markup and empty/loading copy.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));

export default function ActivityTimeline({ contactId }) {
  const { db } = useAuth();
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);
    try {
      const rows = await db.rpc('get_contact_activity', { p_contact_id: contactId });
      setActivity(rows || []);
    } catch {
      err('Failed to load contact activity');
    } finally {
      setLoading(false);
    }
  }, [contactId, db]);

  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Render ──────────────
  if (loading) return <p className="crm-panel-empty">Loading…</p>;
  if (activity.length === 0) return <p className="crm-panel-empty">No activity recorded yet.</p>;

  return (
    <div className="crm-timeline">
      {activity.map((item, i) => (
        <div key={i} className="crm-timeline-item">
          <span className="crm-timeline-badge" data-type={item.activity_type}>{item.activity_type}</span>
          <div className="crm-timeline-body">
            <div className="crm-timeline-title">{item.title}</div>
            {item.body && <div className="crm-timeline-text">{item.body}</div>}
            <div className="crm-timeline-time">{item.occurred_at ? new Date(item.occurred_at).toLocaleString() : '—'}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
