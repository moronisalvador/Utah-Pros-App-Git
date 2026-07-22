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
 *   - Every item with a body (a call, note, SMS) renders collapsed by default
 *     — just the title/time row, with a chevron showing it's clickable.
 *     Clicking expands it; a call's body then renders as labeled speaker
 *     turns (collapsed to a short preview with its own "Show full
 *     transcript" toggle), same as before. Speakers are labeled "Utah
 *     Pros"/"Customer" — ActivityBody prefers item.meta.transcript_analysis
 *     (the backend's own verified agent/customer identification,
 *     turnsFromAnalysis) and only falls back to guessing from the flat
 *     "Speaker 1/2" text (parseTranscript) when that structured data isn't
 *     there yet (an older, un-enriched call). Anything that isn't a real
 *     back-and-forth just clamps at BODY_PREVIEW_CHARS with a "Show more"
 *     toggle.
 *   - Actor attribution: the backend adds a *_name key per activity type
 *     where a single acting employee makes sense (moved_by_name,
 *     created_by_name, assignee_name, sent_by_name) — actorLabelFor() below
 *     picks the right one per type. A stage move with no moved_by is an
 *     automated trigger (auto-advance/disqualify), shown as "Automated"
 *     rather than left blank. Types with no single actor (a raw inbound
 *     call, a campaign email, a job) show no actor line at all.
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

// Friendlier badge text than the raw activity_type — also keeps badge widths
// closer together so the timeline reads as aligned columns instead of a
// ragged mix of short ("sms") and long ("work_authorization") pills.
const ACTIVITY_LABELS = {
  lead: 'Call', sms: 'SMS', note: 'Note', estimate: 'Estimate', email: 'Email',
  job: 'Job', task: 'Task', appointment: 'Appt', invoice: 'Invoice',
  work_authorization: 'Work Auth', stage_change: 'Stage', follow_up_call: 'Follow-up',
};

// One acting employee's name per activity type, where a single actor makes
// sense — null when the type has none (a raw inbound call, a campaign
// email, a job) so the caller can skip the "by ..." line entirely. A stage
// move with a null moved_by is an automated trigger, not an unlogged person.
function actorLabelFor(item) {
  const meta = item.meta || {};
  switch (item.activity_type) {
    case 'stage_change': return meta.moved_by_name || 'Automated';
    case 'task': return meta.assignee_name || meta.created_by_name || null;
    case 'sms': return meta.sent_by_name || null;
    case 'estimate': case 'appointment': case 'invoice': case 'work_authorization':
      return meta.created_by_name || meta.sent_by_name || null;
    case 'note': return meta.author_name || null;
    default: return null;
  }
}

// Small chevron affordance — rotates via CSS when its row is expanded (see
// .crm-timeline-chevron.expanded in index.css). Feather-style, matches the
// rest of the app's SVG icon set (no emoji per CLAUDE.md rule 2).
function IconChevron({ className }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

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
        <TimelineItem key={i} item={item} />
      ))}
    </div>
  );
}

// Its own component so each item's expand/collapse state is independent —
// collapsed by default (title/time only) when it has a body to hide;
// clicking the title row reveals it. Items with no body (a stage move, an
// estimate/invoice line) render exactly as before, nothing to expand.
function TimelineItem({ item }) {
  const [open, setOpen] = useState(false);
  const actor = actorLabelFor(item);
  const hasBody = Boolean(item.body);

  return (
    <div className="crm-timeline-item">
      <span className="crm-timeline-badge" data-type={item.activity_type}>{ACTIVITY_LABELS[item.activity_type] || item.activity_type}</span>
      <div className="crm-timeline-body">
        {hasBody ? (
          <button type="button" className="crm-timeline-title crm-timeline-title-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
            <IconChevron className={`crm-timeline-chevron${open ? ' expanded' : ''}`} />
            {item.title}
          </button>
        ) : (
          <div className="crm-timeline-title">{item.title}</div>
        )}
        {hasBody && open && <ActivityBody text={item.body} analysis={item.meta?.transcript_analysis} />}
        <div className="crm-timeline-time">
          {item.occurred_at ? new Date(item.occurred_at).toLocaleString() : '—'}
          {actor && <span className="crm-timeline-actor"> · {actor}</span>}
        </div>
      </div>
    </div>
  );
}
