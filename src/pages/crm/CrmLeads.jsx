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
 *   and a combined timeline of every call, text, note, and estimate tied to
 *   that contact.
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
 *              groupLeadsByStage, weightedPipelineValue)
 *   Data:      reads  → pipeline_stages (get_pipeline_stages RPC),
 *                       inbound_leads (embeds contacts), lead_pipeline_stage,
 *                       get_contact_activity RPC (opened lead's timeline)
 *              writes → lead_pipeline_stage (via move_lead_to_stage RPC),
 *                       inbound_leads + contacts (via create_manual_lead RPC —
 *                       the "+ New lead" manual-entry button; and
 *                       promote_lead_to_contact — the "+ Add as customer" action
 *                       that turns a raw lead into a linked contact)
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
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IconLeads } from '@/lib/crmIcons';
import { sortStages, groupLeadsByStage, weightedPipelineValue } from '@/lib/crmPipeline';
import { normalizePhone } from '@/lib/phone';

const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));
const ok = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } }));

const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

function formatMoney(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  return `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function leadLabel(lead) {
  return lead.contact?.name || lead.caller_number || (lead.source_type === 'form' ? 'Web form lead' : 'Unknown caller');
}

export default function CrmLeads() {
  const { db, employee } = useAuth();
  const [stages, setStages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [stagePositions, setStagePositions] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const [dragLead, setDragLead] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);

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
        db.select('lead_pipeline_stage', 'select=lead_id,stage_id'),
      ]);
      setStages(stageRows || []);
      setLeads(leadRows || []);
      const positions = {};
      for (const row of positionRows || []) positions[row.lead_id] = { stage_id: row.stage_id };
      setStagePositions(positions);
    } catch {
      err('Failed to load the Leads pipeline');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const sortedStages = useMemo(() => sortStages(stages), [stages]);
  const grouped = useMemo(() => groupLeadsByStage(leads, stages, stagePositions), [leads, stages, stagePositions]);
  const pipelineValue = useMemo(() => weightedPipelineValue(leads, stages, stagePositions), [leads, stages, stagePositions]);

  const moveLead = useCallback(async (lead, stageId) => {
    const prevStageId = stagePositions[lead.id]?.stage_id ?? sortedStages[0]?.id;
    if (stageId === prevStageId) return;

    setStagePositions(prev => ({ ...prev, [lead.id]: { stage_id: stageId } }));
    try {
      await db.rpc('move_lead_to_stage', { p_lead_id: lead.id, p_stage_id: stageId, p_moved_by: employee?.id || null });
    } catch {
      setStagePositions(prev => ({ ...prev, [lead.id]: { stage_id: prevStageId } }));
      err('Failed to move lead — reverted.');
    }
  }, [db, employee, stagePositions, sortedStages]);

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
              {leads.length} lead{leads.length === 1 ? '' : 's'} in pipeline
              {pipelineValue.total > 0 ? ` · ${formatMoney(pipelineValue.total)} weighted` : ''}
            </p>
          </div>
          <button className="crm-btn crm-btn-primary" onClick={() => setShowNew(true)}>+ New lead</button>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="crm-empty-state">
          <IconLeads className="crm-empty-icon" />
          <p>No leads yet. Calls and web-form leads from Call Log land here automatically — or add one by hand with <strong>+ New lead</strong>.</p>
          <button className="crm-btn crm-btn-primary" onClick={() => setShowNew(true)}>+ New lead</button>
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
                      <div className="crm-board-card-title">{leadLabel(lead)}</div>
                      <div className="crm-board-card-meta">
                        {lead.source_type === 'call' ? 'Call' : 'Form'}
                        {lead.source ? ` · ${lead.source}` : ''}
                      </div>
                      {lead.value != null && <div className="crm-board-card-value">{formatMoney(lead.value)}</div>}
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
          onPromoted={() => { setSelectedLead(null); ok('Added as customer'); load(); }}
          db={db}
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
function LeadDetailPanel({ lead, stages, currentStageId, onClose, onMoveStage, createdBy, onPromoted, db }) {
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [promoteName, setPromoteName] = useState('');
  const [promoteEmail, setPromoteEmail] = useState('');
  const [saving, setSaving] = useState(false);

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

  const loadActivity = useCallback(async () => {
    if (!lead.contact_id) return;
    setLoadingActivity(true);
    try {
      const rows = await db.rpc('get_contact_activity', { p_contact_id: lead.contact_id });
      setActivity(rows || []);
    } catch {
      err('Failed to load contact activity');
    } finally {
      setLoadingActivity(false);
    }
  }, [lead.contact_id, db]);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  return (
    <div className="crm-panel-overlay" onClick={onClose}>
      <div className="crm-panel" onClick={e => e.stopPropagation()}>
        <div className="crm-panel-header">
          <div>
            <div className="crm-panel-title">{leadLabel(lead)}</div>
            {lead.caller_number && <div className="crm-panel-subtitle">{lead.caller_number}</div>}
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
          <div className="crm-panel-row"><span>Source</span><span>{lead.source_type === 'call' ? 'Call' : 'Web form'}{lead.source ? ` · ${lead.source}` : ''}{lead.campaign ? ` · ${lead.campaign}` : ''}</span></div>
          {lead.value != null && <div className="crm-panel-row"><span>Value</span><span>{formatMoney(lead.value)}</span></div>}
          <div className="crm-panel-row"><span>Occurred</span><span>{lead.occurred_at ? new Date(lead.occurred_at).toLocaleString() : '—'}</span></div>
        </div>

        {!lead.contact_id && (
          <div className="crm-panel-section">
            {!promoting ? (
              <>
                <p className="crm-panel-empty">Not a customer yet — raw calls stay contact-free until you qualify them.</p>
                <button className="crm-btn crm-btn-primary" onClick={() => setPromoting(true)}>+ Add as customer</button>
              </>
            ) : (
              <>
                <label className="crm-panel-label" htmlFor="promote-name">Name</label>
                <input id="promote-name" className="crm-input" value={promoteName} onChange={e => setPromoteName(e.target.value)} placeholder="Jane Homeowner" autoFocus />
                <label className="crm-panel-label" htmlFor="promote-email" style={{ marginTop: 'var(--space-3)' }}>Email</label>
                <input id="promote-email" className="crm-input" value={promoteEmail} onChange={e => setPromoteEmail(e.target.value)} placeholder="optional" inputMode="email" />
                <div className="crm-panel-actions" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <button className="crm-btn crm-btn-primary" onClick={promote} disabled={saving}>{saving ? 'Adding…' : 'Add as customer'}</button>
                  <button className="crm-btn crm-btn-ghost" onClick={() => setPromoting(false)}>Cancel</button>
                </div>
                <p className="crm-panel-empty">Creates a contact from this number ({lead.caller_number}) and links this lead to it.</p>
              </>
            )}
          </div>
        )}

        <div className="crm-panel-section">
          <div className="crm-panel-section-title">Activity</div>
          {!lead.contact_id ? (
            <p className="crm-panel-empty">No linked contact yet — the activity timeline starts once this lead is matched to a contact.</p>
          ) : loadingActivity ? (
            <p className="crm-panel-empty">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="crm-panel-empty">No activity recorded yet.</p>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
