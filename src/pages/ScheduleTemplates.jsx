import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DIVISIONS = [
  { value: 'water', label: 'Water Mitigation' },
  { value: 'mold', label: 'Mold Remediation' },
  { value: 'reconstruction', label: 'Reconstruction' },
  { value: 'fire', label: 'Fire' },
  { value: 'contents', label: 'Contents' },
];

const APPT_TYPES = [
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'mitigation', label: 'Mitigation' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'reconstruction', label: 'Reconstruction' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'mold_remediation', label: 'Mold Remediation' },
  { value: 'content_cleaning', label: 'Content Cleaning' },
  { value: 'other', label: 'Other' },
];

const PHASE_COLORS = [
  '#E24B4A', '#378ADD', '#1D9E75', '#f59e0b', '#D85A30',
  '#8b5cf6', '#10b981', '#059669', '#6b7280', '#ec4899',
];

// ═══════════════════════════════════════════════════════════════
// GANTT PREVIEW (SVG)
// ═══════════════════════════════════════════════════════════════

function GanttPreview({ phases, dependencies, onPhaseClick, selectedPhaseId }) {
  if (!phases?.length) {
    return (
      <div style={ganttStyles.empty}>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
          Add phases to see the Gantt preview
        </span>
      </div>
    );
  }

  const maxDay = Math.max(...phases.map(p => (p.day_offset || 0) + (p.duration_days || 1)), 1);
  const totalDays = maxDay + 1;
  const leftMargin = 180;
  const dayWidth = Math.max(36, Math.min(50, (800 - leftMargin) / totalDays));
  const rowHeight = 32;
  const headerHeight = 28;
  const svgWidth = leftMargin + totalDays * dayWidth + 20;
  const svgHeight = headerHeight + phases.length * rowHeight + 16;

  // Build phase ID → row index map for dependency arrows
  const phaseRowMap = {};
  phases.forEach((p, i) => { phaseRowMap[p.id] = i; });

  return (
    <div style={ganttStyles.wrapper}>
      <svg width={svgWidth} height={svgHeight} style={{ display: 'block' }}>
        {/* Day headers */}
        {Array.from({ length: totalDays }, (_, i) => (
          <g key={`day-${i}`}>
            <line
              x1={leftMargin + i * dayWidth} y1={0}
              x2={leftMargin + i * dayWidth} y2={svgHeight}
              stroke="var(--border-light)" strokeWidth="0.5"
            />
            <text
              x={leftMargin + i * dayWidth + dayWidth / 2} y={16}
              textAnchor="middle" fill="var(--text-tertiary)"
              fontSize="10" fontFamily="var(--font-sans)"
            >
              D{i + 1}
            </text>
          </g>
        ))}

        {/* Phase bars */}
        {phases.map((phase, i) => {
          const y = headerHeight + i * rowHeight;
          const x = leftMargin + (phase.day_offset || 0) * dayWidth;
          const w = (phase.duration_days || 1) * dayWidth - 4;
          const isSelected = phase.id === selectedPhaseId;
          const color = phase.color || '#6b7280';

          return (
            <g
              key={phase.id}
              style={{ cursor: 'pointer' }}
              onClick={() => onPhaseClick?.(phase.id)}
            >
              {/* Row background on hover/select */}
              {isSelected && (
                <rect
                  x={0} y={y} width={svgWidth} height={rowHeight}
                  fill="var(--accent-light)" opacity="0.5"
                />
              )}

              {/* Phase label */}
              <text
                x={leftMargin - 8} y={y + rowHeight / 2 + 1}
                textAnchor="end" fill="var(--text-primary)"
                fontSize="11" fontWeight={isSelected ? 600 : 400}
                fontFamily="var(--font-sans)"
              >
                {phase.name.length > 22 ? phase.name.slice(0, 20) + '…' : phase.name}
              </text>

              {/* Bar or milestone diamond */}
              {phase.is_milestone ? (
                <g transform={`translate(${x + dayWidth / 2}, ${y + rowHeight / 2})`}>
                  <polygon
                    points="0,-8 8,0 0,8 -8,0"
                    fill={color} stroke={isSelected ? 'var(--accent)' : 'none'}
                    strokeWidth="1.5"
                  />
                </g>
              ) : (
                <rect
                  x={x + 2} y={y + 6} width={Math.max(w, 8)} height={rowHeight - 12}
                  rx={4} fill={color} opacity={0.85}
                  stroke={isSelected ? 'var(--accent)' : 'none'} strokeWidth="1.5"
                />
              )}
            </g>
          );
        })}

        {/* Dependency arrows */}
        {dependencies?.map((dep, i) => {
          const srcIdx = phaseRowMap[dep.source_phase_id];
          const tgtIdx = phaseRowMap[dep.target_phase_id];
          if (srcIdx === undefined || tgtIdx === undefined) return null;

          const srcPhase = phases[srcIdx];
          const tgtPhase = phases[tgtIdx];
          const srcX = leftMargin + ((srcPhase.day_offset || 0) + (srcPhase.duration_days || 1)) * dayWidth;
          const srcY = headerHeight + srcIdx * rowHeight + rowHeight / 2;
          const tgtX = leftMargin + (tgtPhase.day_offset || 0) * dayWidth + 2;
          const tgtY = headerHeight + tgtIdx * rowHeight + rowHeight / 2;

          // L-shaped connector
          const midX = srcX + 6;
          return (
            <path
              key={`dep-${i}`}
              d={`M${srcX},${srcY} L${midX},${srcY} L${midX},${tgtY} L${tgtX},${tgtY}`}
              fill="none" stroke="var(--text-tertiary)" strokeWidth="1"
              strokeDasharray="3 2" markerEnd="url(#gantt-arrow)"
            />
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4"
            markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M1 1L7 4L1 7" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5"/>
          </marker>
        </defs>
      </svg>
    </div>
  );
}

const ganttStyles = {
  wrapper: {
    overflowX: 'auto', background: 'var(--bg-primary)',
    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
    padding: '8px 0',
  },
  empty: {
    padding: '40px 20px', textAlign: 'center',
    background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
  },
};

// ═══════════════════════════════════════════════════════════════
// PHASE EDITOR MODAL
// ═══════════════════════════════════════════════════════════════

function PhaseModal({ phase, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '', appointment_type: 'reconstruction', day_offset: 0,
    duration_days: 1, default_start_time: '07:00', default_end_time: '15:30',
    is_milestone: false, color: '#6b7280', default_crew_count: 2,
    notes: '', ...phase,
  });

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.sheet} onClick={e => e.stopPropagation()}>
        <div style={modalStyles.header}>
          <h3 style={modalStyles.title}>{phase?.id ? 'Edit phase' : 'Add phase'}</h3>
          <button style={modalStyles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={modalStyles.body}>
          {/* Name */}
          <label style={modalStyles.label}>Name</label>
          <input style={modalStyles.input} value={form.name}
            onChange={e => set('name', e.target.value)} placeholder="e.g. Plumber — rough-in" autoFocus />

          {/* Row: Type + Milestone toggle */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={modalStyles.label}>Type</label>
              <select style={modalStyles.input} value={form.appointment_type}
                onChange={e => set('appointment_type', e.target.value)}>
                {APPT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <label style={{ ...modalStyles.label, display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_milestone}
                onChange={e => set('is_milestone', e.target.checked)} />
              Milestone
            </label>
          </div>

          {/* Row: Day offset + Duration */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={modalStyles.label}>Day offset</label>
              <input type="number" min={0} style={modalStyles.input} value={form.day_offset}
                onChange={e => set('day_offset', parseInt(e.target.value) || 0)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={modalStyles.label}>Duration (days)</label>
              <input type="number" min={1} style={modalStyles.input} value={form.duration_days}
                onChange={e => set('duration_days', parseInt(e.target.value) || 1)}
                disabled={form.is_milestone} />
            </div>
          </div>

          {/* Row: Start time + End time */}
          {!form.is_milestone && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={modalStyles.label}>Start time</label>
                <input type="time" style={modalStyles.input} value={form.default_start_time || ''}
                  onChange={e => set('default_start_time', e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={modalStyles.label}>End time</label>
                <input type="time" style={modalStyles.input} value={form.default_end_time || ''}
                  onChange={e => set('default_end_time', e.target.value)} />
              </div>
            </div>
          )}

          {/* Row: Color + Crew count */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div>
              <label style={modalStyles.label}>Color</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {PHASE_COLORS.map(c => (
                  <button key={c} onClick={() => set('color', c)} style={{
                    width: 28, height: 28, borderRadius: 6, background: c, border: 'none',
                    outline: form.color === c ? '2px solid var(--accent)' : '2px solid transparent',
                    outlineOffset: 2, cursor: 'pointer',
                  }} />
                ))}
              </div>
            </div>
            {!form.is_milestone && (
              <div style={{ flex: 1 }}>
                <label style={modalStyles.label}>Default crew</label>
                <input type="number" min={0} style={modalStyles.input}
                  value={form.default_crew_count ?? ''}
                  onChange={e => set('default_crew_count', e.target.value === '' ? null : parseInt(e.target.value))} />
              </div>
            )}
          </div>

          {/* Notes */}
          <label style={modalStyles.label}>Notes</label>
          <textarea style={{ ...modalStyles.input, minHeight: 60, resize: 'vertical' }}
            value={form.notes || ''} onChange={e => set('notes', e.target.value)} />
        </div>
        <div style={modalStyles.footer}>
          <button style={modalStyles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={modalStyles.saveBtn} onClick={() => onSave(form)}
            disabled={!form.name.trim()}>
            {phase?.id ? 'Save changes' : 'Add phase'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TASK EDITOR (inline within phase card)
// ═══════════════════════════════════════════════════════════════

function TaskEditor({ tasks, phaseId, db, onRefresh }) {
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const addTask = async () => {
    if (!newTitle.trim() || saving) return;
    setSaving(true);
    try {
      await db.insert('template_tasks', {
        template_phase_id: phaseId,
        title: newTitle.trim(),
        is_required: false,
        display_order: (tasks?.length || 0) + 1,
      });
      setNewTitle('');
      onRefresh();
    } catch (e) { console.error('Add task:', e); }
    finally { setSaving(false); }
  };

  const deleteTask = async (taskId) => {
    try {
      await db.delete('template_tasks', `id=eq.${taskId}`);
      onRefresh();
    } catch (e) { console.error('Delete task:', e); }
  };

  const toggleRequired = async (task) => {
    try {
      await db.update('template_tasks', `id=eq.${task.id}`, { is_required: !task.is_required });
      onRefresh();
    } catch (e) { console.error('Toggle required:', e); }
  };

  return (
    <div style={{ padding: '8px 0' }}>
      {tasks?.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 12, padding: '4px 0 8px' }}>
          No tasks yet — add checklist items below
        </div>
      )}
      {tasks?.map((t, i) => (
        <div key={t.id} style={taskStyles.row}>
          <span style={taskStyles.order}>{i + 1}</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{t.title}</span>
          <button
            style={{ ...taskStyles.chip, background: t.is_required ? '#fef2f2' : 'var(--bg-tertiary)',
              color: t.is_required ? '#ef4444' : 'var(--text-tertiary)' }}
            onClick={() => toggleRequired(t)}
            title={t.is_required ? 'Click to make optional' : 'Click to make required'}
          >
            {t.is_required ? 'Required' : 'Optional'}
          </button>
          <button style={taskStyles.deleteBtn} onClick={() => deleteTask(t.id)} title="Remove task">✕</button>
        </div>
      ))}
      <div style={taskStyles.addRow}>
        <input
          style={taskStyles.addInput}
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          placeholder="Add task..."
          onKeyDown={e => e.key === 'Enter' && addTask()}
        />
        <button style={taskStyles.addBtn} onClick={addTask}
          disabled={!newTitle.trim() || saving}>+</button>
      </div>
    </div>
  );
}

const taskStyles = {
  row: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
    borderBottom: '1px solid var(--border-light)',
  },
  order: {
    fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500,
    width: 20, textAlign: 'center', flexShrink: 0,
  },
  chip: {
    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 99,
    border: 'none', cursor: 'pointer',
  },
  deleteBtn: {
    fontSize: 12, color: 'var(--text-tertiary)', background: 'none',
    border: 'none', cursor: 'pointer', padding: '2px 4px',
  },
  addRow: { display: 'flex', gap: 6, marginTop: 8 },
  addInput: {
    flex: 1, padding: '6px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)',
    outline: 'none',
  },
  addBtn: {
    width: 32, height: 32, border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
    cursor: 'pointer', fontSize: 16, fontWeight: 600, color: 'var(--accent)',
  },
};

// ═══════════════════════════════════════════════════════════════
// DEPENDENCY EDITOR
// ═══════════════════════════════════════════════════════════════

function DependencyEditor({ phase, allPhases, dependencies, db, templateId, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [sourceId, setSourceId] = useState('');

  // Deps where this phase is the target (things it depends ON)
  const inboundDeps = dependencies?.filter(d => d.target_phase_id === phase.id) || [];
  // Available phases to depend on (exclude self and existing deps)
  const existingSources = new Set(inboundDeps.map(d => d.source_phase_id));
  const availableSources = allPhases.filter(p => p.id !== phase.id && !existingSources.has(p.id));

  const addDep = async () => {
    if (!sourceId) return;
    try {
      await db.insert('template_dependencies', {
        template_id: templateId,
        source_phase_id: sourceId,
        target_phase_id: phase.id,
        dependency_type: 'starts_after',
        lag_days: 0,
      });
      setAdding(false);
      setSourceId('');
      onRefresh();
    } catch (e) { console.error('Add dep:', e); }
  };

  const removeDep = async (depId) => {
    try {
      await db.delete('template_dependencies', `id=eq.${depId}`);
      onRefresh();
    } catch (e) { console.error('Remove dep:', e); }
  };

  const phaseNameById = (id) => allPhases.find(p => p.id === id)?.name || '?';

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
        Depends on
      </div>
      {inboundDeps.length === 0 && !adding && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 12, marginBottom: 6 }}>
          No dependencies — this phase starts independently
        </div>
      )}
      {inboundDeps.map(dep => (
        <div key={dep.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Starts after: <strong>{phaseNameById(dep.source_phase_id)}</strong>
            {dep.lag_days > 0 && ` +${dep.lag_days}d`}
          </span>
          <button style={taskStyles.deleteBtn} onClick={() => removeDep(dep.id)}>✕</button>
        </div>
      ))}
      {adding ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <select style={{ ...modalStyles.input, flex: 1, padding: '4px 8px', fontSize: 12 }}
            value={sourceId} onChange={e => setSourceId(e.target.value)}>
            <option value="">Select phase...</option>
            {availableSources.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button style={{ ...taskStyles.addBtn, height: 28, width: 28 }} onClick={addDep}
            disabled={!sourceId}>✓</button>
          <button style={{ ...taskStyles.addBtn, height: 28, width: 28, color: 'var(--text-tertiary)' }}
            onClick={() => { setAdding(false); setSourceId(''); }}>✕</button>
        </div>
      ) : (
        <button
          style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontWeight: 500 }}
          onClick={() => setAdding(true)}
        >
          + Add dependency
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PHASE CARD (expandable row in the phase list)
// ═══════════════════════════════════════════════════════════════

function PhaseCard({ phase, isExpanded, onToggle, onEdit, onDelete, allPhases, dependencies, db, templateId, onRefresh }) {
  const color = phase.color || '#6b7280';
  const taskCount = phase.tasks?.length || 0;
  const requiredCount = phase.tasks?.filter(t => t.is_required).length || 0;
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-lg)', marginBottom: 8,
      borderLeft: `3px solid ${color}`,
      background: 'var(--bg-primary)',
    }}>
      {/* Header row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          cursor: 'pointer', userSelect: 'none',
        }}
        onClick={onToggle}
      >
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, fontFamily: 'var(--font-mono)', minWidth: 32 }}>
          D{(phase.day_offset || 0) + 1}
        </span>
        {phase.is_milestone ? (
          <span style={{ fontSize: 13, color: color, fontWeight: 600 }}>◆</span>
        ) : (
          <span style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {phase.name}
        </span>
        {!phase.is_milestone && phase.duration_days > 1 && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '2px 6px', background: 'var(--bg-tertiary)', borderRadius: 4 }}>
            {phase.duration_days}d
          </span>
        )}
        {taskCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {taskCount} task{taskCount !== 1 ? 's' : ''}{requiredCount > 0 ? ` (${requiredCount} req)` : ''}
          </span>
        )}
        {phase.default_crew_count && (
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            👤{phase.default_crew_count}
          </span>
        )}
        <span style={{ fontSize: 16, color: 'var(--text-tertiary)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: '150ms ease' }}>
          ▾
        </span>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-light)' }}>
          {/* Phase actions */}
          <div style={{ display: 'flex', gap: 8, padding: '10px 0 6px', alignItems: 'center' }}>
            <button style={phaseActionBtn} onClick={onEdit}>Edit phase</button>
            {confirmDelete ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Delete phase + tasks?</span>
                <button onClick={onDelete} style={{ ...phaseActionBtn, color: '#fff', background: '#ef4444', border: 'none' }}>Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} style={phaseActionBtn}>Cancel</button>
              </>
            ) : (
              <button style={{ ...phaseActionBtn, color: '#ef4444' }} onClick={() => setConfirmDelete(true)}>Delete</button>
            )}
          </div>

          {/* Tasks */}
          {!phase.is_milestone && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginTop: 8 }}>
                Tasks
              </div>
              <TaskEditor tasks={phase.tasks} phaseId={phase.id} db={db} onRefresh={onRefresh} />
            </>
          )}

          {/* Dependencies */}
          <div style={{ marginTop: 12 }}>
            <DependencyEditor
              phase={phase} allPhases={allPhases} dependencies={dependencies}
              db={db} templateId={templateId} onRefresh={onRefresh}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const phaseActionBtn = {
  fontSize: 12, fontWeight: 500, color: 'var(--accent)', background: 'none',
  border: 'none', cursor: 'pointer', padding: '4px 0',
};

// ═══════════════════════════════════════════════════════════════
// TEMPLATE LIST (sidebar)
// ═══════════════════════════════════════════════════════════════

function TemplateList({ templates, loading, selectedId, onSelect, onCreate }) {
  return (
    <div style={listStyles.container}>
      <div style={listStyles.header}>
        <h2 style={listStyles.title}>Schedule templates</h2>
        <button style={listStyles.addBtn} onClick={onCreate}>+ New</button>
      </div>
      {loading && <div style={listStyles.loading}>Loading...</div>}
      {!loading && templates.length === 0 && (
        <div style={listStyles.empty}>No templates yet. Create your first one.</div>
      )}
      {templates.map(t => (
        <div
          key={t.id}
          style={{
            ...listStyles.item,
            background: t.id === selectedId ? 'var(--accent-light)' : 'transparent',
            borderColor: t.id === selectedId ? 'var(--accent)' : 'var(--border-color)',
          }}
          onClick={() => onSelect(t.id)}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {t.phase_count} phases · {t.milestone_count} milestones · {t.task_count} tasks
          </div>
          {t.division && (
            <span style={{
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)',
              padding: '1px 6px', borderRadius: 4, marginTop: 4, display: 'inline-block',
            }}>
              {t.division}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const listStyles = {
  container: { width: 280, borderRight: '1px solid var(--border-color)', background: 'var(--bg-secondary)', overflowY: 'auto', flexShrink: 0 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 16px 12px' },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' },
  addBtn: {
    fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-light)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '6px 12px', cursor: 'pointer',
  },
  item: {
    padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)',
    borderLeft: '3px solid transparent', transition: 'background 120ms ease',
  },
  loading: { padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 },
  empty: { padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 },
};

// ═══════════════════════════════════════════════════════════════
// MAIN: SCHEDULE TEMPLATES PAGE
// ═══════════════════════════════════════════════════════════════

export default function ScheduleTemplates() {
  const { db } = useAuth();

  // List state
  const [templates, setTemplates] = useState([]);
  const [listLoading, setListLoading] = useState(true);

  // Editor state
  const [selectedId, setSelectedId] = useState(null);
  const [template, setTemplate] = useState(null);
  const [editorLoading, setEditorLoading] = useState(false);

  // Phase modal
  const [phaseModal, setPhaseModal] = useState(null); // null | { mode: 'add' } | { mode: 'edit', phase }
  const [expandedPhase, setExpandedPhase] = useState(null);
  const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState(false);

  // Template header editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  // ── Load template list ──
  const loadTemplates = useCallback(async () => {
    try {
      const data = await db.rpc('get_schedule_templates');
      setTemplates(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Load templates:', e); }
    finally { setListLoading(false); }
  }, [db]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // ── Load full template detail ──
  const loadTemplate = useCallback(async (id) => {
    if (!id) { setTemplate(null); return; }
    setEditorLoading(true);
    try {
      const data = await db.rpc('get_schedule_template', { p_template_id: id });
      setTemplate(data);
    } catch (e) { console.error('Load template:', e); }
    finally { setEditorLoading(false); }
  }, [db]);

  useEffect(() => { loadTemplate(selectedId); }, [selectedId, loadTemplate]);

  const refresh = () => {
    loadTemplate(selectedId);
    loadTemplates();
  };

  // ── Create new template ──
  const createTemplate = async () => {
    try {
      const result = await db.insert('schedule_templates', {
        name: 'New template',
        division: 'reconstruction',
        description: '',
      });
      const newId = result[0]?.id;
      if (newId) {
        await loadTemplates();
        setSelectedId(newId);
      }
    } catch (e) { console.error('Create template:', e); }
  };

  // ── Update template header fields ──
  const updateTemplate = async (field, value) => {
    if (!template?.id) return;
    try {
      await db.update('schedule_templates', `id=eq.${template.id}`, { [field]: value });
      refresh();
    } catch (e) { console.error('Update template:', e); }
  };

  // ── Delete template ──
  const deleteTemplate = async () => {
    if (!template?.id) return;
    try {
      await db.delete('schedule_templates', `id=eq.${template.id}`);
      setSelectedId(null);
      setTemplate(null);
      setConfirmDeleteTemplate(false);
      loadTemplates();
    } catch (e) { console.error('Delete template:', e); errToast('Failed to delete template'); }
  };

  // ── Duplicate template ──
  const duplicateTemplate = async () => {
    if (!template) return;
    try {
      // Create new template
      const newTmpl = await db.insert('schedule_templates', {
        name: template.name + ' (copy)',
        description: template.description,
        division: template.division,
      });
      const newId = newTmpl[0]?.id;
      if (!newId) return;

      // Copy phases
      const phaseIdMap = {};
      for (const phase of (template.phases || [])) {
        const newPhase = await db.insert('template_phases', {
          template_id: newId, name: phase.name, description: phase.description,
          appointment_type: phase.appointment_type, day_offset: phase.day_offset,
          duration_days: phase.duration_days, default_start_time: phase.default_start_time,
          default_end_time: phase.default_end_time, is_milestone: phase.is_milestone,
          color: phase.color, default_crew_count: phase.default_crew_count,
          display_order: phase.display_order, notes: phase.notes,
        });
        phaseIdMap[phase.id] = newPhase[0]?.id;

        // Copy tasks
        for (const task of (phase.tasks || [])) {
          await db.insert('template_tasks', {
            template_phase_id: phaseIdMap[phase.id],
            title: task.title, description: task.description,
            is_required: task.is_required, display_order: task.display_order,
          });
        }
      }

      // Copy dependencies
      for (const dep of (template.dependencies || [])) {
        const srcId = phaseIdMap[dep.source_phase_id];
        const tgtId = phaseIdMap[dep.target_phase_id];
        if (srcId && tgtId) {
          await db.insert('template_dependencies', {
            template_id: newId, source_phase_id: srcId, target_phase_id: tgtId,
            dependency_type: dep.dependency_type, lag_days: dep.lag_days,
          });
        }
      }

      await loadTemplates();
      setSelectedId(newId);
    } catch (e) { console.error('Duplicate template:', e); }
  };

  // ── Save phase (add or edit) ──
  const savePhase = async (form) => {
    try {
      if (form.id) {
        // Update existing
        const { id, tasks, ...data } = form;
        await db.update('template_phases', `id=eq.${id}`, data);
      } else {
        // Insert new
        const maxOrder = Math.max(0, ...(template?.phases || []).map(p => p.display_order || 0));
        await db.insert('template_phases', {
          template_id: template.id,
          ...form,
          display_order: maxOrder + 1,
        });
      }
      setPhaseModal(null);
      refresh();
    } catch (e) { console.error('Save phase:', e); }
  };

  // ── Delete phase ──
  const deletePhase = async (phaseId) => {
    try {
      await db.delete('template_phases', `id=eq.${phaseId}`);
      setExpandedPhase(null);
      refresh();
    } catch (e) { console.error('Delete phase:', e); errToast('Failed to delete phase'); }
  };

  // ── Sorted phases by display_order ──
  const sortedPhases = useMemo(() =>
    [...(template?.phases || [])].sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
  , [template?.phases]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div style={pageStyles.container}>
      {/* Left: Template list */}
      <TemplateList
        templates={templates} loading={listLoading}
        selectedId={selectedId} onSelect={setSelectedId}
        onCreate={createTemplate}
      />

      {/* Right: Editor or placeholder */}
      <div style={pageStyles.editor}>
        {!selectedId && (
          <div style={pageStyles.placeholder}>
            <div style={{ fontSize: 48, opacity: 0.15 }}>📋</div>
            <div style={{ fontSize: 15, color: 'var(--text-tertiary)', marginTop: 8 }}>
              Select a template to edit, or create a new one
            </div>
          </div>
        )}

        {editorLoading && (
          <div style={pageStyles.placeholder}>
            <div style={{ color: 'var(--text-tertiary)' }}>Loading template...</div>
          </div>
        )}

        {template && !editorLoading && (
          <>
            {/* ── Template Header ── */}
            <div style={pageStyles.header}>
              <div style={{ flex: 1 }}>
                {editingName ? (
                  <input
                    style={{ fontSize: 20, fontWeight: 700, border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none', padding: '2px 0', fontFamily: 'var(--font-sans)', color: 'var(--text-primary)', width: '100%' }}
                    value={nameValue}
                    onChange={e => setNameValue(e.target.value)}
                    onBlur={() => { updateTemplate('name', nameValue); setEditingName(false); }}
                    onKeyDown={e => { if (e.key === 'Enter') { updateTemplate('name', nameValue); setEditingName(false); } }}
                    autoFocus
                  />
                ) : (
                  <h1
                    style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', cursor: 'pointer' }}
                    onClick={() => { setNameValue(template.name); setEditingName(true); }}
                    title="Click to rename"
                  >
                    {template.name}
                  </h1>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <select
                    style={{ fontSize: 12, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '3px 8px', fontFamily: 'var(--font-sans)', color: 'var(--text-secondary)', background: 'var(--bg-primary)' }}
                    value={template.division || ''}
                    onChange={e => updateTemplate('division', e.target.value)}
                  >
                    <option value="">No division</option>
                    {DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {sortedPhases.filter(p => !p.is_milestone).length} phases · {sortedPhases.filter(p => p.is_milestone).length} milestones · {sortedPhases.reduce((sum, p) => sum + (p.tasks?.length || 0), 0)} tasks
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button style={pageStyles.actionBtn} onClick={duplicateTemplate}>Duplicate</button>
                {confirmDeleteTemplate ? (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Delete "{template.name}"?</span>
                    <button onClick={deleteTemplate} style={{ ...pageStyles.actionBtn, color: '#fff', background: '#ef4444', border: 'none' }}>Yes, delete</button>
                    <button onClick={() => setConfirmDeleteTemplate(false)} style={pageStyles.actionBtn}>Cancel</button>
                  </>
                ) : (
                  <button style={{ ...pageStyles.actionBtn, color: '#ef4444' }} onClick={() => setConfirmDeleteTemplate(true)}>Delete</button>
                )}
              </div>
            </div>

            {/* ── Gantt Preview ── */}
            <div style={{ padding: '0 24px 16px' }}>
              <GanttPreview
                phases={sortedPhases}
                dependencies={template.dependencies}
                onPhaseClick={(id) => setExpandedPhase(expandedPhase === id ? null : id)}
                selectedPhaseId={expandedPhase}
              />
            </div>

            {/* ── Phase List ── */}
            <div style={{ padding: '0 24px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>
                  Phases &amp; tasks
                </div>
                <button
                  style={{ ...listStyles.addBtn, fontSize: 12 }}
                  onClick={() => setPhaseModal({ mode: 'add' })}
                >
                  + Add phase
                </button>
              </div>

              {sortedPhases.map(phase => (
                <PhaseCard
                  key={phase.id}
                  phase={phase}
                  isExpanded={expandedPhase === phase.id}
                  onToggle={() => setExpandedPhase(expandedPhase === phase.id ? null : phase.id)}
                  onEdit={() => setPhaseModal({ mode: 'edit', phase })}
                  onDelete={() => deletePhase(phase.id)}
                  allPhases={sortedPhases}
                  dependencies={template.dependencies}
                  db={db}
                  templateId={template.id}
                  onRefresh={refresh}
                />
              ))}

              {sortedPhases.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
                  <div style={{ fontSize: 13 }}>No phases yet.</div>
                  <button
                    style={{ ...listStyles.addBtn, marginTop: 12 }}
                    onClick={() => setPhaseModal({ mode: 'add' })}
                  >
                    + Add first phase
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Phase Modal ── */}
      {phaseModal && (
        <PhaseModal
          phase={phaseModal.mode === 'edit' ? phaseModal.phase : null}
          onSave={savePhase}
          onClose={() => setPhaseModal(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PAGE STYLES
// ═══════════════════════════════════════════════════════════════

const pageStyles = {
  container: { display: 'flex', height: '100%', overflow: 'hidden' },
  editor: { flex: 1, overflowY: 'auto', background: 'var(--bg-secondary)' },
  placeholder: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: 'var(--text-tertiary)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 24px 16px', background: 'var(--bg-primary)',
    borderBottom: '1px solid var(--border-color)',
  },
  actionBtn: {
    fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '6px 14px', cursor: 'pointer',
  },
};

const modalStyles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  sheet: {
    background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)',
    width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto',
    boxShadow: 'var(--shadow-lg)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid var(--border-color)',
  },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  closeBtn: {
    fontSize: 16, color: 'var(--text-tertiary)', background: 'none',
    border: 'none', cursor: 'pointer', padding: 4,
  },
  body: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 20px', borderTop: '1px solid var(--border-color)',
  },
  label: {
    fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block',
  },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)', outline: 'none', background: 'var(--bg-primary)',
  },
  cancelBtn: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', cursor: 'pointer',
  },
  saveBtn: {
    fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', cursor: 'pointer',
  },
};
