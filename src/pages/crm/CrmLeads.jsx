/**
 * ════════════════════════════════════════════════
 * FILE: CrmLeads.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Leads pipeline board — a Kanban like the one on the Production page,
 *   but for sales leads instead of jobs. Every non-spam call or web-form
 *   lead shows up as a card in a column (New, Contacted, Qualified, ...) —
 *   drag a card to a new column to move it forward, with a mouse on desktop
 *   or a finger on iPad/iPhone. Tap a card (without dragging it) to open its
 *   details: who it is, how to reach them, a dropdown to change its stage,
 *   every answer they typed into the web form that created the lead, a
 *   free-text notes box, the to-dos tied to this lead, a log of every stage
 *   it's moved through, and a combined timeline of every call, text, note,
 *   and estimate tied to that contact. A filter bar above the board narrows
 *   what's shown: a date-range switch (Week / Month / All time, or a custom
 *   range) plus a criteria panel (source, sentiment, service needed, time in
 *   stage) — both pure client-side filters over the leads already loaded,
 *   no extra fetch.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/leads
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db, employee),
 *              @/lib/crmIcons (IconLeads), @/lib/crmPipeline (sortStages,
 *              groupLeadsByStage, weightedPipelineValue),
 *              @/components/TabLoading
 *   Data:      reads  → pipeline_stages (get_pipeline_stages RPC),
 *                       inbound_leads (embeds contacts; .form_data/.notes read
 *                       by the detail panel), lead_pipeline_stage,
 *                       get_contact_activity RPC (opened lead's timeline),
 *                       form_definitions + form_definition_versions (the
 *                       submitted form's schema, for real field labels),
 *                       crm_tasks (get_crm_tasks RPC, filtered by lead_id),
 *                       lead_stage_history (this lead's stage-move log)
 *              writes → lead_pipeline_stage (via move_lead_to_stage RPC),
 *                       inbound_leads + contacts (via create_manual_lead RPC —
 *                       the "+ New lead" manual-entry button; and
 *                       promote_lead_to_contact — the "+ Add as customer" action
 *                       that turns a raw lead into a linked contact),
 *                       inbound_leads.notes (direct update — the panel's
 *                       Notes box), crm_tasks (upsert_crm_task/set_task_status
 *                       — the panel's Tasks quick-add/check-off),
 *                       system_events (direct insert — click-to-call logging)
 *
 * NOTES / GOTCHAS:
 *   - A lead with no lead_pipeline_stage row yet reads as sitting in the
 *     first stage (lowest sort_order) — see src/lib/crmPipeline.js's
 *     groupLeadsByStage(), which the DB-side RPCs mirror.
 *   - Drag-and-drop works on both desktop (native HTML5 DnD) and touch
 *     (Pointer Events — a separate, parallel code path, gated by the same
 *     isTouchDevice() check Production.jsx's JobCard uses to pick a
 *     different interaction instead). Both paths funnel through the single
 *     moveLead() function, and reuse the same .drag-over/.dragging CSS
 *     classes for identical visual feedback. The stage <select> in the
 *     detail panel still works as an always-available fallback on any
 *     device — tapping a card without dragging it still opens that panel.
 *   - The detail panel's "Submitted answers" section labels each field using
 *     the form's real published schema when it can load one (fetched by
 *     raw_payload.form_id); if that fetch fails or the lead predates a
 *     schema, it falls back to a humanized version of the raw field key so
 *     the submitted values are never hidden, just less prettily labeled.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { IconLeads } from '@/lib/crmIcons';
import { sortStages, groupLeadsByStage, weightedPipelineValue } from '@/lib/crmPipeline';
import { normalizePhone, formatPhone } from '@/lib/phone';
import { URGENT_TOPIC_RX } from '@/lib/crmPipeline';
import { IconNote } from '@/components/Icons';
import { IconTasks } from '@/lib/crmIcons';
import { IconButton, StatusPill } from '@/components/ui';
import ActivityTimeline from '@/components/crm/ActivityTimeline';
import TabLoading from '@/components/TabLoading';
import { ok, err } from '@/lib/toast';

const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// Small local icons matching the pattern already used on Customer/ClaimCollection
// pages (an inline SVG per page rather than a new shared export for a one-off).
function IconPhone(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>); }
function IconMsg(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>); }
function IconCalendar(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>); }
function IconFilter(p) { return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>); }

// Card quick-action icons render deliberately small and thin-stroked — a
// minimal glyph row (GoHighLevel-style), not full-size 24px icons filling a
// 30px button. Shared object (not recreated per render) so it's a stable
// prop reference.
const CARD_ACTION_ICON_STYLE = { width: 14, height: 14, strokeWidth: 1.75 };

// Sentiment → a small at-a-glance dot on the card. Neutral/missing gets no dot
// at all (no signal is not the same as neutral tone — don't imply one).
function sentimentDotClass(lead) {
  const label = lead.transcript_analysis?.sentiment?.label;
  if (label === 'positive') return 'positive';
  if (label === 'negative') return 'negative';
  return null;
}

// First sentence (or ~90 chars) of the AI call summary — enough to scan the
// board without opening every card, never the full paragraph.
function summarySnippet(lead) {
  const summary = lead.transcript_analysis?.summary;
  if (!summary) return null;
  const firstSentence = summary.split(/(?<=[.!?])\s/)[0] || summary;
  return firstSentence.length > 90 ? `${firstSentence.slice(0, 90).trimEnd()}…` : firstSentence;
}

// "1:23" for a call's duration — skipped for forms and 0/missing durations.
function formatDuration(sec) {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Same urgency signal score_lead already uses (water/flood/mold/emergency/...
// keywords in the transcript's AI-detected topics) — reused here as a glance
// badge, not re-derived with different rules.
function isUrgent(lead) {
  const topics = Array.isArray(lead.transcript_analysis?.topics) ? lead.transcript_analysis.topics : [];
  return topics.some(t => URGENT_TOPIC_RX.test(String(t)));
}

function formatMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function leadLabel(lead) {
  return lead.contact?.name || lead.caller_number || (lead.source_type === 'form' ? 'Web form lead' : 'Unknown caller');
}

// "Call · Google My Business · Google My Business" reads like a bug when a
// lead's source and campaign are the same string (common for CallRail leads
// with no separate campaign tag) — join only the segments that differ.
function sourceLine(lead) {
  const parts = [lead.source_type === 'call' ? 'Call' : 'Web form'];
  if (lead.source) parts.push(lead.source);
  if (lead.campaign && lead.campaign.trim().toLowerCase() !== (lead.source || '').trim().toLowerCase()) {
    parts.push(lead.campaign);
  }
  return parts.join(' · ');
}

// Field keys that are legal bookkeeping / spam traps, never shown as a "submitted answer".
const FORM_DATA_SKIP_TYPES = new Set(['consent']);
const FORM_DATA_SKIP_KEYS = new Set(['hp', 'honeypot']);

// eslint-disable-next-line react-refresh/only-export-components
export function displayFieldValue(raw) {
  if (Array.isArray(raw)) return raw.map(v => (v == null ? '' : String(v).trim())).filter(Boolean).join(', ');
  return raw == null ? '' : String(raw).trim();
}

// "multiple_choice_field" -> "Multiple choice field" — used only when the
// form's real schema label can't be loaded (see LeadDetailPanel's formSchema fetch).
function humanizeKey(key) {
  const s = String(key).replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

// Flatten a lead's raw form_data into ordered { key, label, value, boolean? }
// rows — schema order + real labels when the published schema loaded,
// humanized-key fallback otherwise, so a submission never renders blank.
// Mirrors functions/api/form-submit.js's leadNotificationRows (server-side,
// for the email/push alert) but reads client-side jsonb, not a Cloudflare
// Worker payload — including the same checkbox handling: an unchecked box
// (false) is dropped entirely, a checked one (true) is flagged `boolean:
// true` with an empty value so the panel shows just the label, not "Yes".
// eslint-disable-next-line react-refresh/only-export-components
export function formDataRows(schema, data) {
  const fields = schema && Array.isArray(schema.fields) ? schema.fields : [];
  const d = data && typeof data === 'object' ? data : {};
  const rows = [];
  const seen = new Set();
  for (const f of fields) {
    if (!f || !f.key) continue;
    if (FORM_DATA_SKIP_TYPES.has(f.type) || FORM_DATA_SKIP_KEYS.has(f.key)) { seen.add(f.key); continue; }
    seen.add(f.key);
    const raw = d[f.key];
    if (typeof raw === 'boolean') {
      if (!raw) continue;
      rows.push({ key: f.key, label: (f.label && String(f.label).trim()) || humanizeKey(f.key), value: '', boolean: true });
      continue;
    }
    const value = displayFieldValue(raw);
    if (!value) continue;
    rows.push({ key: f.key, label: (f.label && String(f.label).trim()) || humanizeKey(f.key), value });
  }
  for (const [k, v] of Object.entries(d)) {
    if (seen.has(k) || FORM_DATA_SKIP_KEYS.has(k)) continue;
    if (typeof v === 'boolean') {
      if (!v) continue;
      rows.push({ key: k, label: humanizeKey(k), value: '', boolean: true });
      continue;
    }
    const value = displayFieldValue(v);
    if (!value) continue;
    rows.push({ key: k, label: humanizeKey(k), value });
  }
  return rows;
}

// Client-side guard: a reason is required to move a lead into a "lost" stage,
// so win/loss data stays honest. Returns an error string, or null when OK.
// (The move_lead_to_stage RPC keeps p_lost_reason optional for backward
// compatibility — this requirement lives in the new UI path only.)
// eslint-disable-next-line react-refresh/only-export-components
export function lostReasonError(stage, reason) {
  if (stage?.is_lost && !reason?.trim()) return 'A reason is required when marking a lead lost.';
  return null;
}

// Whole days a lead has sat in its current stage, from lead_pipeline_stage.updated_at.
function daysInStage(updatedAt) {
  if (!updatedAt) return null;
  const ms = Date.now() - new Date(updatedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / 86400000);
}

// ─── SECTION: Filter bar (date range + criteria) ──────────────
// Calendar-based, not rolling windows — "Week"/"Month" mean this-week/
// this-month-to-date, the same convention src/lib/reportPeriods.js already
// uses for MTD elsewhere in the app (never UTC — local/business time).
const DATE_PERIODS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All time' },
];

function dateRangeFor(period, customRange) {
  if (period === 'custom') {
    const start = customRange.start ? new Date(`${customRange.start}T00:00:00`).getTime() : null;
    const end = customRange.end ? new Date(`${customRange.end}T23:59:59.999`).getTime() : null;
    return { start, end };
  }
  if (period === 'all') return { start: null, end: null };
  const now = new Date();
  if (period === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: null };
  // "week" — since the most recent Monday.
  const day = now.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  return { start: monday.getTime(), end: null };
}

// Service categories, derived from the AI-detected transcript topics — the
// same data isUrgent() already reads, just bucketed instead of boolean. A
// lead with no matching keyword (or no transcript at all, e.g. a fresh/
// unenriched call or a web form) falls into 'other' rather than disappearing
// from every filter.
const SERVICE_CATEGORIES = [
  { key: 'water', label: 'Water damage', rx: /\b(water|flood|leak|burst|sewage|pipe)\b/i },
  { key: 'mold', label: 'Mold', rx: /\bmold\b/i },
  { key: 'fire', label: 'Fire / smoke', rx: /\b(fire|smoke)\b/i },
  { key: 'storm', label: 'Storm / roofing', rx: /\b(storm|hail|wind|roof)\b/i },
  { key: 'asbestos', label: 'Asbestos', rx: /\basbestos\b/i },
];
function serviceKeysFor(lead) {
  const topics = Array.isArray(lead.transcript_analysis?.topics) ? lead.transcript_analysis.topics : [];
  const text = topics.join(' ');
  const matched = SERVICE_CATEGORIES.filter(c => c.rx.test(text)).map(c => c.key);
  return matched.length ? matched : ['other'];
}

const STAGE_AGE_BUCKETS = [
  { key: 'fresh', label: 'Fresh (< 2 days)', test: d => d != null && d < 2 },
  { key: 'aging', label: 'Aging (2–7 days)', test: d => d != null && d >= 2 && d < 7 },
  { key: 'stale', label: 'Stale (7+ days)', test: d => d != null && d >= 7 },
];

function sentimentKeyFor(lead) {
  const label = lead.transcript_analysis?.sentiment?.label;
  return label === 'positive' || label === 'negative' ? label : 'none';
}

const emptyFilters = () => ({ sources: new Set(), campaigns: new Set(), sentiments: new Set(), services: new Set(), stageAges: new Set() });

export default function CrmLeads() {
  const { db, employee } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [stagePositions, setStagePositions] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const [dragLead, setDragLead] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [lostPrompt, setLostPrompt] = useState(null); // { lead, stageId } awaiting a lost reason

  // Card quick actions (note/task) — one inline popover open at a time,
  // keyed by lead id + which kind. Call/Text have no popover, they act
  // immediately (tel: link / navigate to Conversations).
  const [quickPopover, setQuickPopover] = useState(null); // { leadId, type: 'note'|'task' }
  const [quickDraft, setQuickDraft] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);

  // Filter bar — date range (week/month/all/custom) + a criteria panel
  // (source/sentiment/service/stage age). Both are pure client-side filters
  // over the already-loaded `leads` array, same as the rest of this board.
  const [datePeriod, setDatePeriod] = useState('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);

  // Card AI-summary inline expand/collapse — a lead id in this set shows its
  // full transcript_analysis.summary in place instead of the one-line
  // snippet. Deliberately separate from selectedLead (the side panel): the
  // whole card still opens the panel, only the summary line itself toggles
  // this, via stopPropagation.
  const [expandedSummaries, setExpandedSummaries] = useState(() => new Set());
  const toggleSummaryExpanded = useCallback((e, leadId) => {
    e.stopPropagation();
    setExpandedSummaries(prev => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
      return next;
    });
  }, []);

  // Touch drag-and-drop — a parallel path to the HTML5 DnD above, only ever
  // wired up when isTouchDevice() (see NOTES). Position/ghost tracking uses
  // refs + imperative style updates, not state, so a fast finger drag on a
  // 200-lead board doesn't force a full re-render every pointermove.
  const [touchDragLead, setTouchDragLead] = useState(null);
  const [touchOverStage, setTouchOverStage] = useState(null);
  const touchStartRef = useRef(null);          // { x, y, lead } from pointerdown
  const touchMovedRef = useRef(false);         // crossed the drag threshold
  const touchDragPerformedRef = useRef(false); // suppresses the post-drag synthetic click
  const touchPosRef = useRef({ x: 0, y: 0 });  // latest pointer pos, read by the auto-scroll loop
  const ghostElRef = useRef(null);
  const boardRef = useRef(null);
  const autoScrollFrameRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stageRows, leadRows, positionRows] = await Promise.all([
        db.rpc('get_pipeline_stages', {}),
        db.select('inbound_leads', 'spam_flag=eq.false&select=*,contact:contacts(name,phone)&order=occurred_at.desc,created_at.desc&limit=200'),
        db.select('lead_pipeline_stage', 'select=lead_id,stage_id,updated_at'),
      ]);
      setStages(stageRows || []);
      setLeads(leadRows || []);
      const positions = {};
      for (const row of positionRows || []) positions[row.lead_id] = { stage_id: row.stage_id, updated_at: row.updated_at };
      setStagePositions(positions);
    } catch {
      err('Failed to load the Leads pipeline');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  // Deep-link support: a "View lead" click from the lead.new email/bell/push
  // lands here with ?lead=<id> — open that lead's panel automatically. Most
  // leads are in the board's already-loaded (most-recent-200) set; an older
  // lead outside that window gets a direct one-off fetch. Runs once per
  // mount (deepLinkAttemptedRef) so it never re-fires as `leads` updates.
  const deepLinkAttemptedRef = useRef(false);
  const deepLinkedLeadId = searchParams.get('lead');
  const clearLeadParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('lead');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  useEffect(() => {
    if (!deepLinkedLeadId || deepLinkAttemptedRef.current || loading) return;
    deepLinkAttemptedRef.current = true;
    const found = leads.find(l => l.id === deepLinkedLeadId);
    if (found) { setSelectedLead(found); clearLeadParam(); return; }
    (async () => {
      try {
        const rows = await db.select('inbound_leads', `id=eq.${deepLinkedLeadId}&spam_flag=eq.false&select=*,contact:contacts(name,phone)`);
        if (rows && rows[0]) setSelectedLead(rows[0]);
      } catch { /* deep-linked lead not found/loadable — board still usable */ }
      finally { clearLeadParam(); }
    })();
  }, [deepLinkedLeadId, leads, loading, db, clearLeadParam]);

  const sortedStages = useMemo(() => sortStages(stages), [stages]);

  // Distinct sources/campaigns present in the currently-loaded leads — the
  // filter panel only ever offers options that actually exist, never a
  // static hardcoded list that could drift from the real source/campaign
  // names three different ad agencies are naming however they like.
  const availableSources = useMemo(
    () => Array.from(new Set(leads.map(l => l.source).filter(Boolean))).sort(),
    [leads]
  );
  const availableCampaigns = useMemo(
    () => Array.from(new Set(leads.map(l => l.campaign).filter(Boolean))).sort(),
    [leads]
  );

  const hasActiveFilters = datePeriod !== 'all'
    || filters.sources.size > 0 || filters.campaigns.size > 0 || filters.sentiments.size > 0
    || filters.services.size > 0 || filters.stageAges.size > 0;

  const filteredLeads = useMemo(() => {
    const { start, end } = dateRangeFor(datePeriod, customRange);
    return leads.filter(lead => {
      if (start != null || end != null) {
        const ts = lead.occurred_at ? new Date(lead.occurred_at).getTime() : null;
        if (ts == null) return false;
        if (start != null && ts < start) return false;
        if (end != null && ts > end) return false;
      }
      if (filters.sources.size > 0 && !filters.sources.has(lead.source)) return false;
      if (filters.campaigns.size > 0 && !filters.campaigns.has(lead.campaign)) return false;
      if (filters.sentiments.size > 0 && !filters.sentiments.has(sentimentKeyFor(lead))) return false;
      if (filters.services.size > 0 && !serviceKeysFor(lead).some(k => filters.services.has(k))) return false;
      if (filters.stageAges.size > 0) {
        const age = daysInStage(stagePositions[lead.id]?.updated_at);
        const bucket = STAGE_AGE_BUCKETS.find(b => b.test(age));
        if (!bucket || !filters.stageAges.has(bucket.key)) return false;
      }
      return true;
    });
  }, [leads, datePeriod, customRange, filters, stagePositions]);

  const grouped = useMemo(() => groupLeadsByStage(filteredLeads, stages, stagePositions), [filteredLeads, stages, stagePositions]);
  const pipelineValue = useMemo(() => weightedPipelineValue(filteredLeads, stages, stagePositions), [filteredLeads, stages, stagePositions]);

  const toggleFilter = useCallback((group, key) => {
    setFilters(prev => {
      const next = { ...prev, [group]: new Set(prev[group]) };
      if (next[group].has(key)) next[group].delete(key); else next[group].add(key);
      return next;
    });
  }, []);
  const clearFilters = useCallback(() => { setFilters(emptyFilters()); setDatePeriod('all'); setCustomRange({ start: '', end: '' }); }, []);

  // Commit a stage move (optionally with a lost reason). Optimistic; reverts on error.
  const commitMove = useCallback(async (lead, stageId, reason) => {
    const prevStageId = stagePositions[lead.id]?.stage_id ?? sortedStages[0]?.id;
    const prevPosition = stagePositions[lead.id];

    setStagePositions(prev => ({ ...prev, [lead.id]: { stage_id: stageId, updated_at: new Date().toISOString() } }));
    try {
      await db.rpc('move_lead_to_stage', {
        p_lead_id: lead.id,
        p_stage_id: stageId,
        p_moved_by: employee?.id || null,
        p_lost_reason: reason || null,
      });
    } catch {
      setStagePositions(prev => ({ ...prev, [lead.id]: prevPosition ?? { stage_id: prevStageId } }));
      err('Failed to move lead — reverted.');
    }
  }, [db, employee, stagePositions, sortedStages]);

  // Entry point for drag/drop AND the detail-panel <select>. A move into a
  // "lost" stage opens the reason prompt instead of committing immediately.
  const moveLead = useCallback((lead, stageId) => {
    const prevStageId = stagePositions[lead.id]?.stage_id ?? sortedStages[0]?.id;
    if (stageId === prevStageId) return;
    const targetStage = sortedStages.find(s => s.id === stageId);
    if (targetStage?.is_lost) { setLostPrompt({ lead, stageId }); return; }
    commitMove(lead, stageId, null);
  }, [commitMove, stagePositions, sortedStages]);

  // Card quick actions — every handler stops propagation so a click never
  // also fires the card's onClick (open panel) or starts a drag.
  const navigate = useNavigate();

  const quickLogCall = useCallback((lead) => {
    db.insert('system_events', {
      event_type: 'crm_click_to_call',
      entity_type: 'inbound_lead',
      entity_id: lead.id,
      actor_id: employee?.id || null,
      payload: { phone: lead.caller_number, contact_id: lead.contact_id || null },
    }).catch(() => {});
  }, [db, employee]);

  const quickText = useCallback((e, lead) => {
    e.preventDefault();
    e.stopPropagation();
    if (!lead.contact_id) return;
    navigate('/crm/conversations', { state: { contactId: lead.contact_id } });
  }, [navigate]);

  const openQuickPopover = useCallback((e, lead, type) => {
    e.preventDefault();
    e.stopPropagation();
    setQuickPopover({ leadId: lead.id, type });
    setQuickDraft(type === 'note' ? (lead.notes || '') : '');
  }, []);

  const closeQuickPopover = useCallback((e) => {
    e?.stopPropagation();
    setQuickPopover(null);
    setQuickDraft('');
  }, []);

  const saveQuickNote = useCallback(async (e, lead) => {
    e.stopPropagation();
    setQuickBusy(true);
    try {
      const trimmed = quickDraft.trim() || null;
      await db.update('inbound_leads', `id=eq.${lead.id}`, { notes: trimmed, updated_at: new Date().toISOString() });
      setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, notes: trimmed } : l)));
      ok('Note saved');
      setQuickPopover(null);
      setQuickDraft('');
    } catch {
      err('Failed to save the note');
    } finally {
      setQuickBusy(false);
    }
  }, [db, quickDraft]);

  const submitQuickTask = useCallback(async (e, lead) => {
    e.stopPropagation();
    const title = quickDraft.trim();
    if (!title) return;
    setQuickBusy(true);
    try {
      await db.rpc('upsert_crm_task', {
        p_title: title,
        p_contact_id: lead.contact_id || null,
        p_lead_id: lead.id,
        p_created_by: employee?.id || null,
      });
      ok('Task added');
      setQuickPopover(null);
      setQuickDraft('');
    } catch {
      err('Failed to add the task');
    } finally {
      setQuickBusy(false);
    }
  }, [db, quickDraft, employee]);

  const handleDragStart = (e, lead) => { setDragLead(lead); e.dataTransfer.effectAllowed = 'move'; };
  const handleDragEnd = () => { setDragLead(null); setDragOverStage(null); };
  const handleDragOver = (e, stageId) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(stageId); };
  const handleDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverStage(null); };
  const handleDrop = (e, stageId) => {
    e.preventDefault();
    setDragOverStage(null);
    if (dragLead) moveLead(dragLead, stageId);
    setDragLead(null);
  };

  // ─── Touch drag-and-drop (Pointer Events) — see file NOTES ──────────────
  const TOUCH_DRAG_THRESHOLD = 8; // px — jitter allowance before committing to a drag
  const AUTO_SCROLL_EDGE = 40;    // px from the board's visible left/right edge
  const AUTO_SCROLL_SPEED = 12;   // px per animation frame

  const updateGhostPosition = (x, y) => {
    touchPosRef.current = { x, y };
    if (ghostElRef.current) {
      ghostElRef.current.style.transform = `translate3d(${x + 12}px, ${y + 12}px, 0)`;
    }
  };

  const updateDropTarget = (x, y) => {
    const stageId = document.elementFromPoint(x, y)?.closest('.crm-board-column')?.dataset.stageId || null;
    setTouchOverStage(stageId);
  };

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const updateAutoScroll = (x) => {
    const board = boardRef.current;
    if (!board || autoScrollFrameRef.current) return; // already running — the loop below re-evaluates every frame
    const rect = board.getBoundingClientRect();
    const direction = x < rect.left + AUTO_SCROLL_EDGE ? -1 : x > rect.right - AUTO_SCROLL_EDGE ? 1 : 0;
    if (direction === 0) return;

    const step = () => {
      if (!boardRef.current || !touchMovedRef.current) { autoScrollFrameRef.current = null; return; }
      const r = boardRef.current.getBoundingClientRect();
      const px = touchPosRef.current.x;
      const dir = px < r.left + AUTO_SCROLL_EDGE ? -1 : px > r.right - AUTO_SCROLL_EDGE ? 1 : 0;
      if (dir === 0) { autoScrollFrameRef.current = null; return; }
      boardRef.current.scrollLeft += dir * AUTO_SCROLL_SPEED;
      autoScrollFrameRef.current = requestAnimationFrame(step);
    };
    autoScrollFrameRef.current = requestAnimationFrame(step);
  };

  const handleCardPointerDown = (e, lead) => {
    if (touchMovedRef.current) return; // a drag is already in progress — ignore a second touch
    touchDragPerformedRef.current = false;
    touchStartRef.current = { x: e.clientX, y: e.clientY, lead };
    touchPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleCardPointerMove = (e) => {
    const start = touchStartRef.current;
    if (!start) return;

    if (!touchMovedRef.current) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) < TOUCH_DRAG_THRESHOLD) { touchPosRef.current = { x: e.clientX, y: e.clientY }; return; }
      touchMovedRef.current = true;
      touchDragPerformedRef.current = true;
      if (navigator.vibrate) navigator.vibrate(10);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setTouchDragLead(start.lead);
    }

    e.preventDefault(); // defense-in-depth once a horizontal drag is confirmed — touch-action: pan-y handles the rest
    updateGhostPosition(e.clientX, e.clientY);
    updateDropTarget(e.clientX, e.clientY);
    updateAutoScroll(e.clientX);
  };

  const handleCardPointerUp = (e) => {
    const start = touchStartRef.current;
    const wasDragging = touchMovedRef.current;
    stopAutoScroll();
    if (wasDragging) {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (start && touchOverStage) moveLead(start.lead, touchOverStage);
    }
    touchStartRef.current = null;
    touchMovedRef.current = false;
    setTouchDragLead(null);
    setTouchOverStage(null);
  };

  const handleCardPointerCancel = (e) => {
    stopAutoScroll();
    if (touchMovedRef.current && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    touchStartRef.current = null;
    touchMovedRef.current = false;
    setTouchDragLead(null);
    setTouchOverStage(null); // pointercancel never calls moveLead — an aborted gesture must never commit a move
  };

  // Seed the ghost's position synchronously before first paint, so it doesn't flash at (0,0)
  useLayoutEffect(() => {
    if (touchDragLead && ghostElRef.current) {
      ghostElRef.current.style.transform = `translate3d(${touchPosRef.current.x + 12}px, ${touchPosRef.current.y + 12}px, 0)`;
    }
  }, [touchDragLead]);

  // Cleanup on unmount (e.g. navigation mid-drag)
  useEffect(() => () => { if (autoScrollFrameRef.current) cancelAnimationFrame(autoScrollFrameRef.current); }, []);

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page crm-page-wide">
      <div className="crm-page-header">
        <div className="crm-page-header-row">
          <div>
            <h1 className="crm-page-title">Leads</h1>
            <p className="crm-page-subtitle">
              {hasActiveFilters ? `${filteredLeads.length} of ${leads.length} leads` : `${leads.length} lead${leads.length === 1 ? '' : 's'} in pipeline`}
              {pipelineValue.total > 0 ? ` · ${formatMoney(pipelineValue.total)} weighted` : ''}
            </p>
          </div>
          <button className="crm-btn crm-btn-primary" onClick={() => setShowNew(true)}>+ New lead</button>
        </div>

        {leads.length > 0 && (
          <div className="crm-leads-filterbar">
            <div className="crm-board-period" role="tablist" aria-label="Date range">
              {DATE_PERIODS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  role="tab"
                  aria-selected={datePeriod === p.value}
                  className={`crm-board-period-btn${datePeriod === p.value ? ' active' : ''}`}
                  onClick={() => { setDatePeriod(p.value); setShowDatePicker(false); }}
                >
                  {p.label}
                </button>
              ))}
              <div className="crm-board-period-divider" />
              <IconButton
                label="Custom date range"
                size="sm"
                className={`crm-board-period-calendar${datePeriod === 'custom' ? ' active' : ''}`}
                onClick={() => setShowDatePicker(v => !v)}
              >
                <IconCalendar style={CARD_ACTION_ICON_STYLE} />
              </IconButton>
              {showDatePicker && (
                <>
                <div className="crm-leads-popover-backdrop" onClick={() => setShowDatePicker(false)} />
                <div className="crm-leads-popover crm-leads-datepicker">
                  <label className="crm-leads-popover-field">
                    <span>From</span>
                    <input type="date" className="crm-input" value={customRange.start} onChange={e => setCustomRange(r => ({ ...r, start: e.target.value }))} />
                  </label>
                  <label className="crm-leads-popover-field">
                    <span>To</span>
                    <input type="date" className="crm-input" value={customRange.end} onChange={e => setCustomRange(r => ({ ...r, end: e.target.value }))} />
                  </label>
                  <button
                    className="crm-btn crm-btn-primary crm-btn-sm"
                    disabled={!customRange.start && !customRange.end}
                    onClick={() => { setDatePeriod('custom'); setShowDatePicker(false); }}
                  >
                    Apply
                  </button>
                </div>
                </>
              )}
            </div>

            <div className="crm-leads-filter-wrap">
              <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm crm-leads-filter-btn" onClick={() => setShowFilterPanel(v => !v)}>
                <IconFilter style={CARD_ACTION_ICON_STYLE} /> Filters
                {(filters.sources.size + filters.campaigns.size + filters.sentiments.size + filters.services.size + filters.stageAges.size) > 0 && (
                  <span className="crm-leads-filter-count">
                    {filters.sources.size + filters.campaigns.size + filters.sentiments.size + filters.services.size + filters.stageAges.size}
                  </span>
                )}
              </button>
              {showFilterPanel && (
                <>
                <div className="crm-leads-popover-backdrop" onClick={() => setShowFilterPanel(false)} />
                <div className="crm-leads-popover crm-leads-filterpanel">
                  {availableSources.length > 0 && (
                    <div className="crm-leads-filter-group">
                      <div className="crm-leads-filter-group-title">Source</div>
                      {availableSources.map(source => (
                        <label key={source} className="crm-leads-filter-option">
                          <input type="checkbox" checked={filters.sources.has(source)} onChange={() => toggleFilter('sources', source)} />
                          {source}
                        </label>
                      ))}
                    </div>
                  )}
                  {availableCampaigns.length > 0 && (
                    <div className="crm-leads-filter-group">
                      <div className="crm-leads-filter-group-title">Campaign</div>
                      {availableCampaigns.map(campaign => (
                        <label key={campaign} className="crm-leads-filter-option">
                          <input type="checkbox" checked={filters.campaigns.has(campaign)} onChange={() => toggleFilter('campaigns', campaign)} />
                          {campaign}
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="crm-leads-filter-group">
                    <div className="crm-leads-filter-group-title">Sentiment</div>
                    <label className="crm-leads-filter-option"><input type="checkbox" checked={filters.sentiments.has('positive')} onChange={() => toggleFilter('sentiments', 'positive')} /> Positive</label>
                    <label className="crm-leads-filter-option"><input type="checkbox" checked={filters.sentiments.has('negative')} onChange={() => toggleFilter('sentiments', 'negative')} /> Negative</label>
                    <label className="crm-leads-filter-option"><input type="checkbox" checked={filters.sentiments.has('none')} onChange={() => toggleFilter('sentiments', 'none')} /> No signal</label>
                  </div>
                  <div className="crm-leads-filter-group">
                    <div className="crm-leads-filter-group-title">Service needed</div>
                    {SERVICE_CATEGORIES.map(c => (
                      <label key={c.key} className="crm-leads-filter-option">
                        <input type="checkbox" checked={filters.services.has(c.key)} onChange={() => toggleFilter('services', c.key)} /> {c.label}
                      </label>
                    ))}
                    <label className="crm-leads-filter-option"><input type="checkbox" checked={filters.services.has('other')} onChange={() => toggleFilter('services', 'other')} /> Other / unclear</label>
                  </div>
                  <div className="crm-leads-filter-group">
                    <div className="crm-leads-filter-group-title">Time in stage</div>
                    {STAGE_AGE_BUCKETS.map(b => (
                      <label key={b.key} className="crm-leads-filter-option">
                        <input type="checkbox" checked={filters.stageAges.has(b.key)} onChange={() => toggleFilter('stageAges', b.key)} /> {b.label}
                      </label>
                    ))}
                  </div>
                </div>
                </>
              )}
            </div>

            {hasActiveFilters && <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
      </div>

      {leads.length === 0 ? (
        <div className="crm-empty-state">
          <IconLeads className="crm-empty-icon" />
          <p>No leads yet. Calls and web-form leads from Call Log land here automatically — or add one by hand with <strong>+ New lead</strong>.</p>
          <button className="crm-btn crm-btn-primary" onClick={() => setShowNew(true)}>+ New lead</button>
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="crm-empty-state">
          <IconLeads className="crm-empty-icon" />
          <p>No leads match the current filters.</p>
          <button className="crm-btn crm-btn-primary" onClick={clearFilters}>Clear filters</button>
        </div>
      ) : (
        <div className="crm-board" ref={boardRef}>
          {sortedStages.map(stage => {
            const stageLeads = grouped[stage.id] || [];
            const isDragTarget = dragOverStage === stage.id && dragLead && (stagePositions[dragLead.id]?.stage_id ?? sortedStages[0]?.id) !== stage.id;
            const isTouchDragTarget = touchOverStage === stage.id && touchDragLead && (stagePositions[touchDragLead.id]?.stage_id ?? sortedStages[0]?.id) !== stage.id;
            const stageValue = stageLeads.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

            return (
              <div
                key={stage.id}
                data-stage-id={stage.id}
                className={`crm-board-column${(isDragTarget || isTouchDragTarget) ? ' drag-over' : ''}`}
                onDragOver={e => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={e => handleDrop(e, stage.id)}
              >
                <div className="crm-board-column-header">
                  <span className="crm-board-column-dot" style={{ background: stage.color }} />
                  <span className="crm-board-column-title">{stage.name}</span>
                  <span className="crm-board-column-count">{stageLeads.length}</span>
                </div>
                {stageValue > 0 && <div className="crm-board-column-value">{formatMoney(stageValue)}</div>}
                <div className="crm-board-cards">
                  {stageLeads.map(lead => (
                    <div
                      key={lead.id}
                      className={`crm-board-card${(dragLead?.id === lead.id || touchDragLead?.id === lead.id) ? ' dragging' : ''}`}
                      draggable={!isTouchDevice()}
                      onDragStart={e => handleDragStart(e, lead)}
                      onDragEnd={handleDragEnd}
                      onPointerDown={isTouchDevice() ? (e => handleCardPointerDown(e, lead)) : undefined}
                      onPointerMove={isTouchDevice() ? handleCardPointerMove : undefined}
                      onPointerUp={isTouchDevice() ? handleCardPointerUp : undefined}
                      onPointerCancel={isTouchDevice() ? handleCardPointerCancel : undefined}
                      onClick={() => {
                        if (touchDragPerformedRef.current) { touchDragPerformedRef.current = false; return; }
                        setSelectedLead(lead);
                      }}
                    >
                      <div className="crm-board-card-top">
                        <div className="crm-board-card-title">{leadLabel(lead)}</div>
                        {sentimentDotClass(lead) && (
                          <span className={`crm-sentiment-dot ${sentimentDotClass(lead)}`} title={`Sentiment: ${lead.transcript_analysis.sentiment.label}`} />
                        )}
                      </div>
                      <div className="crm-board-card-meta">
                        {lead.source_type === 'call' ? 'Call' : 'Form'}
                        {lead.source ? ` · ${lead.source}` : ''}
                      </div>
                      {lead.caller_number && <div className="crm-board-card-phone">{formatPhone(lead.caller_number)}</div>}
                      {summarySnippet(lead) && (
                        <div
                          className={`crm-board-card-summary${expandedSummaries.has(lead.id) ? ' expanded' : ''}`}
                          draggable={false}
                          role="button"
                          tabIndex={0}
                          onClick={e => toggleSummaryExpanded(e, lead.id)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSummaryExpanded(e, lead.id); } }}
                          title={expandedSummaries.has(lead.id) ? 'Click to collapse' : 'Click to expand'}
                        >
                          {expandedSummaries.has(lead.id) ? lead.transcript_analysis.summary : summarySnippet(lead)}
                        </div>
                      )}
                      <div className="crm-board-card-footer">
                        {lead.value != null && <span className="crm-board-card-value">{formatMoney(lead.value)}</span>}
                        {isUrgent(lead) && <StatusPill tone="danger" label="Urgent" title="Urgent — restoration keywords detected" />}
                        {formatDuration(lead.duration_sec) && <span className="crm-board-card-duration">{formatDuration(lead.duration_sec)}</span>}
                        {(() => {
                          const age = daysInStage(stagePositions[lead.id]?.updated_at);
                          return age != null && age > 0
                            ? <span className={`crm-stage-age${age >= 7 ? ' stale' : ''}`}>{age}d in stage</span>
                            : null;
                        })()}
                      </div>

                      <div
                        className="crm-board-card-actions"
                        draggable={false}
                        onMouseDown={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                        onPointerMove={e => e.stopPropagation()}
                      >
                        {lead.caller_number && (
                          <a
                            href={`tel:${lead.caller_number}`}
                            className="ui-icon-btn ui-icon-btn--sm crm-board-card-action-link"
                            aria-label="Call"
                            title="Call"
                            onClick={e => { e.stopPropagation(); quickLogCall(lead); }}
                          >
                            <IconPhone style={CARD_ACTION_ICON_STYLE} />
                          </a>
                        )}
                        <IconButton
                          label={lead.contact_id ? 'Text' : 'Text (link a contact first)'}
                          size="sm"
                          className="crm-board-card-action-btn"
                          disabled={!lead.contact_id}
                          onClick={e => quickText(e, lead)}
                        >
                          <IconMsg style={CARD_ACTION_ICON_STYLE} />
                        </IconButton>
                        <IconButton label="Add note" size="sm" className="crm-board-card-action-btn" onClick={e => openQuickPopover(e, lead, 'note')}>
                          <IconNote style={CARD_ACTION_ICON_STYLE} />
                        </IconButton>
                        <IconButton label="Add task" size="sm" className="crm-board-card-action-btn" onClick={e => openQuickPopover(e, lead, 'task')}>
                          <IconTasks style={CARD_ACTION_ICON_STYLE} />
                        </IconButton>
                      </div>

                      {quickPopover?.leadId === lead.id && (
                        <div
                          className="crm-board-card-popover"
                          draggable={false}
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          onPointerDown={e => e.stopPropagation()}
                          onPointerMove={e => e.stopPropagation()}
                        >
                          {quickPopover.type === 'note' ? (
                            <>
                              <textarea
                                className="crm-input crm-board-card-popover-input"
                                rows={3}
                                autoFocus
                                value={quickDraft}
                                onChange={e => setQuickDraft(e.target.value)}
                                placeholder="Anything worth remembering…"
                              />
                              <div className="crm-board-card-popover-actions">
                                <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={closeQuickPopover}>Cancel</button>
                                <button className="crm-btn crm-btn-primary crm-btn-sm" disabled={quickBusy} onClick={e => saveQuickNote(e, lead)}>
                                  {quickBusy ? 'Saving…' : 'Save'}
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <input
                                type="text"
                                className="crm-input crm-board-card-popover-input"
                                autoFocus
                                value={quickDraft}
                                onChange={e => setQuickDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') submitQuickTask(e, lead); }}
                                placeholder="Follow up call, send estimate…"
                              />
                              <div className="crm-board-card-popover-actions">
                                <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={closeQuickPopover}>Cancel</button>
                                <button className="crm-btn crm-btn-primary crm-btn-sm" disabled={quickBusy || !quickDraft.trim()} onClick={e => submitQuickTask(e, lead)}>
                                  {quickBusy ? 'Adding…' : 'Add'}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {stageLeads.length === 0 && !dragLead && !touchDragLead && <div className="crm-board-empty">No leads</div>}
                  {((dragLead && isDragTarget) || (touchDragLead && isTouchDragTarget)) && stageLeads.length === 0 && <div className="crm-board-drop-hint">Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {touchDragLead && (
        <div ref={ghostElRef} className="crm-board-ghost" aria-hidden="true">
          {leadLabel(touchDragLead)}
        </div>
      )}

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          stages={sortedStages}
          currentStageId={stagePositions[selectedLead.id]?.stage_id ?? sortedStages[0]?.id}
          onClose={() => setSelectedLead(null)}
          onMoveStage={(stageId) => moveLead(selectedLead, stageId)}
          createdBy={employee?.id || null}
          actorId={employee?.id || null}
          onPromoted={() => { setSelectedLead(null); ok('Added as customer'); load(); }}
          onLeadPatched={(patch) => {
            setSelectedLead(prev => (prev ? { ...prev, ...patch } : prev));
            setLeads(prev => prev.map(l => (l.id === selectedLead.id ? { ...l, ...patch } : l)));
          }}
          db={db}
        />
      )}

      {lostPrompt && (
        <LostReasonPrompt
          stage={sortedStages.find(s => s.id === lostPrompt.stageId)}
          onCancel={() => setLostPrompt(null)}
          onConfirm={(reason) => { commitMove(lostPrompt.lead, lostPrompt.stageId, reason); setLostPrompt(null); }}
        />
      )}

      {showNew && (
        <NewLeadPanel
          db={db}
          createdBy={employee?.id || null}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); ok('Lead added'); load(); }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   NewLeadPanel — add a lead by hand (walk-in, referral, a handed-over number)
   ═══════════════════════════════════════════════════ */
function NewLeadPanel({ db, createdBy, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    // Normalize to E.164 (+1XXXXXXXXXX) — the SAME canonical form CallRail
    // ingestion and every other create-contact flow use — so a hand-entered
    // lead matches (never duplicates) an existing contact keyed on the unique
    // phone column. A raw "(801) 555-0100" would otherwise be a different
    // string than CallRail's "+18015550100" and silently split the person.
    const normalized = normalizePhone(phone);
    if (!normalized) { err('Enter a valid phone number'); return; }
    setSaving(true);
    try {
      await db.rpc('create_manual_lead', {
        p_phone: normalized,
        p_name: name.trim() || null,
        p_source: source.trim() || 'Manual entry',
        p_value: value.trim() ? Number(value) : null,
        p_created_by: createdBy,
      });
      onCreated();
    } catch {
      err('Failed to add the lead');
      setSaving(false);
    }
  }, [db, phone, name, source, value, createdBy, onCreated]);

  return (
    <div className="crm-panel-overlay" onClick={onClose}>
      <div className="crm-panel" onClick={e => e.stopPropagation()}>
        <div className="crm-panel-header">
          <div className="crm-panel-title">New lead</div>
          <button className="crm-btn crm-btn-ghost crm-panel-close" onClick={onClose}>Close</button>
        </div>

        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="new-lead-name">Name</label>
          <input id="new-lead-name" className="crm-input" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Homeowner" autoFocus />
        </div>
        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="new-lead-phone">Phone <span className="crm-required">*</span></label>
          <input id="new-lead-phone" className="crm-input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(801) 555-0100" inputMode="tel" />
        </div>
        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="new-lead-source">Source</label>
          <input id="new-lead-source" className="crm-input" value={source} onChange={e => setSource(e.target.value)} placeholder="Referral, Walk-in, Website…" />
        </div>
        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="new-lead-value">Value</label>
          <input id="new-lead-value" className="crm-input" value={value} onChange={e => setValue(e.target.value)} placeholder="0" inputMode="decimal" />
        </div>

        <div className="crm-panel-actions">
          <button className="crm-btn crm-btn-primary" onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add lead'}</button>
          <button className="crm-btn crm-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   LeadDetailPanel — contact info, stage select, activity timeline
   ═══════════════════════════════════════════════════ */
function LeadDetailPanel({ lead, stages, currentStageId, onClose, onMoveStage, createdBy, actorId, onPromoted, onLeadPatched, db }) {
  const [promoting, setPromoting] = useState(false);
  const [promoteName, setPromoteName] = useState('');
  const [promoteEmail, setPromoteEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const [formSchema, setFormSchema] = useState(null);
  const [notes, setNotes] = useState(lead.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [stageHistory, setStageHistory] = useState([]);

  const submittedRows = useMemo(() => formDataRows(formSchema, lead.form_data), [formSchema, lead.form_data]);

  // The full published form schema (for real field labels) — best-effort; a
  // failed/skipped fetch just falls back to humanized field-key labels above.
  useEffect(() => {
    if (lead.source_type !== 'form' || !lead.raw_payload?.form_id) return;
    let cancelled = false;
    (async () => {
      try {
        const formRows = await db.select('form_definitions', `id=eq.${lead.raw_payload.form_id}&select=published_version_id`);
        const versionId = formRows[0]?.published_version_id;
        if (!versionId) return;
        const versionRows = await db.select('form_definition_versions', `id=eq.${versionId}&select=schema`);
        if (!cancelled) setFormSchema(versionRows[0]?.schema || null);
      } catch { /* non-fatal — humanized key labels still render */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, lead.id]);

  // This lead's tasks (any status, mirrors CrmTasks.jsx) + its pipeline-stage
  // move history, so "progress on this lead" is visible without leaving the panel.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTasksLoading(true);
      try {
        const [taskRows, historyRows] = await Promise.all([
          db.rpc('get_crm_tasks', { p_lead_id: lead.id }),
          db.select('lead_stage_history', `lead_id=eq.${lead.id}&select=id,stage_id,from_stage_id,lost_reason,moved_at&order=moved_at.desc&limit=20`),
        ]);
        if (cancelled) return;
        setTasks(taskRows || []);
        setStageHistory(historyRows || []);
      } catch {
        if (!cancelled) { setTasks([]); setStageHistory([]); err('Failed to load tasks and stage history'); }
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [db, lead.id]);

  // Log a click-to-call as an activity event, then let the tel: link dial.
  // Fire-and-forget — never block or fail the call on a logging error.
  const logClickToCall = useCallback((number) => {
    db.insert('system_events', {
      event_type: 'crm_click_to_call',
      entity_type: 'inbound_lead',
      entity_id: lead.id,
      actor_id: actorId,
      payload: { phone: number, contact_id: lead.contact_id || null },
    }).catch(() => {});
  }, [db, lead.id, lead.contact_id, actorId]);

  const promote = useCallback(async () => {
    setSaving(true);
    try {
      await db.rpc('promote_lead_to_contact', {
        p_lead_id: lead.id,
        p_name: promoteName.trim() || null,
        p_email: promoteEmail.trim() || null,
        p_created_by: createdBy,
      });
      onPromoted();
    } catch {
      err('Failed to add the customer');
      setSaving(false);
    }
  }, [db, lead.id, promoteName, promoteEmail, createdBy, onPromoted]);

  const saveNotes = useCallback(async () => {
    setSavingNotes(true);
    try {
      const trimmed = notes.trim() || null;
      await db.update('inbound_leads', `id=eq.${lead.id}`, { notes: trimmed, updated_at: new Date().toISOString() });
      onLeadPatched?.({ notes: trimmed });
      ok('Note saved');
    } catch {
      err('Failed to save the note');
    } finally {
      setSavingNotes(false);
    }
  }, [db, lead.id, notes, onLeadPatched]);

  const addTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    setAddingTask(true);
    try {
      const row = await db.rpc('upsert_crm_task', {
        p_title: title,
        p_contact_id: lead.contact_id || null,
        p_lead_id: lead.id,
        p_created_by: createdBy,
      });
      setTasks(prev => [{ ...row, assignee_name: null, contact_name: null }, ...prev]);
      setNewTaskTitle('');
      ok('Task added');
    } catch {
      err('Failed to add the task');
    } finally {
      setAddingTask(false);
    }
  }, [db, newTaskTitle, lead.contact_id, lead.id, createdBy]);

  const toggleTaskStatus = useCallback(async (task) => {
    const next = task.status === 'done' ? 'open' : 'done';
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: next } : t)));
    try {
      await db.rpc('set_task_status', { p_task_id: task.id, p_status: next, p_actor_id: actorId });
    } catch {
      setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: task.status } : t)));
      err('Failed to update task');
    }
  }, [db, actorId]);

  const stageNameFor = useCallback((stageId) => stages.find(s => s.id === stageId)?.name || 'Unknown stage', [stages]);

  return (
    <div className="crm-panel-overlay" onClick={onClose}>
      <div className="crm-panel" onClick={e => e.stopPropagation()}>
        <div className="crm-panel-header">
          <div>
            <div className="crm-panel-title">
              {lead.contact?.name || !lead.caller_number ? leadLabel(lead) : (
                <a
                  href={`tel:${lead.caller_number}`}
                  className="crm-call-link"
                  onClick={() => logClickToCall(lead.caller_number)}
                >
                  📞 {lead.caller_number}
                </a>
              )}
            </div>
            {lead.contact?.name && lead.caller_number && (
              <a
                href={`tel:${lead.caller_number}`}
                className="crm-call-link crm-panel-subtitle"
                onClick={() => logClickToCall(lead.caller_number)}
              >
                📞 {lead.caller_number}
              </a>
            )}
          </div>
          <button className="crm-btn crm-btn-ghost crm-panel-close" onClick={onClose}>Close</button>
        </div>

        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="lead-stage-select">Stage</label>
          <select
            id="lead-stage-select"
            className="crm-call-row-status"
            value={currentStageId || ''}
            onChange={(e) => onMoveStage(e.target.value)}
          >
            {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="crm-panel-section">
          <div className="crm-panel-row"><span>Source</span><span>{sourceLine(lead)}</span></div>
          {lead.value != null && <div className="crm-panel-row"><span>Value</span><span>{formatMoney(lead.value)}</span></div>}
          <div className="crm-panel-row"><span>Occurred</span><span>{lead.occurred_at ? new Date(lead.occurred_at).toLocaleString() : '—'}</span></div>
        </div>

        {lead.source_type === 'call' && lead.transcript_analysis?.summary && (
          <div className="crm-panel-section">
            <div className="crm-panel-section-title">Summary</div>
            <p className="crm-answer-value">{lead.transcript_analysis.summary}</p>
            <p className="crm-panel-empty" style={{ marginTop: 'var(--space-2)' }}>Generated from the call recording</p>
          </div>
        )}

        {submittedRows.length > 0 && (
          <div className="crm-panel-section">
            <div className="crm-panel-section-title">Submitted answers</div>
            <div className="crm-answer-list">
              {submittedRows.map(row => (
                <div key={row.key}>
                  {row.boolean ? (
                    <p className="crm-answer-value">&#10003; {row.label}</p>
                  ) : (
                    <>
                      <span className="crm-panel-label">{row.label}</span>
                      <p className="crm-answer-value">{row.value}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {!lead.contact_id && (
          <div className="crm-panel-section">
            <div className="crm-panel-section-title">Customer</div>
            {!promoting ? (
              <>
                <p className="crm-panel-empty">
                  {lead.source_type === 'call'
                    ? 'Not a customer yet — raw calls stay contact-free until you qualify them.'
                    : 'Not linked to a contact yet — a lead stays contact-free until you qualify it.'}
                </p>
                <button className="crm-btn crm-btn-primary crm-btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={() => setPromoting(true)}>+ Add as customer</button>
              </>
            ) : (
              <>
                <label className="crm-panel-label" htmlFor="promote-name">Name</label>
                <input id="promote-name" className="crm-input" value={promoteName} onChange={e => setPromoteName(e.target.value)} placeholder="Jane Homeowner" autoFocus />
                <label className="crm-panel-label" htmlFor="promote-email" style={{ marginTop: 'var(--space-3)' }}>Email</label>
                <input id="promote-email" className="crm-input" value={promoteEmail} onChange={e => setPromoteEmail(e.target.value)} placeholder="optional" inputMode="email" />
                <div className="crm-panel-actions" style={{ padding: 0, marginTop: 'var(--space-3)' }}>
                  <button className="crm-btn crm-btn-primary crm-btn-sm" onClick={promote} disabled={saving}>{saving ? 'Adding…' : 'Add as customer'}</button>
                  <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setPromoting(false)}>Cancel</button>
                </div>
                <p className="crm-panel-empty" style={{ marginTop: 'var(--space-3)' }}>
                  {lead.caller_number
                    ? `Creates a contact from this number (${lead.caller_number}) and links this lead to it.`
                    : 'Creates a contact and links this lead to it.'}
                </p>
              </>
            )}
          </div>
        )}

        <div className="crm-panel-section">
          <div className="crm-panel-section-title">Notes</div>
          <textarea
            className="crm-input crm-task-textarea"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything worth remembering about this lead…"
            rows={3}
          />
          <div className="crm-panel-actions" style={{ padding: 0, marginTop: 'var(--space-3)' }}>
            <button
              className="crm-btn crm-btn-primary crm-btn-sm"
              onClick={saveNotes}
              disabled={savingNotes || (notes.trim() || '') === (lead.notes || '')}
            >
              {savingNotes ? 'Saving…' : 'Save note'}
            </button>
          </div>
        </div>

        <div className="crm-panel-section">
          <div className="crm-panel-section-title">Tasks</div>
          {tasksLoading ? (
            <TabLoading />
          ) : (
            <>
              {tasks.length === 0 && <p className="crm-panel-empty">No tasks for this lead yet.</p>}
              {tasks.length > 0 && (
                <ul className="crm-task-list">
                  {tasks.map(task => (
                    <li key={task.id} className={`crm-task-row${task.status === 'done' ? ' done' : ''}`}>
                      <button
                        className={`crm-task-check${task.status === 'done' ? ' checked' : ''}`}
                        onClick={() => toggleTaskStatus(task)}
                        role="checkbox"
                        aria-checked={task.status === 'done'}
                        aria-label={task.status === 'done' ? 'Reopen task' : 'Mark done'}
                      >
                        {task.status === 'done' && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                      <span className="crm-task-body">
                        <span className="crm-task-title">{task.title}</span>
                        {task.due_at && <span className="crm-task-tags"><span className="crm-task-due">Due {new Date(task.due_at).toLocaleDateString()}</span></span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="crm-panel-actions" style={{ padding: 0, marginTop: 'var(--space-3)' }}>
                <input
                  className="crm-input"
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTask(); }}
                  placeholder="Follow up call, send estimate…"
                  aria-label="New task title"
                />
                <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={addTask} disabled={addingTask || !newTaskTitle.trim()}>
                  {addingTask ? 'Adding…' : '+ Add'}
                </button>
              </div>
            </>
          )}
        </div>

        {stageHistory.length > 0 && (
          <div className="crm-panel-section">
            <div className="crm-panel-section-title">Stage history</div>
            {stageHistory.map(h => (
              <div className="crm-panel-row" key={h.id}>
                <span>
                  {h.from_stage_id ? `${stageNameFor(h.from_stage_id)} → ${stageNameFor(h.stage_id)}` : `Entered ${stageNameFor(h.stage_id)}`}
                  {h.lost_reason ? ` — ${h.lost_reason}` : ''}
                </span>
                <span>{h.moved_at ? new Date(h.moved_at).toLocaleDateString() : '—'}</span>
              </div>
            ))}
          </div>
        )}

        <div className="crm-panel-section">
          <div className="crm-panel-section-title">Activity</div>
          {!lead.contact_id ? (
            <p className="crm-panel-empty">No linked contact yet — the activity timeline starts once this lead is matched to a contact.</p>
          ) : (
            <ActivityTimeline contactId={lead.contact_id} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   LostReasonPrompt — required reason before a lead can move to a lost stage
   ═══════════════════════════════════════════════════ */
function LostReasonPrompt({ stage, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const error = lostReasonError(stage, reason);

  const submit = () => {
    setAttempted(true);
    if (error) { err(error); return; }
    onConfirm(reason.trim());
  };

  return (
    <div className="crm-panel-overlay" onClick={onCancel}>
      <div className="crm-panel crm-panel-narrow" onClick={e => e.stopPropagation()}>
        <div className="crm-panel-header">
          <div className="crm-panel-title">Mark lead lost</div>
          <button className="crm-btn crm-btn-ghost crm-panel-close" onClick={onCancel}>Close</button>
        </div>
        <div className="crm-panel-section">
          <label className="crm-panel-label" htmlFor="lost-reason">Reason <span className="crm-required">*</span></label>
          <textarea
            id="lost-reason"
            className="crm-input crm-task-textarea"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Went with competitor, out of budget, no response…"
            rows={3}
            autoFocus
          />
          {attempted && error && <p className="crm-field-error">{error}</p>}
        </div>
        <div className="crm-panel-actions">
          <button className="crm-btn crm-btn-primary" onClick={submit}>Mark lost</button>
          <button className="crm-btn crm-btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
