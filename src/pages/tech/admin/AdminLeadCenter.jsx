/**
 * ════════════════════════════════════════════════
 * FILE: AdminLeadCenter.jsx  (Admin Mobile — Lead Center)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The lead center inside the field-tech app: the list of inbound calls and
 *   web-form leads, newest first. An admin can filter by status (or spam), search
 *   by name/number, play a call's recording, read its transcript, and change a
 *   lead's status — all from their phone, matching the office Call Log.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/leads  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/components/admin-mobile
 *              (AdminMobilePage, AmTabs), @/components/TabLoading,
 *              ./ (leads) LeadRow, leadFormat
 *   Data:      reads  → inbound_leads via get_inbound_leads RPC (embeds contact;
 *                       POST so it's never cache-stale) · call recordings via the
 *                       /api/callrail-recording proxy (in LeadRow)
 *              writes → inbound_leads.lead_status via update_lead_status RPC
 *
 * NOTES / GOTCHAS:
 *   - get_inbound_leads / update_lead_status are call-only here. The CRM-owned
 *     REPLACEs move_lead_to_stage / get_contact_activity are NOT re-defined by
 *     this wave — never re-REPLACE them (ownership manifest §3).
 *   - Status changes update the row optimistically and reload the list on
 *     failure, so a dropped write can't leave a wrong status showing.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AdminMobilePage, AmTabs } from '@/components/admin-mobile';
import TabLoading from '@/components/TabLoading';
import LeadRow from '@/components/admin-mobile/leads/LeadRow';
import { STATUS_FILTER_TABS, filterLeads } from '@/components/admin-mobile/leads/leadFormat';

const toast = (message, type = 'error') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

export default function AdminLeadCenter() {
  const { db } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  // db can change identity across renders; keep the loader stable via a ref so the
  // auto-refresh interval isn't torn down and rebuilt on every auth tick.
  const dbRef = useRef(db);
  dbRef.current = db;

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      // POST via RPC (not a cacheable GET) so returning to the screen never shows
      // a stale list that misses a call that already landed. Mirrors CrmCallLog.
      const rows = await dbRef.current.rpc('get_inbound_leads', { p_limit: 100 });
      setLeads(rows || []);
    } catch {
      if (!silent) toast('Failed to load leads');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh so a newly-landed call appears without a manual reload: poll every
  // 20s while the tab is visible, and refetch when it regains focus. CallRail's
  // post-call webhook can lag ~1 min, so the screen keeps itself current.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load({ silent: true }); };
    const id = setInterval(refresh, 20000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  // ─── SECTION: Event handlers ──────────────
  const handleStatusChange = useCallback(async (leadId, next) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, lead_status: next } : l)));
    try {
      await dbRef.current.rpc('update_lead_status', { p_lead_id: leadId, p_status: next });
    } catch {
      toast('Failed to update lead status');
      load();
    }
  }, [load]);

  // ─── SECTION: Helpers ──────────────
  const shown = useMemo(() => filterLeads(leads, { status, search }), [leads, status, search]);

  // Show a count badge on tabs so an admin sees where the leads are at a glance.
  const tabs = useMemo(
    () => STATUS_FILTER_TABS.map((t) => ({ ...t, badge: filterLeads(leads, { status: t.value }).length })),
    [leads],
  );

  // ─── SECTION: Render ──────────────
  if (loading) return <AdminMobilePage title="Lead Center" subtitle="Inbound leads & calls"><TabLoading /></AdminMobilePage>;

  return (
    <AdminMobilePage title="Lead Center" subtitle="Inbound leads & calls">
      <div className="am-lead-controls">
        <AmTabs tabs={tabs} value={status} onChange={setStatus} />
        <div className="am-lead-search">
          <input
            type="search"
            inputMode="search"
            value={search}
            placeholder="Search name or number…"
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search leads"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="am-lead-empty">
          <div className="am-lead-empty-title">No leads</div>
          <div className="am-lead-empty-sub">
            {search ? 'Try a different search term.' : 'Nothing to show in this view yet.'}
          </div>
        </div>
      ) : (
        <div className="am-lead-list">
          {shown.map((lead) => (
            <LeadRow key={lead.id} lead={lead} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}
    </AdminMobilePage>
  );
}
