/**
 * ════════════════════════════════════════════════
 * FILE: AdminLeadCenter.jsx  (Admin Mobile — Lead Center)
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The lead center inside the field-tech app: the list of inbound calls and
 *   web-form leads, newest first. You can filter by where each lead stands on
 *   the sales board and search by name or number. Tapping one opens that lead's
 *   own screen, where the recording, transcript, contact details, stage mover
 *   and full history live.
 *
 * WHERE IT LIVES:
 *   Route:        /tech/admin/leads  (inside AdminMobileRoutes, tech shell)
 *   Rendered by:  src/pages/tech/admin/AdminMobileRoutes.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/components/admin-mobile
 *              (AdminMobilePage, AmTabs), @/components/TabLoading,
 *              ./ (leads) LeadRow, leadFormat, @/lib/toast (err),
 *              @/hooks/useResumeRefetch (20s poll + resume/focus refresh)
 *   Data:      reads  → inbound_leads via get_inbound_leads RPC (embeds contact;
 *                       POST so it's never cache-stale) · pipeline_stages and
 *                       lead_pipeline_stage for the stage join
 *              writes → none (a stage move happens on AdminLeadDetail)
 *
 * NOTES / GOTCHAS:
 *   - get_inbound_leads / get_pipeline_stages are call-only here, never
 *     redefined. The CRM-owned REPLACEs are NOT re-defined by this wave.
 *   - A SCANNABLE LIST, on purpose. The recording, transcript, contact block,
 *     stage mover and activity timeline all live on AdminLeadDetail. They used
 *     to be inline on every row; adding history to that would have made the
 *     list an accordion wall, and this screen is read one-handed standing
 *     outside a customer's house to answer "who called and where is it".
 *   - Reads the KANBAN STAGE, never inbound_leads.lead_status. That column is
 *     never advanced — 206 of 210 leads read 'new', including 17 the board calls
 *     Won — so a screen built on it lies. get_inbound_leads returns no stage, so
 *     the join happens here from the same two reads CrmLeads.jsx uses.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
// Concrete modules, not the '@/components/admin-mobile' barrel — the native build
// aliases that barrel to a denying shim, so a barrel import would render this screen
// blank on the phone WITHOUT failing the build. Same rule as AdminCollections.
import AdminMobilePage from '@/components/admin-mobile/AdminMobilePage';
import AmTabs from '@/components/admin-mobile/AmTabs';
import TabLoading from '@/components/TabLoading';
import LeadRow from '@/components/admin-mobile/leads/LeadRow';
import { STAGE_GROUPS, filterLeads } from '@/components/admin-mobile/leads/leadFormat';
import { useResumeRefetch } from '@/hooks/useResumeRefetch';
import { err } from '@/lib/toast';

export default function AdminLeadCenter() {
  const { db } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState('working');
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
      // get_inbound_leads returns lead_status and NO stage, and it is CRM-owned —
      // so the stage is joined here rather than by changing that RPC. Same two
      // reads the kanban itself uses (CrmLeads.jsx), so a browser role is proven
      // to be allowed them.
      const [rows, stageRows, placements] = await Promise.all([
        dbRef.current.rpc('get_inbound_leads', { p_limit: 100 }),
        dbRef.current.rpc('get_pipeline_stages', {}),
        dbRef.current.select('lead_pipeline_stage', 'select=lead_id,stage_id'),
      ]);
      const byId = new Map((stageRows || []).map((s) => [s.id, s]));
      const stageForLead = new Map((placements || []).map((p) => [p.lead_id, byId.get(p.stage_id)]));
      setLeads((rows || []).map((l) => ({ ...l, stage: stageForLead.get(l.id) || null })));
    } catch {
      if (!silent) err('Failed to load leads');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh so a newly-landed call appears without a manual reload: poll every
  // 20s while the tab is visible, and refetch when it regains focus. CallRail's
  // post-call webhook can lag ~1 min, so the screen keeps itself current.
  //
  // All three signals go through the one shared hook (page-lifecycle.md §2),
  // which owns the hidden→visible edge detection and the `document.hidden` poll
  // guard §4 requires. The visibility check stays here because it is what keeps
  // the `focus` path from firing while the document is still hidden — the hook
  // does not guard onFocus, by design.
  const silentRefresh = useCallback(() => {
    if (document.visibilityState === 'visible') load({ silent: true });
  }, [load]);

  useResumeRefetch({ onResume: silentRefresh, onFocus: silentRefresh, pollMs: 20000 });

  // ─── SECTION: Helpers ──────────────
  const shown = useMemo(() => filterLeads(leads, { group, search }), [leads, group, search]);

  // Show a count badge on tabs so an admin sees where the leads are at a glance.
  const tabs = useMemo(
    () => STAGE_GROUPS.map((t) => ({ ...t, badge: filterLeads(leads, { group: t.value }).length })),
    [leads],
  );

  // ─── SECTION: Render ──────────────
  if (loading) return <AdminMobilePage title="Lead Center" subtitle="Inbound leads & calls"><TabLoading /></AdminMobilePage>;

  return (
    <AdminMobilePage title="Lead Center" subtitle="Inbound leads & calls">
      <div className="am-lead-controls">
        <AmTabs tabs={tabs} value={group} onChange={setGroup} />
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
          {shown.map((lead) => <LeadRow key={lead.id} lead={lead} />)}
        </div>
      )}
    </AdminMobilePage>
  );
}
