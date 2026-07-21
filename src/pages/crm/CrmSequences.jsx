/**
 * ════════════════════════════════════════════════
 * FILE: CrmSequences.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The drip / nurture sequence builder. You create a sequence — an ordered list
 *   of follow-up steps, each an email or a text, sent after a set number of
 *   hours — then enroll a saved segment (a group of contacts) into it. The page
 *   also shows, per sequence, how many people are active / finished / stopped and
 *   a roster of who's in it. A text step is built and stored but stays dark until
 *   the company's SMS switch is turned on (Phase 4b), so you can prepare texting
 *   sequences safely today. You can pause, re-activate, archive, or delete a
 *   sequence at any time.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/sequences
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db, employee)
 *   Data:      reads  → crm_sequences/steps/enrollments (get_sequences RPC),
 *                       crm_segments (get_segments RPC)
 *              writes → crm_sequences (+ steps) (upsert_sequence / delete_sequence
 *                       RPCs), crm_sequence_enrollments (enroll_in_sequence RPC)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 8 (.claude/rules/crm-wave-ownership.md). Sending happens in
 *     functions/api/process-sequences.js (cron), never here — this is authoring
 *     + enrollment only.
 *   - A status-only change (pause / activate / archive) calls upsert_sequence
 *     with p_steps=null so the existing steps are preserved (the RPC treats null
 *     as "leave steps untouched"; an actual array replaces them).
 *   - Enrollment is idempotent (UNIQUE sequence+contact), so re-enrolling a
 *     segment only adds people who aren't already in.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ok, err } from '@/lib/toast';

const STATUS_LABELS = { draft: 'Draft', active: 'Active', paused: 'Paused', archived: 'Archived' };
const newStep = (channel = 'email') => ({ channel, delay_hours: 24, subject: '', body: '' });
const blankDraft = () => ({ name: '', description: '', status: 'draft', steps: [newStep('email')] });

// A short human read of when a step fires relative to the one before it.
const delayLabel = (h) => {
  const n = Number(h) || 0;
  if (n === 0) return 'immediately';
  if (n % 24 === 0) return `${n / 24} day${n / 24 === 1 ? '' : 's'} later`;
  return `${n} hour${n === 1 ? '' : 's'} later`;
};

export default function CrmSequences() {
  const { db, employee } = useAuth();

  // ─── SECTION: State & hooks ──────────────
  const [sequences, setSequences] = useState([]);
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);   // null | { id?, name, description, status, steps[] }
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [enrollSeg, setEnrollSeg] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  // ─── SECTION: Data fetching ──────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [seqs, segs] = await Promise.all([
        db.rpc('get_sequences', {}),
        db.rpc('get_segments', {}).catch(() => []),
      ]);
      setSequences(seqs || []);
      setSegments(segs || []);
    } catch {
      err('Failed to load sequences');
      setSequences([]);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const selected = sequences.find((s) => s.id === selectedId) || null;

  // ─── SECTION: Event handlers ──────────────
  const startNew = () => { setSelectedId(null); setConfirmDel(null); setEditing(blankDraft()); };
  const startEdit = (seq) => {
    setConfirmDel(null);
    setEditing({
      id: seq.id, name: seq.name, description: seq.description || '', status: seq.status,
      steps: (seq.steps || []).map((s) => ({
        channel: s.channel, delay_hours: s.delay_hours ?? 0, subject: s.subject || '', body: s.body || '',
      })),
    });
  };

  const setStep = (idx, patch) =>
    setEditing((e) => ({ ...e, steps: e.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) }));
  const addStep = () => setEditing((e) => ({ ...e, steps: [...e.steps, newStep('email')] }));
  const removeStep = (idx) => setEditing((e) => ({ ...e, steps: e.steps.filter((_, i) => i !== idx) }));
  const moveStep = (idx, dir) => setEditing((e) => {
    const j = idx + dir;
    if (j < 0 || j >= e.steps.length) return e;
    const steps = [...e.steps];
    [steps[idx], steps[j]] = [steps[j], steps[idx]];
    return { ...e, steps };
  });

  const validate = (draft) => {
    if (!draft.name.trim()) return 'Give the sequence a name';
    if (!draft.steps.length) return 'Add at least one step';
    for (let i = 0; i < draft.steps.length; i++) {
      const s = draft.steps[i];
      if (!s.body.trim()) return `Step ${i + 1} needs a message body`;
      if (s.channel === 'email' && !s.subject.trim()) return `Step ${i + 1} (email) needs a subject`;
      if (!Number.isFinite(Number(s.delay_hours)) || Number(s.delay_hours) < 0) return `Step ${i + 1} has an invalid delay`;
    }
    return null;
  };

  const saveSequence = async () => {
    const problem = validate(editing);
    if (problem) { err(problem); return; }
    setSaving(true);
    try {
      const p_steps = editing.steps.map((s, i) => ({
        step_order: i,
        channel: s.channel,
        delay_hours: Math.max(0, Math.trunc(Number(s.delay_hours) || 0)),
        subject: s.channel === 'email' ? s.subject.trim() : null,
        body: s.body.trim(),
      }));
      const row = await db.rpc('upsert_sequence', {
        p_id: editing.id || null,
        p_name: editing.name.trim(),
        p_description: editing.description.trim() || null,
        p_status: editing.status,
        p_steps,
        p_created_by: employee?.id || null,
      });
      ok(editing.id ? 'Sequence updated' : 'Sequence created');
      setEditing(null);
      if (row?.id) setSelectedId(row.id);
      load();
    } catch {
      err('Failed to save sequence');
    } finally {
      setSaving(false);
    }
  };

  // Status-only change — pass p_steps=null so steps are preserved.
  const setStatus = async (seq, status) => {
    try {
      await db.rpc('upsert_sequence', { p_id: seq.id, p_status: status, p_steps: null });
      ok(`Sequence ${STATUS_LABELS[status].toLowerCase()}`);
      load();
    } catch {
      err('Failed to update status');
    }
  };

  const deleteSequence = async (seq) => {
    if (confirmDel !== seq.id) { setConfirmDel(seq.id); return; }
    setConfirmDel(null);
    try {
      await db.rpc('delete_sequence', { p_sequence_id: seq.id });
      ok('Sequence deleted');
      if (selectedId === seq.id) setSelectedId(null);
      if (editing?.id === seq.id) setEditing(null);
      load();
    } catch {
      err('Failed to delete sequence');
    }
  };

  const enrollSegment = async () => {
    if (!selected || !enrollSeg) { err('Pick a segment to enroll'); return; }
    setEnrolling(true);
    try {
      const rows = await db.rpc('enroll_in_sequence', { p_sequence_id: selected.id, p_segment_id: enrollSeg });
      ok(`${(rows || []).length} contact${(rows || []).length === 1 ? '' : 's'} in this sequence`);
      setEnrollSeg('');
      load();
    } catch {
      err('Failed to enroll segment');
    } finally {
      setEnrolling(false);
    }
  };

  // ─── SECTION: Render ──────────────
  if (loading) return (
    <div className="crm-page">
      <div className="crm-page-header"><h1 className="crm-page-title">Sequences</h1></div>
      <p className="crm-panel-empty">Loading…</p>
    </div>
  );

  return (
    <div className="crm-page">
      <div className="crm-page-header">
        <h1 className="crm-page-title">Sequences</h1>
        <button className="crm-btn crm-btn-primary" onClick={startNew}>+ New sequence</button>
      </div>

      <div className="crm-seq-layout">
        {/* ─── Sequence list ─── */}
        <div className="crm-card crm-seq-list">
          {sequences.length === 0 && !editing && (
            <p className="crm-panel-empty">No sequences yet — build one to start a drip.</p>
          )}
          {sequences.map((seq) => (
            <button
              key={seq.id}
              className={`crm-seq-row${selectedId === seq.id ? ' active' : ''}`}
              onClick={() => { setSelectedId(seq.id); setEditing(null); }}
            >
              <div className="crm-seq-row-head">
                <span className="crm-seq-row-name">{seq.name}</span>
                <span className={`crm-seq-status is-${seq.status}`}>{STATUS_LABELS[seq.status] || seq.status}</span>
              </div>
              <div className="crm-seq-row-sub">
                {(seq.steps || []).length} step{(seq.steps || []).length === 1 ? '' : 's'} ·{' '}
                {seq.stats?.active || 0} active · {seq.stats?.total || 0} enrolled
              </div>
            </button>
          ))}
        </div>

        {/* ─── Editor OR detail ─── */}
        <div className="crm-seq-main">
          {editing ? (
            <SequenceEditor
              editing={editing}
              setEditing={setEditing}
              setStep={setStep}
              addStep={addStep}
              removeStep={removeStep}
              moveStep={moveStep}
              saving={saving}
              onSave={saveSequence}
              onCancel={() => setEditing(null)}
            />
          ) : selected ? (
            <div className="crm-card crm-seq-detail">
              <div className="crm-seq-detail-head">
                <div>
                  <h2 className="crm-seq-detail-name">{selected.name}</h2>
                  {selected.description && <p className="crm-seq-detail-desc">{selected.description}</p>}
                </div>
                <span className={`crm-seq-status is-${selected.status}`}>{STATUS_LABELS[selected.status] || selected.status}</span>
              </div>

              {/* Actions */}
              <div className="crm-seq-actions">
                <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => startEdit(selected)}>Edit</button>
                {selected.status !== 'active' && (
                  <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => setStatus(selected, 'active')}>Activate</button>
                )}
                {selected.status === 'active' && (
                  <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => setStatus(selected, 'paused')}>Pause</button>
                )}
                {selected.status !== 'archived' && (
                  <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => setStatus(selected, 'archived')}>Archive</button>
                )}
                <button
                  className="crm-btn crm-btn-xs crm-seq-del"
                  data-confirm={confirmDel === selected.id ? 'true' : 'false'}
                  onClick={() => deleteSequence(selected)}
                  onBlur={() => setConfirmDel(null)}
                >
                  {confirmDel === selected.id ? 'Confirm delete' : 'Delete'}
                </button>
              </div>

              {/* Steps summary */}
              <div className="crm-seq-steps-view">
                <div className="crm-seq-section-label">Steps</div>
                {(selected.steps || []).map((s, i) => (
                  <div key={s.id || i} className="crm-seq-step-view">
                    <span className="crm-seq-step-num">{i + 1}</span>
                    <span className={`crm-seq-chan is-${s.channel}`}>{s.channel === 'sms' ? 'Text' : 'Email'}</span>
                    <span className="crm-seq-step-when">{delayLabel(s.delay_hours)}</span>
                    <span className="crm-seq-step-body">{s.channel === 'email' && s.subject ? `${s.subject} — ` : ''}{s.body}</span>
                  </div>
                ))}
              </div>

              {/* Enrollment */}
              <div className="crm-seq-enroll">
                <div className="crm-seq-section-label">Enroll a segment</div>
                <div className="crm-seq-enroll-row">
                  <select className="crm-input" value={enrollSeg} onChange={(e) => setEnrollSeg(e.target.value)}>
                    <option value="">Choose a segment…</option>
                    {segments.map((seg) => <option key={seg.id} value={seg.id}>{seg.name}</option>)}
                  </select>
                  <button className="crm-btn crm-btn-primary crm-btn-xs" onClick={enrollSegment} disabled={enrolling || !enrollSeg}>
                    {enrolling ? 'Enrolling…' : 'Enroll'}
                  </button>
                </div>
                {segments.length === 0 && (
                  <p className="crm-seq-hint">No segments yet — build one on the Contacts screen first.</p>
                )}
              </div>

              {/* Roster + stats */}
              <div className="crm-seq-roster">
                <div className="crm-seq-section-label">
                  Enrolled ({selected.stats?.total || 0}) · {selected.stats?.active || 0} active ·{' '}
                  {selected.stats?.completed || 0} done · {selected.stats?.exited || 0} stopped
                </div>
                {(selected.enrollments || []).length === 0 ? (
                  <p className="crm-seq-hint">Nobody enrolled yet.</p>
                ) : (
                  <div className="crm-seq-roster-list">
                    {selected.enrollments.map((en) => (
                      <div key={en.id} className="crm-seq-roster-row">
                        <span className="crm-seq-roster-name">{en.contact_name || en.contact_phone || 'Unknown'}</span>
                        <span className={`crm-seq-enr-status is-${en.status}`}>{en.status}</span>
                        <span className="crm-seq-roster-step">
                          {en.status === 'exited' && en.exit_reason ? `exited: ${en.exit_reason}` : `step ${(en.current_step ?? 0) + 1}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="crm-card crm-seq-empty">
              <p className="crm-panel-empty">Select a sequence, or create a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Editor (create / edit) ──────────────
function SequenceEditor({ editing, setEditing, setStep, addStep, removeStep, moveStep, saving, onSave, onCancel }) {
  return (
    <div className="crm-card crm-seq-editor">
      <input
        className="crm-input" placeholder="Sequence name" value={editing.name}
        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
      />
      <input
        className="crm-input" placeholder="Description (optional)" value={editing.description}
        onChange={(e) => setEditing({ ...editing, description: e.target.value })}
      />
      <label className="crm-seq-field">
        <span className="crm-seq-field-label">Status</span>
        <select className="crm-input" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </label>

      <div className="crm-seq-section-label">Steps</div>
      {editing.steps.map((s, i) => (
        <div key={i} className="crm-seq-step-edit">
          <div className="crm-seq-step-edit-head">
            <span className="crm-seq-step-num">{i + 1}</span>
            <select className="crm-input crm-seq-chan-sel" value={s.channel} onChange={(e) => setStep(i, { channel: e.target.value })}>
              <option value="email">Email</option>
              <option value="sms">Text (SMS)</option>
            </select>
            <label className="crm-seq-delay">
              <input
                className="crm-input crm-seq-delay-input" type="number" min="0" value={s.delay_hours}
                onChange={(e) => setStep(i, { delay_hours: e.target.value })}
              />
              <span className="crm-seq-delay-unit">hrs after previous · {delayLabel(s.delay_hours)}</span>
            </label>
            <div className="crm-seq-step-tools">
              <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => moveStep(i, 1)} disabled={i === editing.steps.length - 1} aria-label="Move down">↓</button>
              <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={() => removeStep(i)} disabled={editing.steps.length === 1} aria-label="Remove step">✕</button>
            </div>
          </div>
          {s.channel === 'email' && (
            <input
              className="crm-input" placeholder="Email subject" value={s.subject}
              onChange={(e) => setStep(i, { subject: e.target.value })}
            />
          )}
          <textarea
            className="crm-input crm-seq-body" rows={s.channel === 'sms' ? 2 : 3}
            placeholder={s.channel === 'sms' ? 'Text message… (held until the SMS switch is on)' : 'Email body (HTML allowed)'}
            value={s.body} onChange={(e) => setStep(i, { body: e.target.value })}
          />
          {s.channel === 'sms' && (
            <p className="crm-seq-hint">Text steps are saved but not sent until the SMS switch is turned on (Phase 4b).</p>
          )}
        </div>
      ))}
      <button className="crm-btn crm-btn-ghost crm-btn-xs crm-seq-add" onClick={addStep}>+ Add step</button>

      <div className="crm-seq-editor-actions">
        <button className="crm-btn crm-btn-primary crm-btn-xs" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : (editing.id ? 'Save changes' : 'Create sequence')}
        </button>
        <button className="crm-btn crm-btn-ghost crm-btn-xs" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
