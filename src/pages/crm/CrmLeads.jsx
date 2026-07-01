/**
 * ════════════════════════════════════════════════
 * FILE: CrmLeads.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The Leads pipeline board — a Kanban like the one on the Production page,
 *   but for sales leads instead of jobs. Every non-spam call or web-form
 *   lead shows up as a card in a column (New, Contacted, Qualified, ...),
 *   drag a card to a new column on desktop to move it forward. Tap a card
 *   to open its details: who it is, how to reach them, a dropdown to change
 *   its stage (works on touch devices too), and a combined timeline of
 *   every call, text, note, and estimate tied to that contact.
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
 *              writes → lead_pipeline_stage (via move_lead_to_stage RPC)
 *
 * NOTES / GOTCHAS:
 *   - A lead with no lead_pipeline_stage row yet reads as sitting in the
 *     first stage (lowest sort_order) — see src/lib/crmPipeline.js's
 *     groupLeadsByStage(), which the DB-side RPCs mirror.
 *   - Drag-and-drop is desktop-only (same isTouchDevice() gate as
 *     Production.jsx's JobCard) — on touch devices, move a lead via the
 *     stage <select> in the detail panel instead.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { IconLeads } from '@/lib/crmIcons';
import { sortStages, groupLeadsByStage, weightedPipelineValue } from '@/lib/crmPipeline';

const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));

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

  const [dragLead, setDragLead] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);

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

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  return (
    <div className="crm-page crm-page-wide">
      <div className="crm-page-header">
        <h1 className="crm-page-title">Leads</h1>
        <p className="crm-page-subtitle">
          {leads.length} lead{leads.length === 1 ? '' : 's'} in pipeline
          {pipelineValue.total > 0 ? ` · ${formatMoney(pipelineValue.total)} weighted` : ''}
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="crm-empty-state">
          <IconLeads className="crm-empty-icon" />
          <p>No leads yet. New calls and web-form leads from Call Log will show up here.</p>
        </div>
      ) : (
        <div className="crm-board">
          {sortedStages.map(stage => {
            const stageLeads = grouped[stage.id] || [];
            const isDragTarget = dragOverStage === stage.id && dragLead && (stagePositions[dragLead.id]?.stage_id ?? sortedStages[0]?.id) !== stage.id;
            const stageValue = stageLeads.reduce((sum, l) => sum + (Number(l.value) || 0), 0);

            return (
              <div
                key={stage.id}
                className={`crm-board-column${isDragTarget ? ' drag-over' : ''}`}
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
                      className={`crm-board-card${dragLead?.id === lead.id ? ' dragging' : ''}`}
                      draggable={!isTouchDevice()}
                      onDragStart={e => handleDragStart(e, lead)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setSelectedLead(lead)}
                    >
                      <div className="crm-board-card-title">{leadLabel(lead)}</div>
                      <div className="crm-board-card-meta">
                        {lead.source_type === 'call' ? 'Call' : 'Form'}
                        {lead.source ? ` · ${lead.source}` : ''}
                      </div>
                      {lead.value != null && <div className="crm-board-card-value">{formatMoney(lead.value)}</div>}
                    </div>
                  ))}
                  {stageLeads.length === 0 && !dragLead && <div className="crm-board-empty">No leads</div>}
                  {dragLead && isDragTarget && stageLeads.length === 0 && <div className="crm-board-drop-hint">Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedLead && (
        <LeadDetailPanel
          lead={selectedLead}
          stages={sortedStages}
          currentStageId={stagePositions[selectedLead.id]?.stage_id ?? sortedStages[0]?.id}
          onClose={() => setSelectedLead(null)}
          onMoveStage={(stageId) => moveLead(selectedLead, stageId)}
          db={db}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   LeadDetailPanel — contact info, stage select, activity timeline
   ═══════════════════════════════════════════════════ */
function LeadDetailPanel({ lead, stages, currentStageId, onClose, onMoveStage, db }) {
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

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
