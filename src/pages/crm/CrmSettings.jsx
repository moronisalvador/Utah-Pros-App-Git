/**
 * ════════════════════════════════════════════════
 * FILE: CrmSettings.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Where the Leads pipeline's columns get set up — add a stage, rename
 *   one, change its color, move it left/right, mark it as a "won" or
 *   "lost" stage, or delete it. Every change shows up on the Leads board
 *   immediately, with no code deploy needed.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/settings
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db), @/lib/crmPipeline
 *              (sortStages)
 *   Data:      reads  → pipeline_stages (get_pipeline_stages RPC)
 *              writes → pipeline_stages (upsert_pipeline_stage /
 *                       delete_pipeline_stage RPCs)
 *
 * NOTES / GOTCHAS:
 *   - Reordering swaps sort_order between the moved stage and its neighbor
 *     via two upsert_pipeline_stage calls — simpler and more reliable on
 *     gloved/mobile input than drag-and-drop for an admin settings screen.
 *   - Deleting a stage with leads still on it is refused server-side
 *     (delete_pipeline_stage) — the error message is surfaced as a toast.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sortStages } from '@/lib/crmPipeline';

const ok  = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } }));
const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));

const EMPTY_FORM = { name: '', color: '#6366f1', is_won: false, is_lost: false };

export default function CrmSettings() {
  const { db } = useAuth();
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const nameRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_pipeline_stages', {});
      setStages(sortStages(rows || []));
    } catch {
      err('Failed to load pipeline stages');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const startAdd = () => { setEditingId('new'); setForm(EMPTY_FORM); setTimeout(() => nameRef.current?.focus(), 50); };
  const startEdit = (stage) => {
    setEditingId(stage.id);
    setForm({ name: stage.name, color: stage.color, is_won: stage.is_won, is_lost: stage.is_lost });
    setTimeout(() => nameRef.current?.focus(), 50);
  };
  const cancelEdit = () => { setEditingId(null); setForm(EMPTY_FORM); };

  const handleSave = async () => {
    if (!form.name.trim()) { err('Stage name is required'); return; }
    setSaving(true);
    try {
      await db.rpc('upsert_pipeline_stage', {
        p_id: editingId === 'new' ? null : editingId,
        p_name: form.name.trim(),
        p_color: form.color,
        p_is_won: form.is_won,
        p_is_lost: form.is_lost,
      });
      ok(editingId === 'new' ? 'Stage added' : 'Stage updated');
      cancelEdit();
      load();
    } catch (e) {
      err(e.message || 'Failed to save stage');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (stageId) => {
    try {
      await db.rpc('delete_pipeline_stage', { p_stage_id: stageId });
      ok('Stage deleted');
      setConfirmDeleteId(null);
      load();
    } catch (e) {
      err(e.message || 'Failed to delete stage — move its leads first');
      setConfirmDeleteId(null);
    }
  };

  const move = async (stage, direction) => {
    const sorted = sortStages(stages);
    const index = sorted.findIndex(s => s.id === stage.id);
    const swapWith = sorted[index + direction];
    if (!swapWith) return;

    try {
      await Promise.all([
        db.rpc('upsert_pipeline_stage', { p_id: stage.id, p_name: stage.name, p_color: stage.color, p_sort_order: swapWith.sort_order, p_is_won: stage.is_won, p_is_lost: stage.is_lost }),
        db.rpc('upsert_pipeline_stage', { p_id: swapWith.id, p_name: swapWith.name, p_color: swapWith.color, p_sort_order: stage.sort_order, p_is_won: swapWith.is_won, p_is_lost: swapWith.is_lost }),
      ]);
      load();
    } catch {
      err('Failed to reorder stages');
    }
  };

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  const sorted = sortStages(stages);

  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">Settings</h1>
        <p className="crm-page-subtitle">Add, rename, recolor, reorder, or retire Leads pipeline stages.</p>
      </div>

      <div className="crm-stage-list">
        <div className="crm-stage-list-header">
          <span>Stage</span>
          <button className="crm-btn crm-btn-primary" onClick={startAdd} disabled={editingId === 'new'}>+ Add stage</button>
        </div>

        {editingId === 'new' && (
          <StageEditRow form={form} setForm={setForm} onSave={handleSave} onCancel={cancelEdit} saving={saving} nameRef={nameRef} />
        )}

        {sorted.map((stage, index) => editingId === stage.id ? (
          <StageEditRow key={stage.id} form={form} setForm={setForm} onSave={handleSave} onCancel={cancelEdit} saving={saving} nameRef={nameRef} />
        ) : (
          <div key={stage.id} className="crm-stage-row">
            <span className="crm-board-column-dot" style={{ background: stage.color }} />
            <span className="crm-stage-row-name">{stage.name}</span>
            {stage.is_won && <span className="crm-badge crm-badge-won">Won</span>}
            {stage.is_lost && <span className="crm-badge crm-badge-lost">Lost</span>}
            <div className="crm-stage-row-actions">
              <button className="crm-btn crm-btn-ghost" onClick={() => move(stage, -1)} disabled={index === 0} title="Move left">←</button>
              <button className="crm-btn crm-btn-ghost" onClick={() => move(stage, 1)} disabled={index === sorted.length - 1} title="Move right">→</button>
              <button className="crm-btn crm-btn-ghost" onClick={() => startEdit(stage)}>Edit</button>
              {confirmDeleteId === stage.id ? (
                <button className="crm-btn crm-btn-danger" onClick={() => handleDelete(stage.id)} onBlur={() => setConfirmDeleteId(null)}>Confirm delete?</button>
              ) : (
                <button className="crm-btn crm-btn-ghost" onClick={() => setConfirmDeleteId(stage.id)}>Delete</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageEditRow({ form, setForm, onSave, onCancel, saving, nameRef }) {
  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(); } if (e.key === 'Escape') onCancel(); };

  return (
    <div className="crm-stage-row crm-stage-row-editing">
      <input
        type="color"
        value={form.color}
        onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
        className="crm-stage-color-input"
      />
      <input
        ref={nameRef}
        className="crm-integration-input crm-stage-name-input"
        type="text"
        placeholder="Stage name"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        onKeyDown={handleKeyDown}
      />
      <label className="crm-stage-checkbox">
        <input type="checkbox" checked={form.is_won} onChange={e => setForm(f => ({ ...f, is_won: e.target.checked, is_lost: e.target.checked ? false : f.is_lost }))} /> Won
      </label>
      <label className="crm-stage-checkbox">
        <input type="checkbox" checked={form.is_lost} onChange={e => setForm(f => ({ ...f, is_lost: e.target.checked, is_won: e.target.checked ? false : f.is_won }))} /> Lost
      </label>
      <div className="crm-stage-row-actions">
        <button className="crm-btn crm-btn-primary" onClick={onSave} disabled={saving}>Save</button>
        <button className="crm-btn crm-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
