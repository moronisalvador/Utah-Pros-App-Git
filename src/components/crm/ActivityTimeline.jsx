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
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/transcript
 *              (turnsFromAnalysis + parseTranscript — pure, unit-tested
 *              separately)
 *   Data:      reads → get_contact_activity RPC (meta.transcript_analysis,
 *              2026-07-17 additive replace) · writes → none
 *
 * NOTES / GOTCHAS:
 *   - Self-loading: pass a contactId (get_contact_activity) or, for a lead
 *     that isn't linked to a contact yet, a leadId instead (get_lead_activity
 *     — same return shape, scoped to the lead's own call/task/stage-history
 *     rows with no contact required). contactId wins if both are passed.
 *     Caller is responsible for the "nothing to show yet" case when neither
 *     id is available — this component assumes it has at least one.
 *   - Behavior-identical to the original inline Leads timeline: same RPC, same
 *     error toast, same .crm-timeline markup and empty/loading copy.
 *   - A call's body (transcription) renders as labeled speaker turns,
 *     collapsed to a short preview with a "Show full transcript" toggle.
 *     Speakers are labeled "Utah Pros"/"Customer" — ActivityBody prefers
 *     item.meta.transcript_analysis (the backend's own verified
 *     agent/customer identification, turnsFromAnalysis) and only falls back
 *     to guessing from the flat "Speaker 1/2" text (parseTranscript) when
 *     that structured data isn't there yet (an older, un-enriched call).
 *     Anything that isn't a real back-and-forth (including plain SMS/note
 *     bodies) just clamps at BODY_PREVIEW_CHARS with a "Show more" toggle.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { turnsFromAnalysis, parseTranscript } from '@/lib/transcript';
import { err } from '@/lib/toast';
import TabLoading from '@/components/TabLoading';
import ErrorState from '@/components/ui/ErrorState';

const BODY_PREVIEW_CHARS = 220;
const TRANSCRIPT_PREVIEW_TURNS = 2;

// One activity's body — a transcript renders as labeled speaker turns
// (collapsed to a short preview), everything else as plain text (also
// clamped when long). Its own component so each timeline item's
// expand/collapse state is independent.
function ActivityBody({ text, analysis }) {
  const [expanded, setExpanded] = useState(false);
  // Prefer the backend's already-verified Utah Pros/Customer identification
  // (transcript_analysis); fall back to the flat-text best-effort guess only
  // when that isn't available yet — see src/lib/transcript.js.
  const turns = useMemo(() => turnsFromAnalysis(analysis) || parseTranscript(text), [analysis, text]);

  if (turns) {
    const visible = expanded ? turns : turns.slice(0, TRANSCRIPT_PREVIEW_TURNS);
    return (
      <div className="crm-timeline-text">
        <div className="crm-transcript">
          {visible.map((t, i) => (
            <div className="crm-transcript-turn" key={i}>
              <span className="crm-transcript-speaker">{t.speaker}</span>
              <span>{t.line}</span>
            </div>
          ))}
        </div>
        {turns.length > TRANSCRIPT_PREVIEW_TURNS && (
          <button type="button" className="crm-transcript-toggle" onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Show less' : `Show full transcript (${turns.length} lines)`}
          </button>
        )}
      </div>
    );
  }

  if (text.length > BODY_PREVIEW_CHARS) {
    return (
      <div className="crm-timeline-text">
        {expanded ? text : `${text.slice(0, BODY_PREVIEW_CHARS).trimEnd()}…`}
        {' '}
        <button type="button" className="crm-transcript-toggle" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      </div>
    );
  }

  return <div className="crm-timeline-text">{text}</div>;
}

export default function ActivityTimeline({ contactId, leadId }) {
  const { db } = useAuth();
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Guards against a stale response winning a race — e.g. a lead links to a
  // contact (or the panel switches to a different lead) while the prior
  // contactId/leadId request is still in flight (page-lifecycle.md §2).
  const requestIdRef = useRef(0);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    if (!contactId && !leadId) { setLoading(false); return; }
    const requestId = ++requestIdRef.current;
    setLoadError(false);
    try {
      const rows = contactId
        ? await db.rpc('get_contact_activity', { p_contact_id: contactId })
        : await db.rpc('get_lead_activity', { p_lead_id: leadId });
      if (requestId !== requestIdRef.current) return; // superseded by a newer request
      setActivity(rows || []);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setLoadError(true);
      err('Failed to load contact activity');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [contactId, leadId, db]);

  // `loading` is only ever set true by its initial state (cold start) — a
  // contactId/leadId change (e.g. the lead this panel is showing just linked
  // to a contact) is a mutation-driven prop swap, not a fresh mount, so it
  // must refetch silently rather than re-blank an already-rendered timeline
  // (page-lifecycle.md §1). A genuinely different lead gets a real cold
  // start because the caller keys this component by lead id.
  useEffect(() => { load(); }, [load]);

  // ─── SECTION: Render ──────────────
  if (loading) return <TabLoading />;
  if (loadError) return <ErrorState message="Couldn't load activity." onRetry={load} />;
  if (activity.length === 0) return <p className="crm-panel-empty">No activity recorded yet.</p>;

  return (
    <div className="crm-timeline">
      {activity.map((item, i) => (
        <div key={i} className="crm-timeline-item">
          <span className="crm-timeline-badge" data-type={item.activity_type}>{item.activity_type}</span>
          <div className="crm-timeline-body">
            <div className="crm-timeline-title">{item.title}</div>
            {item.body && <ActivityBody text={item.body} analysis={item.meta?.transcript_analysis} />}
            <div className="crm-timeline-time">{item.occurred_at ? new Date(item.occurred_at).toLocaleString() : '—'}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
