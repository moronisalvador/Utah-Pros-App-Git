/**
 * ════════════════════════════════════════════════
 * FILE: CrmSettings.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The CRM control panel. Three things live here: (1) the Leads pipeline's
 *   columns — add a stage, rename one, change its color, move it left/right,
 *   mark it "won"/"lost", or delete it; (2) on/off switches for the four
 *   automatic follow-ups (text a new lead, text back a missed call, email a
 *   lead that's gone quiet, email a review request when a job finishes); and
 *   (3) a title for each CallRail tracking number (which campaign it belongs
 *   to) — the Call Log shows that title in place of the raw phone number.
 *   Every change shows up immediately, no code deploy needed.
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
 *   Data:      reads  → pipeline_stages (get_pipeline_stages RPC),
 *                       automation_settings (get_automation_settings RPC),
 *                       crm_tracking_numbers (get_tracking_numbers RPC)
 *              writes → pipeline_stages (upsert_pipeline_stage /
 *                       delete_pipeline_stage RPCs), automation_settings
 *                       (set_automation_setting RPC), crm_tracking_numbers
 *                       (set_tracking_number_label RPC)
 *
 * NOTES / GOTCHAS:
 *   - Reordering swaps sort_order between the moved stage and its neighbor
 *     via two upsert_pipeline_stage calls — simpler and more reliable on
 *     gloved/mobile input than drag-and-drop for an admin settings screen.
 *   - Deleting a stage with leads still on it is refused server-side
 *     (delete_pipeline_stage) — the error message is surfaced as a toast.
 *   - The two SMS automations stay dark (no texts sent) until the global SMS
 *     switch is turned on in Phase 4b, even when toggled on here — the banner
 *     says so. The two email automations are live once toggled on. The actual
 *     sending is done by the run-automations cron worker, not this page.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sortStages } from '@/lib/crmPipeline';
import { formatPhone } from '@/lib/phone';
import { ok, err } from '@/lib/toast';

const EMPTY_FORM = { name: '', color: '#6366f1', is_won: false, is_lost: false };

// The four fixed automations, in display order. `channel` drives the badge and
// which ones are held dark by the SMS kill-switch.
const AUTOMATIONS = [
  { key: 'speed_to_lead_enabled',        channel: 'sms',   title: 'Speed-to-lead text',        desc: 'Text a new lead within seconds of an inbound call or form.' },
  { key: 'missed_call_textback_enabled', channel: 'sms',   title: 'Missed-call text-back',     desc: 'Text back when a tracking-number call goes unanswered.' },
  { key: 'no_response_followup_enabled', channel: 'email', title: 'No-response follow-up',      desc: 'Email a lead that has gone quiet for a few days.' },
  { key: 'review_request_enabled',       channel: 'email', title: 'Job-complete review request', desc: 'Email a review request when a job is marked complete.' },
];

export default function CrmSettings() {
  const { db } = useAuth();
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [automations, setAutomations] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const nameRef = useRef(null);

  // Tracking numbers (CallRail) + their campaign titles.
  const [trackingNumbers, setTrackingNumbers] = useState([]);
  const [titleDrafts, setTitleDrafts] = useState({}); // tracking_number → draft title
  const [savingNumber, setSavingNumber] = useState(null);

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

  const loadTracking = useCallback(async () => {
    try {
      const rows = await db.rpc('get_tracking_numbers', {});
      setTrackingNumbers(rows || []);
      setTitleDrafts(Object.fromEntries((rows || []).map(r => [r.tracking_number, r.label || ''])));
    } catch {
      err('Failed to load tracking numbers');
    }
  }, [db]);

  const loadAutomations = useCallback(async () => {
    try {
      const row = await db.rpc('get_automation_settings', {});
      // The RPC returns a single automation_settings row (RETURNS the table type).
      setAutomations(Array.isArray(row) ? row[0] : row);
    } catch {
      err('Failed to load automation settings');
    }
  }, [db]);

  useEffect(() => { load(); loadTracking(); loadAutomations(); }, [load, loadTracking, loadAutomations]);

  const toggleAutomation = async (key) => {
    if (!automations) return;
    const next = !automations[key];
    setSavingKey(key);
    // Optimistic — reverts on failure.
    setAutomations(a => ({ ...a, [key]: next }));
    try {
      const row = await db.rpc('set_automation_setting', { p_key: key, p_value: next });
      setAutomations(Array.isArray(row) ? row[0] : row);
      ok(next ? 'Automation turned on' : 'Automation turned off');
    } catch (e) {
      setAutomations(a => ({ ...a, [key]: !next }));
      err(e.message || 'Failed to update automation');
    } finally {
      setSavingKey(null);
    }
  };

  const saveTitle = async (number) => {
    setSavingNumber(number);
    try {
      await db.rpc('set_tracking_number_label', { p_tracking_number: number, p_label: (titleDrafts[number] || '').trim() });
      ok('Tracking-number title saved');
      loadTracking();
    } catch (e) {
      err(e.message || 'Failed to save title');
    } finally {
      setSavingNumber(null);
    }
  };

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
        <p className="crm-page-subtitle">Configure the Leads pipeline stages, the automatic follow-ups, and the titles for your CallRail tracking numbers.</p>
      </div>

      {/* ─── SECTION: Automations ────────────── */}
      <div className="crm-stage-list crm-automation-list">
        <div className="crm-stage-list-header"><span>Automations</span></div>

        {automations && automations.sms_sending_enabled === false && (
          <div className="crm-automation-banner">
            Text messaging is off globally, so the two SMS automations stay dark even when switched on
            here. They go live once text sending is enabled (Phase&nbsp;4b, after carrier approval).
            The two email automations work as soon as they're on.
          </div>
        )}

        {!automations ? (
          <div className="crm-stage-row"><span className="crm-stage-row-name">Loading automations…</span></div>
        ) : AUTOMATIONS.map((a) => {
          const on = !!automations[a.key];
          const dark = a.channel === 'sms' && !automations.sms_sending_enabled;
          return (
            <div key={a.key} className="crm-stage-row crm-automation-row">
              <div className="crm-automation-info">
                <div className="crm-automation-title-row">
                  <span className="crm-automation-title">{a.title}</span>
                  <span className={`crm-badge crm-automation-channel crm-automation-channel-${a.channel}`}>{a.channel === 'sms' ? 'Text' : 'Email'}</span>
                  {on && dark && <span className="crm-automation-dark">dark until SMS is on</span>}
                </div>
                <span className="crm-automation-desc">{a.desc}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${on ? 'Turn off' : 'Turn on'} ${a.title}`}
                className={`crm-automation-toggle${on ? ' on' : ''}`}
                disabled={savingKey === a.key}
                onClick={() => toggleAutomation(a.key)}
              >
                <span className="crm-automation-knob" />
              </button>
            </div>
          );
        })}
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

      {/* ─── SECTION: Tracking numbers ────────────── */}
      <div className="crm-stage-list crm-tracking-list">
        <div className="crm-stage-list-header"><span>Tracking numbers</span></div>
        <p className="crm-tracking-hint">
          Give each CallRail tracking number a title — the campaign it belongs to. The title shows on
          the Call Log in place of the raw number. Numbers appear here automatically after their first call.
        </p>

        {trackingNumbers.length === 0 ? (
          <div className="crm-stage-row"><span className="crm-stage-row-name">No tracking numbers yet.</span></div>
        ) : trackingNumbers.map((tn) => (
          <div key={tn.tracking_number} className="crm-stage-row">
            <span className="crm-tracking-number">{formatPhone(tn.tracking_number)}</span>
            <span className="crm-tracking-count">{tn.call_count} call{tn.call_count === 1 ? '' : 's'}</span>
            <input
              className="crm-integration-input crm-tracking-title-input"
              type="text"
              placeholder="Campaign title (e.g. Google Ads — Landing 2)"
              value={titleDrafts[tn.tracking_number] ?? ''}
              onChange={(e) => setTitleDrafts(d => ({ ...d, [tn.tracking_number]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(tn.tracking_number); }}
            />
            <div className="crm-stage-row-actions">
              <button
                className="crm-btn crm-btn-primary"
                onClick={() => saveTitle(tn.tracking_number)}
                disabled={savingNumber === tn.tracking_number || (titleDrafts[tn.tracking_number] ?? '') === (tn.label || '')}
              >
                {savingNumber === tn.tracking_number ? 'Saving…' : 'Save'}
              </button>
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
