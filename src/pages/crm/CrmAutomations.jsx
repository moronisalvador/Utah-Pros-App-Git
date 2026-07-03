/**
 * ════════════════════════════════════════════════
 * FILE: CrmAutomations.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The automation "recipe" builder. You build a rule as a simple straight line:
 *   pick ONE thing that happens in the business (the trigger — a new lead, a job
 *   changing status, a payment, …), optionally add "only if…" filters that must
 *   all be true, then list the actions to run in order (send an email, send a
 *   text, enroll the person in a drip sequence, or make a task) — each after an
 *   optional wait. Turn a rule on or off with one switch. The page also shows a
 *   log of every time a rule has fired. Sending is done by the background engine,
 *   never here, and always through the one consent-checked door — a text stays
 *   held while the SMS switch is off, it is never forced out.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/automations
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *                 and the feature:crm_automations sub-flag.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db, employee)
 *   Data:      reads  → crm_automations (get_crm_automations RPC), its runs
 *                       (get_automation_runs RPC), crm_sequences (get_sequences,
 *                       for the enroll action), automation_settings
 *                       (get_automation_settings, for the S1 collision hint)
 *              writes → crm_automations (upsert_crm_automation / set_automation_enabled
 *                       / delete_crm_automation RPCs)
 *
 * NOTES / GOTCHAS:
 *   - LINEAR only by design (no branching / node-graph, no new dependency). The
 *     reorder is native up/down, mirroring CrmSequences' step editor.
 *   - S1 guard: the RPC refuses to save/enable a rule whose trigger duplicates an
 *     ENABLED fixed automation (speed-to-lead / missed-call / no-response /
 *     review). This page also warns client-side (triggerCollision) for a nicer
 *     message, but the server RPC is the real enforcement.
 *   - The trigger list is only event types the RPC layer actually emits (the bus
 *     is RPC-fed) — a rule on an unemitted trigger would simply never fire.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const err = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'error' } }));
const ok = (message) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type: 'success' } }));

// ─── SECTION: Vocabulary (triggers, operators, actions) ──────────────
// Only event types the RPC layer actually emits (system_events is RPC-fed).
const TRIGGERS = [
  { value: 'crm_lead_created',        label: 'New lead created (call or form)' },
  { value: 'crm_lead_created_manual', label: 'Lead created manually' },
  { value: 'crm_lead_promoted',       label: 'Lead promoted / won' },
  { value: 'crm_lead_stage_changed',  label: 'Lead stage changed' },
  { value: 'crm_lead_status_updated', label: 'Lead status updated' },
  { value: 'crm_call_transcribed',    label: 'Call transcribed' },
  { value: 'job.created',             label: 'Job created' },
  { value: 'job.status_changed',      label: 'Job status changed' },
  { value: 'job.phase_changed',       label: 'Job phase changed' },
  { value: 'job.payment_received',    label: 'Payment received' },
  { value: 'claim.created',           label: 'Claim created' },
  { value: 'esign.signed',            label: 'Document e-signed' },
];
const triggerLabel = (v) => TRIGGERS.find((t) => t.value === v)?.label || v;

// A few suggested condition fields per trigger (payload + entity), offered as a
// datalist hint — the field is still free text, so anything on the event works.
const FIELD_SUGGESTIONS = {
  crm_lead_created:        ['source_type', 'lead_status', 'duration_sec', 'spam_flag'],
  crm_lead_created_manual: ['source_type', 'lead_status'],
  crm_lead_promoted:       ['lead_status', 'contact_id'],
  crm_lead_stage_changed:  ['from_stage', 'to_stage', 'lead_status'],
  'job.status_changed':    ['status', 'to_status', 'from_status'],
  'job.phase_changed':     ['to_phase', 'from_phase'],
  'job.payment_received':  ['amount', 'status'],
};
const fieldsFor = (trigger) => FIELD_SUGGESTIONS[trigger] || ['status', 'source_type'];

const OPERATORS = [
  { value: 'eq',           label: 'equals' },
  { value: 'ne',           label: 'not equals' },
  { value: 'gt',           label: 'greater than' },
  { value: 'gte',          label: 'at least' },
  { value: 'lt',           label: 'less than' },
  { value: 'lte',          label: 'at most' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'in',           label: 'in (comma list)' },
  { value: 'not_in',       label: 'not in (comma list)' },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];
const NO_VALUE_OPS = ['is_empty', 'is_not_empty'];
const LIST_OPS = ['in', 'not_in'];

const ACTION_TYPES = [
  { value: 'send_email',      label: 'Send email' },
  { value: 'send_sms',        label: 'Send text (SMS)' },
  { value: 'enroll_sequence', label: 'Enroll in sequence' },
  { value: 'create_task',     label: 'Create task' },
];
const actionLabel = (v) => ACTION_TYPES.find((a) => a.value === v)?.label || v;

const newAction = (type = 'send_email') => ({ type, delay_hours: 0, config: {} });
const newCondition = () => ({ field: '', op: 'eq', value: '' });
const blankDraft = () => ({
  name: '', description: '', trigger_event_type: 'crm_lead_created',
  enabled: false, conditions: [], actions: [newAction('send_email')],
});

// Mirror of crm_fixed_automation_conflict() — a live enabled fixed automation
// blocks the same trigger. Used only for the client-side warning; the RPC is the
// real guard.
const FIXED_TRIGGER_MAP = {
  speed_to_lead_enabled:        ['crm_lead_created', 'crm_lead_created_manual'],
  missed_call_textback_enabled: ['crm_lead_created', 'crm_lead_created_manual'],
  review_request_enabled:       ['job.phase_changed', 'job.status_changed'],
};
function triggerCollision(settings, trigger) {
  if (!settings) return false;
  return Object.entries(FIXED_TRIGGER_MAP).some(([flag, triggers]) => settings[flag] && triggers.includes(trigger));
}

const delayLabel = (h) => {
  const n = Number(h) || 0;
  if (n === 0) return 'immediately';
  if (n % 24 === 0) return `${n / 24} day${n / 24 === 1 ? '' : 's'} later`;
  return `${n} hour${n === 1 ? '' : 's'} later`;
};

// ─── SECTION: Serialization (editor shape → RPC params) ──────────────
function serializeCondition(c) {
  const field = (c.field || '').trim();
  if (!field || !c.op) return null;
  if (NO_VALUE_OPS.includes(c.op)) return { field, op: c.op };
  if (LIST_OPS.includes(c.op)) {
    return { field, op: c.op, value: String(c.value || '').split(',').map((v) => v.trim()).filter(Boolean) };
  }
  return { field, op: c.op, value: c.value ?? '' };
}

function serializeAction(a) {
  const c = a.config || {};
  const out = { type: a.type, delay_hours: Math.max(0, Math.trunc(Number(a.delay_hours) || 0)) };
  if (a.type === 'send_email') out.config = { subject: (c.subject || '').trim(), body: (c.body || '').trim() };
  else if (a.type === 'send_sms') out.config = { body: (c.body || '').trim() };
  else if (a.type === 'enroll_sequence') out.config = { sequence_id: c.sequence_id || null };
  else if (a.type === 'create_task') out.config = {
    title: (c.title || '').trim(),
    notes: (c.notes || '').trim() || null,
    due_hours: c.due_hours !== '' && c.due_hours != null ? Math.max(0, Math.trunc(Number(c.due_hours) || 0)) : null,
  };
  else out.config = {};
  return out;
}

function validate(draft, settings) {
  if (!draft.name.trim()) return 'Give the automation a name';
  if (!draft.trigger_event_type) return 'Pick a trigger';
  if (!draft.actions.length) return 'Add at least one action';
  for (let i = 0; i < draft.actions.length; i++) {
    const a = draft.actions[i]; const c = a.config || {};
    if ((a.type === 'send_email' || a.type === 'send_sms') && !(c.body || '').trim()) return `Action ${i + 1} needs a message body`;
    if (a.type === 'send_email' && !(c.subject || '').trim()) return `Action ${i + 1} (email) needs a subject`;
    if (a.type === 'enroll_sequence' && !c.sequence_id) return `Action ${i + 1} needs a sequence`;
    if (a.type === 'create_task' && !(c.title || '').trim()) return `Action ${i + 1} needs a task title`;
  }
  if (draft.enabled && triggerCollision(settings, draft.trigger_event_type)) {
    return 'That trigger is already handled by an enabled fixed automation — turn one off, or save this rule turned off.';
  }
  return null;
}

export default function CrmAutomations() {
  const { db, employee } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [automations, setAutomations] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [autos, seqs, sett] = await Promise.all([
        db.rpc('get_crm_automations', {}),
        db.rpc('get_sequences', {}).catch(() => []),
        db.rpc('get_automation_settings', {}).catch(() => null),
      ]);
      setAutomations(autos || []);
      setSequences(seqs || []);
      setSettings(sett || null);
    } catch {
      err('Failed to load automations');
      setAutomations([]);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const selected = automations.find((a) => a.id === selectedId) || null;

  const loadRuns = useCallback(async (automationId) => {
    if (!automationId) { setRuns([]); return; }
    setRunsLoading(true);
    try {
      const rows = await db.rpc('get_automation_runs', { p_automation_id: automationId, p_limit: 50 });
      setRuns(rows || []);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [db]);

  useEffect(() => { if (selectedId && !editing) loadRuns(selectedId); }, [selectedId, editing, loadRuns]);

  // ─── SECTION: Event handlers ──────────────
  const startNew = () => { setSelectedId(null); setConfirmDel(null); setEditing(blankDraft()); };
  const startEdit = (a) => {
    setConfirmDel(null);
    setEditing({
      id: a.id, name: a.name, description: a.description || '',
      trigger_event_type: a.trigger_event_type, enabled: a.enabled,
      conditions: (a.conditions || []).map((c) => ({
        field: c.field || '', op: c.op || 'eq',
        value: Array.isArray(c.value) ? c.value.join(', ') : (c.value ?? ''),
      })),
      actions: (a.actions || []).map((ac) => ({ type: ac.type, delay_hours: ac.delay_hours ?? 0, config: { ...(ac.config || {}) } })),
    });
  };

  const saveAutomation = async () => {
    const problem = validate(editing, settings);
    if (problem) { err(problem); return; }
    setSaving(true);
    try {
      const p_conditions = editing.conditions.map(serializeCondition).filter(Boolean);
      const p_actions = editing.actions.map(serializeAction);
      const row = await db.rpc('upsert_crm_automation', {
        p_id: editing.id || null,
        p_name: editing.name.trim(),
        p_description: editing.description.trim() || null,
        p_trigger_event_type: editing.trigger_event_type,
        p_conditions,
        p_actions,
        p_enabled: editing.enabled,
        p_created_by: employee?.id || null,
      });
      ok(editing.id ? 'Automation updated' : 'Automation created');
      setEditing(null);
      if (row?.id) setSelectedId(row.id);
      load();
    } catch (e) {
      err(/S1 collision|already handled/i.test(String(e?.message)) ? 'That trigger collides with an enabled fixed automation' : 'Failed to save automation');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (a) => {
    if (!a.enabled && triggerCollision(settings, a.trigger_event_type)) {
      err('That trigger is already handled by an enabled fixed automation — turn one off first.');
      return;
    }
    try {
      await db.rpc('set_automation_enabled', { p_id: a.id, p_enabled: !a.enabled });
      ok(!a.enabled ? 'Automation turned on' : 'Automation turned off');
      load();
    } catch (e) {
      err(/S1 collision|already handled/i.test(String(e?.message)) ? 'That trigger collides with an enabled fixed automation' : 'Failed to update automation');
    }
  };

  const deleteAutomation = async (a) => {
    if (confirmDel !== a.id) { setConfirmDel(a.id); return; }
    setConfirmDel(null);
    try {
      await db.rpc('delete_crm_automation', { p_automation_id: a.id });
      ok('Automation deleted');
      if (selectedId === a.id) setSelectedId(null);
      if (editing?.id === a.id) setEditing(null);
      load();
    } catch {
      err('Failed to delete automation');
    }
  };

  // ─── SECTION: Render ──────────────
  if (loading) return (
    <div className="crm-page">
      <div className="crm-page-header"><h1 className="crm-page-title">Automations</h1></div>
      <p className="crm-panel-empty">Loading…</p>
    </div>
  );

  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">Automations</h1>
        <button className="crm-btn crm-btn-primary" onClick={startNew}>+ New automation</button>
      </div>

      <div className="crm-auto-layout">
        {/* ─── Rule list ─── */}
        <div className="crm-card crm-auto-list">
          {automations.length === 0 && !editing && (
            <p className="crm-panel-empty">No automations yet — build a recipe to start.</p>
          )}
          {automations.map((a) => (
            <button
              key={a.id}
              className={`crm-auto-row${selectedId === a.id ? ' active' : ''}`}
              onClick={() => { setSelectedId(a.id); setEditing(null); }}
            >
              <div className="crm-auto-row-head">
                <span className="crm-auto-row-name">{a.name}</span>
                <span className={`crm-auto-badge is-${a.enabled ? 'on' : 'off'}`}>{a.enabled ? 'On' : 'Off'}</span>
              </div>
              <div className="crm-auto-row-sub">
                {triggerLabel(a.trigger_event_type)} · {(a.actions || []).length} action{(a.actions || []).length === 1 ? '' : 's'}
              </div>
            </button>
          ))}
        </div>

        {/* ─── Editor OR detail ─── */}
        <div className="crm-auto-main">
          {editing ? (
            <AutomationEditor
              editing={editing}
              setEditing={setEditing}
              sequences={sequences}
              settings={settings}
              saving={saving}
              onSave={saveAutomation}
              onCancel={() => setEditing(null)}
            />
          ) : selected ? (
            <AutomationDetail
              selected={selected}
              runs={runs}
              runsLoading={runsLoading}
              confirmDel={confirmDel}
              onEdit={() => startEdit(selected)}
              onToggle={() => toggleEnabled(selected)}
              onDelete={() => deleteAutomation(selected)}
              onDisarmDelete={() => setConfirmDel(null)}
              collides={triggerCollision(settings, selected.trigger_event_type)}
            />
          ) : (
            <div className="crm-card crm-auto-empty">
              <p className="crm-panel-empty">Select an automation, or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Detail (read view + run log) ──────────────
function AutomationDetail({ selected, runs, runsLoading, confirmDel, onEdit, onToggle, onDelete, onDisarmDelete, collides }) {
  return (
    <div className="crm-card crm-auto-detail">
      <div className="crm-auto-detail-head">
        <div>
          <h2 className="crm-auto-detail-name">{selected.name}</h2>
          {selected.description && <p className="crm-auto-detail-desc">{selected.description}</p>}
        </div>
        <span className={`crm-auto-badge is-${selected.enabled ? 'on' : 'off'}`}>{selected.enabled ? 'On' : 'Off'}</span>
      </div>

      <div className="crm-auto-actions-bar">
        <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={onEdit}>Edit</button>
        <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={onToggle}>
          {selected.enabled ? 'Turn off' : 'Turn on'}
        </button>
        <button
          className="crm-btn crm-btn-xs crm-auto-del"
          data-confirm={confirmDel === selected.id ? 'true' : 'false'}
          onClick={onDelete}
          onBlur={onDisarmDelete}
        >
          {confirmDel === selected.id ? 'Confirm delete' : 'Delete'}
        </button>
      </div>

      {collides && selected.enabled && (
        <p className="crm-auto-warn">⚠ This trigger is also handled by an enabled fixed automation — the engine will skip this rule to avoid a double-send.</p>
      )}

      {/* Recipe summary */}
      <div className="crm-auto-recipe">
        <div className="crm-auto-section-label">When</div>
        <div className="crm-auto-trigger-chip">{triggerLabel(selected.trigger_event_type)}</div>

        {(selected.conditions || []).length > 0 && (
          <>
            <div className="crm-auto-section-label">Only if</div>
            {selected.conditions.map((c, i) => (
              <div key={i} className="crm-auto-cond-view">
                <code>{c.field}</code>
                <span className="crm-auto-op">{OPERATORS.find((o) => o.value === c.op)?.label || c.op}</span>
                {!NO_VALUE_OPS.includes(c.op) && <code>{Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '')}</code>}
              </div>
            ))}
          </>
        )}

        <div className="crm-auto-section-label">Then, in order</div>
        {(selected.actions || []).map((a, i) => (
          <div key={i} className="crm-auto-action-view">
            <span className="crm-auto-step-num">{i + 1}</span>
            <span className="crm-auto-action-type">{actionLabel(a.type)}</span>
            <span className="crm-auto-action-when">{delayLabel(a.delay_hours)}</span>
            <span className="crm-auto-action-detail">{actionDetail(a)}</span>
          </div>
        ))}
      </div>

      {/* Run log */}
      <div className="crm-auto-runs">
        <div className="crm-auto-section-label">
          Run log · {selected.stats?.total || 0} total · {selected.stats?.active || 0} active · {selected.stats?.held || 0} held · {selected.stats?.completed || 0} done
        </div>
        {runsLoading ? (
          <p className="crm-auto-hint">Loading runs…</p>
        ) : runs.length === 0 ? (
          <p className="crm-auto-hint">No runs yet — this rule hasn’t fired.</p>
        ) : (
          <div className="crm-auto-run-list">
            {runs.map((r) => (
              <div key={r.id} className="crm-auto-run-row">
                <span className="crm-auto-run-name">{r.contact_name || r.entity_type || 'Event'}</span>
                <span className={`crm-auto-run-status is-${r.status}`}>{r.status}</span>
                <span className="crm-auto-run-step">step {(r.current_action ?? 0) + 1}{r.last_error ? ` · ${r.last_error}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function actionDetail(a) {
  const c = a.config || {};
  if (a.type === 'send_email') return c.subject ? `“${c.subject}”` : 'email';
  if (a.type === 'send_sms') return c.body ? `“${String(c.body).slice(0, 40)}${String(c.body).length > 40 ? '…' : ''}”` : 'text';
  if (a.type === 'enroll_sequence') return 'a drip sequence';
  if (a.type === 'create_task') return c.title ? `“${c.title}”` : 'a task';
  return '';
}

// ─── Editor (create / edit) ──────────────
function AutomationEditor({ editing, setEditing, sequences, settings, saving, onSave, onCancel }) {
  const set = (patch) => setEditing((e) => ({ ...e, ...patch }));
  const setCond = (idx, patch) => setEditing((e) => ({ ...e, conditions: e.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)) }));
  const addCond = () => setEditing((e) => ({ ...e, conditions: [...e.conditions, newCondition()] }));
  const removeCond = (idx) => setEditing((e) => ({ ...e, conditions: e.conditions.filter((_, i) => i !== idx) }));

  const setAction = (idx, patch) => setEditing((e) => ({ ...e, actions: e.actions.map((a, i) => (i === idx ? { ...a, ...patch } : a)) }));
  const setActionConfig = (idx, patch) => setEditing((e) => ({
    ...e, actions: e.actions.map((a, i) => (i === idx ? { ...a, config: { ...a.config, ...patch } } : a)),
  }));
  const addAction = () => setEditing((e) => ({ ...e, actions: [...e.actions, newAction('send_email')] }));
  const removeAction = (idx) => setEditing((e) => ({ ...e, actions: e.actions.filter((_, i) => i !== idx) }));
  const moveAction = (idx, dir) => setEditing((e) => {
    const j = idx + dir;
    if (j < 0 || j >= e.actions.length) return e;
    const actions = [...e.actions];
    [actions[idx], actions[j]] = [actions[j], actions[idx]];
    return { ...e, actions };
  });

  const collides = editing.enabled && triggerCollision(settings, editing.trigger_event_type);

  return (
    <div className="crm-card crm-auto-editor">
      <input className="crm-input" placeholder="Automation name" value={editing.name}
        onChange={(e) => set({ name: e.target.value })} />
      <input className="crm-input" placeholder="Description (optional)" value={editing.description}
        onChange={(e) => set({ description: e.target.value })} />

      {/* Trigger */}
      <div className="crm-auto-section-label">When this happens</div>
      <select className="crm-input" value={editing.trigger_event_type} onChange={(e) => set({ trigger_event_type: e.target.value })}>
        {TRIGGERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {triggerCollision(settings, editing.trigger_event_type) && (
        <p className="crm-auto-warn">⚠ A fixed automation already handles this trigger. You can save this rule, but it can only be turned on after you turn that one off.</p>
      )}

      {/* Conditions */}
      <div className="crm-auto-section-label">Only if (all must match — optional)</div>
      <datalist id="crm-auto-fields">
        {fieldsFor(editing.trigger_event_type).map((f) => <option key={f} value={f} />)}
      </datalist>
      {editing.conditions.length === 0 && <p className="crm-auto-hint">No conditions — the rule fires on every matching event.</p>}
      {editing.conditions.map((c, i) => (
        <div key={i} className="crm-auto-cond-edit">
          <input className="crm-input crm-auto-cond-field" list="crm-auto-fields" placeholder="field"
            value={c.field} onChange={(e) => setCond(i, { field: e.target.value })} />
          <select className="crm-input crm-auto-cond-op" value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>
            {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {!NO_VALUE_OPS.includes(c.op) && (
            <input className="crm-input crm-auto-cond-value"
              placeholder={LIST_OPS.includes(c.op) ? 'a, b, c' : 'value'}
              value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} />
          )}
          <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => removeCond(i)} aria-label="Remove condition">✕</button>
        </div>
      ))}
      <button className="crm-btn crm-btn-ghost crm-btn-xs crm-auto-add" onClick={addCond}>+ Add condition</button>

      {/* Actions */}
      <div className="crm-auto-section-label">Then do, in order</div>
      {editing.actions.map((a, i) => (
        <div key={i} className="crm-auto-action-edit">
          <div className="crm-auto-action-edit-head">
            <span className="crm-auto-step-num">{i + 1}</span>
            <select className="crm-input crm-auto-action-sel" value={a.type}
              onChange={(e) => setAction(i, { type: e.target.value, config: {} })}>
              {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="crm-auto-delay">
              <input className="crm-input crm-auto-delay-input" type="number" min="0" value={a.delay_hours}
                onChange={(e) => setAction(i, { delay_hours: e.target.value })} />
              <span className="crm-auto-delay-unit">hrs wait · {delayLabel(a.delay_hours)}</span>
            </label>
            <div className="crm-auto-action-tools">
              <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => moveAction(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => moveAction(i, 1)} disabled={i === editing.actions.length - 1} aria-label="Move down">↓</button>
              <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => removeAction(i)} disabled={editing.actions.length === 1} aria-label="Remove action">✕</button>
            </div>
          </div>

          {a.type === 'send_email' && (
            <>
              <input className="crm-input" placeholder="Email subject" value={a.config.subject || ''}
                onChange={(e) => setActionConfig(i, { subject: e.target.value })} />
              <textarea className="crm-input crm-auto-body" rows={3} placeholder="Email body (HTML allowed). Use {{name}} / {{first_name}}."
                value={a.config.body || ''} onChange={(e) => setActionConfig(i, { body: e.target.value })} />
            </>
          )}
          {a.type === 'send_sms' && (
            <>
              <textarea className="crm-input crm-auto-body" rows={2} placeholder="Text message… Use {{name}} / {{first_name}}."
                value={a.config.body || ''} onChange={(e) => setActionConfig(i, { body: e.target.value })} />
              <p className="crm-auto-hint">Texts are held until the SMS switch is turned on (Phase 4b) — never sent early.</p>
            </>
          )}
          {a.type === 'enroll_sequence' && (
            <select className="crm-input" value={a.config.sequence_id || ''} onChange={(e) => setActionConfig(i, { sequence_id: e.target.value })}>
              <option value="">Choose a sequence…</option>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {a.type === 'create_task' && (
            <>
              <input className="crm-input" placeholder="Task title" value={a.config.title || ''}
                onChange={(e) => setActionConfig(i, { title: e.target.value })} />
              <input className="crm-input" placeholder="Notes (optional)" value={a.config.notes || ''}
                onChange={(e) => setActionConfig(i, { notes: e.target.value })} />
              <label className="crm-auto-delay">
                <input className="crm-input crm-auto-delay-input" type="number" min="0" placeholder="0"
                  value={a.config.due_hours ?? ''} onChange={(e) => setActionConfig(i, { due_hours: e.target.value })} />
                <span className="crm-auto-delay-unit">due in N hrs (blank = no due date)</span>
              </label>
            </>
          )}
        </div>
      ))}
      <button className="crm-btn crm-btn-ghost crm-btn-xs crm-auto-add" onClick={addAction}>+ Add action</button>

      {/* Enable toggle */}
      <label className="crm-auto-enable">
        <input type="checkbox" checked={editing.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Turn this automation on</span>
      </label>
      {collides && (
        <p className="crm-auto-warn">⚠ Can’t turn on: a fixed automation already handles this trigger (double-send guard). Save it off, or turn the fixed one off first.</p>
      )}

      <div className="crm-auto-editor-actions">
        <button className="crm-btn crm-btn-primary crm-btn-xs" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : (editing.id ? 'Save changes' : 'Create automation')}
        </button>
        <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
