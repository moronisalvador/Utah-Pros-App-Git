// AdminDemoSheetBuilder — desktop admin tool to create / edit / publish
// demo_sheet_schemas. Phase 3b: visual section/field tree editor (with a
// JSON view toggle for power users), full add/remove/reorder, options
// editing inline, recursive editors for `list` and `row` field types.
//
// Each saved sheet is FK'd to its schema_id (Phase 1), so editing /
// publishing a new schema does NOT change how previously-saved sheets
// render — they keep their snapshot.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import { RoomCard, JobSections, makeDefaultRoom, makeDefaultJobData, C as RC } from '@/components/demo-sheet/DemoSheetRenderer';

// Allowed field types (kept in sync with TechDemoSheet's FieldRenderer).
const FIELD_TYPES = [
  'stepper', 'single-chip', 'multi-chip', 'text', 'textarea',
  'checkbox', 'select', 'list', 'row', 'computed',
];

const FIELD_TYPE_LABELS = {
  'stepper':     'Number stepper (+/-)',
  'single-chip': 'Single choice (chips)',
  'multi-chip':  'Multi choice (chips)',
  'text':        'Short text',
  'textarea':    'Long text',
  'checkbox':    'Checkbox',
  'select':      'Dropdown',
  'list':        'Repeating list',
  'row':         'Row layout (group N fields)',
  'computed':    'Computed (a × b)',
};

// ── Schema-mutation helpers ──────────────────────────────────────────────────
function move(arr, from, to) {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
function removeAt(arr, i)        { return arr.slice(0, i).concat(arr.slice(i + 1)); }
function replaceAt(arr, i, val)  { const next = arr.slice(); next[i] = val; return next; }

function emptySection() {
  return {
    key: `section${Date.now()}`,
    label: 'New section',
    icon: '✨',
    alwaysOn: true,
    doneFlag: `section${Date.now()}Done`,
    fields: [],
  };
}

function emptyField(type = 'stepper') {
  const base = { key: `field${Date.now()}`, label: 'New field', type };
  switch (type) {
    case 'stepper':     return { ...base, unit: '', step: 1, small: true };
    case 'single-chip': return { ...base, options: ['Option A', 'Option B'], cols: 2 };
    case 'multi-chip':  return { ...base, options: ['Option A', 'Option B'] };
    case 'text':        return { ...base, placeholder: '' };
    case 'textarea':    return { ...base, placeholder: '', rows: 3 };
    case 'checkbox':    return base;
    case 'select':      return { ...base, options: ['', 'Option A', 'Option B'] };
    case 'list':        return { ...base, addLabel: 'Add item', itemLabel: 'Item', defaultItem: {}, itemFields: [] };
    case 'row':         return { type: 'row', cols: 2, fields: [] };
    case 'computed':    return { ...base, formula: { op: 'multiply', a: '', b: '' }, unit: '', summaryKey: '' };
    default:            return base;
  }
}

function walkFields(fields, fn, basePath = '') {
  (fields || []).forEach((f, i) => {
    const path = `${basePath}[${i}]${f.key ? `:${f.key}` : (f.type === 'row' ? ':row' : '')}`;
    fn(f, path);
    if (f.type === 'row')  walkFields(f.fields, fn, path);
    if (f.type === 'list') walkFields(f.itemFields || [], fn, path + '.itemFields');
  });
}

function validateSchemaShape(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['Definition must be an object'];
  if (!Array.isArray(def.roomPresets)) errors.push('roomPresets must be an array of strings');
  if (!Array.isArray(def.sections))    errors.push('sections must be an array');

  // Validates one section (used for both per-room `sections` and job-level
  // `jobSections`). `group` is the array name used in error prefixes.
  const validateSection = (s, i, group) => {
    if (!s.key)   errors.push(`${group}[${i}]: missing "key"`);
    if (!s.label) errors.push(`${group}[${i}]: missing "label"`);
    if (!s.alwaysOn && !s.gateField) {
      errors.push(`${group}[${i}] (${s.key || 'unnamed'}): must have alwaysOn=true or a gateField`);
    }
    if (s.alwaysOn && !s.doneFlag) {
      errors.push(`${group}[${i}] (${s.key || 'unnamed'}): alwaysOn=true requires a doneFlag`);
    }
    if (!Array.isArray(s.fields)) errors.push(`${group}[${i}] (${s.key || 'unnamed'}): fields must be an array`);
    walkFields(s.fields || [], (f, path) => {
      if (f.type === 'row') {
        if (!Array.isArray(f.fields)) errors.push(`${group}${path}: row must have a "fields" array`);
        if (typeof f.cols !== 'number') errors.push(`${group}${path}: row missing numeric "cols"`);
        return;
      }
      if (!f.key) errors.push(`${group}${path}: missing "key"`);
      if (!f.type) errors.push(`${group}${path}: missing "type"`);
      else if (!FIELD_TYPES.includes(f.type)) errors.push(`${group}${path}: unknown type "${f.type}"`);
      if (f.type === 'list' && !Array.isArray(f.itemFields)) {
        errors.push(`${group}${path}: list field needs "itemFields"`);
      }
      if (f.type === 'computed') {
        if (!f.formula || !f.formula.a || !f.formula.b) {
          errors.push(`${group}${path}: computed field needs formula.a and formula.b (sibling field keys)`);
        }
      }
    });
  };

  (def.sections || []).forEach((s, i) => validateSection(s, i, 'sections'));

  // jobSections is OPTIONAL (v1 schemas don't have it). Only validate when present.
  if (def.jobSections !== undefined) {
    if (!Array.isArray(def.jobSections)) errors.push('jobSections must be an array');
    else (def.jobSections).forEach((s, i) => validateSection(s, i, 'jobSections'));
  }
  return errors;
}

function summarize(def) {
  const sections = def?.sections || [];
  let fieldCount = 0;
  sections.forEach(s => walkFields(s.fields || [], () => { fieldCount++; }));
  return {
    sectionCount: sections.length,
    fieldCount,
    roomPresets: (def?.roomPresets || []).length,
  };
}

function emptySchema() {
  return { version: 1, name: 'New schema', roomPresets: [], sections: [] };
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AdminDemoSheetBuilder() {
  const navigate = useNavigate();
  const { db, employee } = useAuth();

  const [versions, setVersions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  // parsedDef is the source of truth for the editor. JSON view re-stringifies.
  const [parsedDef, setParsedDef] = useState(null);
  const [originalSerialized, setOriginalSerialized] = useState('');
  const [viewMode, setViewMode] = useState('visual'); // 'visual' | 'json' | 'preview'
  const [jsonText, setJsonText] = useState('');
  const [jsonParseError, setJsonParseError] = useState(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('list_demo_schemas');
      setVersions(rows || []);
      if (!selectedId && rows?.length) {
        const active = rows.find(r => r.is_active) || rows[0];
        setSelectedId(active.id);
      }
    } catch (e) {
      toast('Failed to load schemas: ' + (e.message || 'unknown'), 'error');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  // Load full schema when selection changes.
  useEffect(() => {
    if (!selectedId) {
      setName(''); setNotes(''); setParsedDef(null); setOriginalSerialized(''); setJsonText('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await db.rpc('get_demo_schema', { p_id: selectedId });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (cancelled || !row) return;
        const def = row.definition || emptySchema();
        const text = JSON.stringify(def, null, 2);
        setName(row.name || '');
        setNotes(row.notes || '');
        setParsedDef(def);
        setJsonText(text);
        setOriginalSerialized(text);
        setJsonParseError(null);
      } catch (e) {
        if (!cancelled) toast('Failed to load schema: ' + (e.message || 'unknown'), 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [db, selectedId]);

  // Update parsedDef + jsonText together (visual edits).
  const updateDef = useCallback((next) => {
    setParsedDef(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonParseError(null);
  }, []);

  // JSON view re-parses on every keystroke.
  const onJsonChange = (text) => {
    setJsonText(text);
    try {
      const obj = JSON.parse(text);
      setParsedDef(obj);
      setJsonParseError(null);
    } catch (e) {
      setJsonParseError(e.message || 'Invalid JSON');
    }
  };

  const validationErrors = useMemo(
    () => parsedDef ? validateSchemaShape(parsedDef) : [],
    [parsedDef],
  );

  const dirty = jsonText !== originalSerialized;
  const summary = parsedDef ? summarize(parsedDef) : null;
  const selected = versions.find(v => v.id === selectedId) || null;
  const canEdit = employee?.role === 'admin';
  const isActive = !!selected?.is_active;

  const handleNewDraft = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      let baseDef = emptySchema();
      const active = versions.find(v => v.is_active);
      if (active) {
        const rows = await db.rpc('get_demo_schema', { p_id: active.id });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row?.definition) baseDef = row.definition;
      }
      const newName = `Draft ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      const newId = await db.rpc('upsert_demo_schema', {
        p_id: null, p_name: newName, p_definition: baseDef,
        p_notes: 'Draft — not yet published', p_created_by: employee?.id || null,
      });
      toast('New draft created');
      await loadVersions();
      setSelectedId(newId);
    } catch (e) {
      toast('Failed to create draft: ' + (e.message || 'unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit || !selected || !parsedDef) return;
    if (validationErrors.length || jsonParseError) {
      toast('Fix validation errors first', 'error');
      return;
    }
    setSaving(true);
    try {
      await db.rpc('upsert_demo_schema', {
        p_id: selected.id,
        p_name: name || selected.name,
        p_definition: parsedDef,
        p_notes: notes || null,
        p_created_by: employee?.id || null,
      });
      setOriginalSerialized(jsonText);
      toast('Saved');
      await loadVersions();
    } catch (e) {
      toast('Save failed: ' + (e.message || 'unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!canEdit || !selected) return;
    setPublishing(true);
    try {
      await db.rpc('publish_demo_schema', { p_id: selected.id });
      toast(`Published — ${selected.name} is now active`, 'success');
      setConfirmPublish(false);
      await loadVersions();
    } catch (e) {
      toast('Publish failed: ' + (e.message || 'unknown'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit || !selected || isActive) return;
    if (!window.confirm(`Delete v${selected.version} — ${selected.name}? This is permanent.`)) return;
    try {
      await db.delete?.('demo_sheet_schemas', `id=eq.${selected.id}`);
      toast('Schema deleted');
      setSelectedId(null);
      await loadVersions();
    } catch (e) {
      toast('Delete failed: ' + (e.message || 'unknown'), 'error');
    }
  };

  if (!canEdit) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Admin only</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
          The Scope Sheet Builder is restricted to admin users.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)', maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Admin · Tools
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: '4px 0 0' }}>
            Scope Sheet Builder
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 720 }}>
            Edit the section + field tree the field-tech Scope Sheet renders from. Each saved
            sheet is pinned to the schema version it was filled with, so changing this
            doesn't reshape past sheets.
          </div>
        </div>
        <button onClick={() => navigate(-1)} className="btn btn-secondary btn-sm">← Back</button>
      </div>

      {loading ? (
        <div className="loading-page" style={{ padding: 60 }}><div className="spinner" /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 'var(--space-4)', alignItems: 'start' }}>
          {/* Left: versions list */}
          <VersionsSidebar
            versions={versions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNewDraft={handleNewDraft}
            saving={saving}
          />

          {/* Right: editor */}
          {selected && parsedDef && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Top action bar */}
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <FieldLabel>Name</FieldLabel>
                    <input value={name} onChange={e => setName(e.target.value)} className="input" style={{ width: '100%' }} placeholder="e.g. v2 — May 2026" />
                  </div>
                  <div style={{ flex: 2, minWidth: 280 }}>
                    <FieldLabel>Notes (admin only)</FieldLabel>
                    <input value={notes} onChange={e => setNotes(e.target.value)} className="input" style={{ width: '100%' }} placeholder="What changed in this version?" />
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <button onClick={handleSave} disabled={saving || !!jsonParseError || validationErrors.length > 0 || !dirty} className="btn btn-secondary btn-sm" style={{ minWidth: 90 }}>
                      {saving ? 'Saving…' : (dirty ? 'Save' : 'Saved')}
                    </button>
                    {!isActive && (
                      <button onClick={() => setConfirmPublish(true)} disabled={publishing || !!jsonParseError || validationErrors.length > 0 || dirty} className="btn btn-primary btn-sm" style={{ minWidth: 90 }} title={dirty ? 'Save first, then publish' : 'Make this the active schema'}>
                        Publish
                      </button>
                    )}
                    {!isActive && (
                      <button onClick={handleDelete} className="btn btn-secondary btn-sm" style={{ color: '#dc2626' }} title="Delete this draft">
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* Stats / view toggle */}
                <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>v{selected.version}</strong>
                    {isActive && <span style={{ marginLeft: 6, color: '#16a34a', fontWeight: 600 }}>· active</span>}
                  </div>
                  {summary && (
                    <>
                      <div>{summary.sectionCount} sections</div>
                      <div>{summary.fieldCount} fields</div>
                      <div>{summary.roomPresets} room presets</div>
                    </>
                  )}
                  <div>{selected.sheet_count || 0} saved sheets</div>
                  {dirty && <div style={{ color: '#d97706', fontWeight: 600 }}>unsaved changes</div>}
                  {jsonParseError && <div style={{ color: '#dc2626', fontWeight: 600 }}>JSON error</div>}
                  {!jsonParseError && validationErrors.length > 0 && (
                    <div style={{ color: '#d97706', fontWeight: 600 }}>{validationErrors.length} validation issue{validationErrors.length === 1 ? '' : 's'}</div>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <ViewModeButton active={viewMode === 'visual'} onClick={() => setViewMode('visual')}>Visual</ViewModeButton>
                    <ViewModeButton active={viewMode === 'preview'} onClick={() => setViewMode('preview')}>Preview</ViewModeButton>
                    <ViewModeButton active={viewMode === 'json'} onClick={() => setViewMode('json')}>JSON</ViewModeButton>
                  </div>
                </div>
              </div>

              {viewMode === 'visual' && (
                <VisualEditor def={parsedDef} onChange={updateDef} />
              )}
              {viewMode === 'json' && (
                <JsonView text={jsonText} onChange={onJsonChange} />
              )}
              {viewMode === 'preview' && (
                <LivePreview def={parsedDef} />
              )}

              {/* Validation panel */}
              {(jsonParseError || validationErrors.length > 0) && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#dc2626', marginBottom: 8 }}>
                    Issues
                  </div>
                  {jsonParseError && (
                    <div style={{ fontSize: 12, color: '#dc2626', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                      JSON parse error: {jsonParseError}
                    </div>
                  )}
                  {validationErrors.map((err, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#d97706', marginBottom: 4 }}>• {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {confirmPublish && selected && (
        <div onClick={() => !publishing && setConfirmPublish(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', padding: 24, width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Publish v{selected.version} — {selected.name}?
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Future scope sheets will use this schema. Existing saved sheets keep their snapshot.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmPublish(false)} disabled={publishing} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handlePublish} disabled={publishing} className="btn btn-primary btn-sm">
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function VersionsSidebar({ versions, selectedId, onSelect, onNewDraft, saving }) {
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', position: 'sticky', top: 16 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Versions</div>
        <button onClick={onNewDraft} disabled={saving} className="btn btn-primary btn-sm" style={{ padding: '4px 10px', fontSize: 12 }}>+ New</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
        {versions.map(v => {
          const active = selectedId === v.id;
          return (
            <button key={v.id} onClick={() => onSelect(v.id)}
              style={{
                textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-light)',
                background: active ? 'var(--accent-light)' : 'var(--bg-primary)',
                borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
                cursor: 'pointer', fontFamily: 'var(--font-sans)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>v{v.version} · {v.name}</span>
                {v.is_active && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>ACTIVE</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {v.sheet_count || 0} sheet{v.sheet_count === 1 ? '' : 's'} · {new Date(v.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </button>
          );
        })}
        {versions.length === 0 && (
          <div style={{ padding: '24px 14px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>No schemas yet. Click + New.</div>
        )}
      </div>
    </div>
  );
}

function ViewModeButton({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '4px 10px', fontSize: 12, fontWeight: 600,
        borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-sans)',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border-color)'}`,
      }}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
      {children}
    </div>
  );
}

function JsonView({ text, onChange }) {
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
        Definition (raw JSON)
      </div>
      <textarea value={text} onChange={e => onChange(e.target.value)} spellCheck={false}
        style={{ width: '100%', minHeight: 480, padding: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, border: 'none', outline: 'none', resize: 'vertical', background: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
      />
    </div>
  );
}

// ── Visual editor ────────────────────────────────────────────────────────────
function VisualEditor({ def, onChange }) {
  const updateRoomPresets = (presets) => onChange({ ...def, roomPresets: presets });
  const updateSections    = (sections) => onChange({ ...def, sections });
  const updateJobSections = (jobSections) => onChange({ ...def, jobSections });

  const addSection = () => updateSections([...(def.sections || []), emptySection()]);
  const addJobSection = () => updateJobSections([...(def.jobSections || []), emptySection()]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <RoomPresetsCard presets={def.roomPresets || []} onChange={updateRoomPresets} />

      {/* Job-level sections (asked once per sheet — loss details, tests/Itel, etc.) */}
      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Job sections ({(def.jobSections || []).length}) — asked once
          </div>
          <button onClick={addJobSection} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', fontSize: 12 }}>+ Job section</button>
        </div>
        <div>
          {(def.jobSections || []).map((sec, i) => (
            <SectionCard
              key={i}
              section={sec}
              onChange={next => updateJobSections(replaceAt(def.jobSections, i, next))}
              onMoveUp={i > 0 ? () => updateJobSections(move(def.jobSections, i, i - 1)) : null}
              onMoveDown={i < def.jobSections.length - 1 ? () => updateJobSections(move(def.jobSections, i, i + 1)) : null}
              onRemove={() => {
                if (window.confirm(`Remove job section "${sec.label}"?`)) {
                  updateJobSections(removeAt(def.jobSections, i));
                }
              }}
            />
          ))}
          {(!def.jobSections || def.jobSections.length === 0) && (
            <div style={{ padding: '24px 14px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
              No job sections. These show first in the sheet (loss details, tests, etc.).
            </div>
          )}
        </div>
      </div>

      <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Sections ({(def.sections || []).length})
          </div>
          <button onClick={addSection} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px', fontSize: 12 }}>+ Section</button>
        </div>
        <div>
          {(def.sections || []).map((sec, i) => (
            <SectionCard
              key={i}
              section={sec}
              onChange={next => updateSections(replaceAt(def.sections, i, next))}
              onMoveUp={i > 0 ? () => updateSections(move(def.sections, i, i - 1)) : null}
              onMoveDown={i < def.sections.length - 1 ? () => updateSections(move(def.sections, i, i + 1)) : null}
              onRemove={() => {
                if (window.confirm(`Remove section "${sec.label}"?`)) {
                  updateSections(removeAt(def.sections, i));
                }
              }}
            />
          ))}
          {(!def.sections || def.sections.length === 0) && (
            <div style={{ padding: '24px 14px', fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center' }}>
              No sections yet. Click + Section to add one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RoomPresetsCard({ presets, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (!t || presets.includes(t)) { setDraft(''); return; }
    onChange([...presets, t]);
    setDraft('');
  };
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: open ? '1px solid var(--border-light)' : 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          Room presets ({presets.length})
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: 'var(--space-3)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {presets.map((p, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 4px 4px 10px', borderRadius: 999, background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                {p}
                <button onClick={() => onChange(removeAt(presets, i))} style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, padding: 0, width: 18, height: 18, borderRadius: 999 }} title="Remove">×</button>
              </span>
            ))}
            {presets.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>No presets.</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="e.g. Living Room" className="input" style={{ flex: 1 }} />
            <button onClick={add} disabled={!draft.trim()} className="btn btn-secondary btn-sm">Add preset</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionCard({ section, onChange, onMoveUp, onMoveDown, onRemove }) {
  const [open, setOpen] = useState(false);
  let fieldCount = 0;
  walkFields(section.fields || [], () => { fieldCount++; });

  const update = (patch) => onChange({ ...section, ...patch });

  return (
    <div style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: open ? 'var(--bg-secondary)' : 'transparent' }}>
        <button onClick={() => setOpen(!open)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 1, padding: 0, textAlign: 'left', fontFamily: 'var(--font-sans)' }}>
          <span style={{ fontSize: 16, width: 22 }}>{section.icon || '•'}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{section.label}</span>
          <code style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{section.key}</code>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
            background: section.alwaysOn ? '#eff6ff' : '#fffbeb',
            color: section.alwaysOn ? '#2563eb' : '#d97706',
            border: `1px solid ${section.alwaysOn ? '#bfdbfe' : '#fde68a'}`,
          }}>
            {section.alwaysOn ? 'Always on' : `Gated · ${section.gateField || '?'}`}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fieldCount} field{fieldCount === 1 ? '' : 's'}</span>
        </button>
        <RowButton disabled={!onMoveUp} onClick={onMoveUp} title="Move up">↑</RowButton>
        <RowButton disabled={!onMoveDown} onClick={onMoveDown} title="Move down">↓</RowButton>
        <RowButton onClick={onRemove} title="Remove section" style={{ color: '#dc2626' }}>🗑</RowButton>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 20, textAlign: 'center' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: 'var(--space-3)', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <FieldLabel>Label</FieldLabel>
              <input className="input" value={section.label || ''} onChange={e => update({ label: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Icon (emoji)</FieldLabel>
              <input className="input" value={section.icon || ''} onChange={e => update({ icon: e.target.value })} placeholder="📏" />
            </div>
            <div>
              <FieldLabel>Key (internal)</FieldLabel>
              <input className="input" value={section.key || ''} onChange={e => update({ key: e.target.value })} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <FieldLabel>Mode</FieldLabel>
              <select className="input" value={section.alwaysOn ? 'always' : 'gated'} onChange={e => {
                const v = e.target.value;
                if (v === 'always') update({ alwaysOn: true, doneFlag: section.doneFlag || `${section.key}Done`, gateField: undefined });
                else                update({ alwaysOn: false, gateField: section.gateField || section.key, doneFlag: undefined });
              }}>
                <option value="always">Always on</option>
                <option value="gated">Gated (Yes/No)</option>
              </select>
            </div>
            {section.alwaysOn ? (
              <div>
                <FieldLabel>Done flag (state key)</FieldLabel>
                <input className="input" value={section.doneFlag || ''} onChange={e => update({ doneFlag: e.target.value })} />
              </div>
            ) : (
              <div>
                <FieldLabel>Gate field (state key)</FieldLabel>
                <input className="input" value={section.gateField || ''} onChange={e => update({ gateField: e.target.value })} />
              </div>
            )}
            <div>
              <FieldLabel>Next button label</FieldLabel>
              <input className="input" value={section.nextLabel || ''} onChange={e => update({ nextLabel: e.target.value || undefined })} placeholder="Done → Next" />
            </div>
          </div>

          <FieldList
            fields={section.fields || []}
            onChange={next => update({ fields: next })}
            label="Fields"
          />
        </div>
      )}
    </div>
  );
}

function RowButton({ children, disabled, onClick, title, style }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{
        background: 'transparent', border: '1px solid var(--border-color)',
        borderRadius: 6, color: 'var(--text-secondary)',
        width: 28, height: 28, cursor: disabled ? 'default' : 'pointer',
        fontSize: 13, fontFamily: 'var(--font-sans)',
        opacity: disabled ? 0.3 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function FieldList({ fields, onChange, label }) {
  const addField = (type = 'stepper') => onChange([...(fields || []), emptyField(type)]);
  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          {label || 'Fields'} ({(fields || []).length})
        </div>
        <select onChange={e => { if (e.target.value) { addField(e.target.value); e.target.value = ''; } }} value="" className="input" style={{ width: 'auto', padding: '3px 8px', fontSize: 12 }}>
          <option value="">+ Add field…</option>
          {FIELD_TYPES.map(t => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
        </select>
      </div>
      <div>
        {(fields || []).map((field, i) => (
          <FieldCard
            key={i}
            field={field}
            onChange={next => onChange(replaceAt(fields, i, next))}
            onMoveUp={i > 0 ? () => onChange(move(fields, i, i - 1)) : null}
            onMoveDown={i < fields.length - 1 ? () => onChange(move(fields, i, i + 1)) : null}
            onRemove={() => onChange(removeAt(fields, i))}
          />
        ))}
        {(!fields || fields.length === 0) && (
          <div style={{ padding: '14px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>No fields. Use + Add field to insert.</div>
        )}
      </div>
    </div>
  );
}

function FieldCard({ field, onChange, onMoveUp, onMoveDown, onRemove }) {
  const [open, setOpen] = useState(false);
  const isRow = field.type === 'row';
  const isList = field.type === 'list';

  return (
    <div style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: open ? 'var(--bg-tertiary)' : 'transparent' }}>
        <button onClick={() => setOpen(!open)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flex: 1, padding: 0, textAlign: 'left', fontFamily: 'var(--font-sans)' }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', minWidth: 70, textAlign: 'center' }}>
            {field.type}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {isRow ? `Row · ${field.cols || 2} cols · ${(field.fields || []).length} fields` :
             isList ? `${field.itemLabel || 'Item'} list · ${(field.itemFields || []).length} sub-fields` :
             (field.label || field.key || '(no label)')}
          </span>
          {!isRow && field.key && (
            <code style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{field.key}</code>
          )}
          {!!(field.options?.length) && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{field.options.length} option{field.options.length === 1 ? '' : 's'}</span>
          )}
        </button>
        <RowButton disabled={!onMoveUp} onClick={onMoveUp} title="Move up">↑</RowButton>
        <RowButton disabled={!onMoveDown} onClick={onMoveDown} title="Move down">↓</RowButton>
        <RowButton onClick={onRemove} title="Remove field" style={{ color: '#dc2626' }}>×</RowButton>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', width: 20, textAlign: 'center' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ padding: 'var(--space-3)', background: 'var(--bg-tertiary)', borderTop: '1px solid var(--border-light)' }}>
          <FieldEditor field={field} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function FieldEditor({ field, onChange }) {
  const update = (patch) => onChange({ ...field, ...patch });
  const t = field.type;

  // "Required" applies to every answerable field. For a number it means the
  // tech must enter > 0; for a checkbox it must be checked; for a choice/text
  // it must be non-empty. Not offered for layout-only `row` or derived `computed`.
  const canRequire = t !== 'row' && t !== 'computed';

  // Type selector + universal fields
  const typeRow = (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <FieldLabel>Type</FieldLabel>
          <select className="input" value={t} onChange={e => onChange(emptyField(e.target.value))}>
            {FIELD_TYPES.map(x => <option key={x} value={x}>{FIELD_TYPE_LABELS[x]}</option>)}
          </select>
        </div>
        {t !== 'row' && (
          <>
            <div>
              <FieldLabel>Key (state)</FieldLabel>
              <input className="input" value={field.key || ''} onChange={e => update({ key: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Label (shown to tech)</FieldLabel>
              <input className="input" value={field.label || ''} onChange={e => update({ label: e.target.value || undefined })} />
            </div>
          </>
        )}
      </div>
      {canRequire && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={field.required === true} onChange={e => update({ required: e.target.checked || undefined })} />
          Required — the tech must answer this before they can continue past the section
        </label>
      )}
    </>
  );

  // Stepper-specific
  if (t === 'stepper') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Step (increment)</FieldLabel>
            <input className="input" type="number" step="0.1" value={field.step ?? 1} onChange={e => update({ step: parseFloat(e.target.value) || 1 })} />
          </div>
          <div>
            <FieldLabel>Unit</FieldLabel>
            <input className="input" value={field.unit || ''} onChange={e => update({ unit: e.target.value || undefined })} placeholder="LF / SF / ea" />
          </div>
          <div>
            <FieldLabel>Size</FieldLabel>
            <select className="input" value={field.small ? 'small' : 'normal'} onChange={e => update({ small: e.target.value === 'small' })}>
              <option value="normal">Normal</option>
              <option value="small">Small (compact)</option>
            </select>
          </div>
          <div>
            <FieldLabel>Summary key (for totals)</FieldLabel>
            <input className="input" value={field.summaryKey || ''} onChange={e => update({ summaryKey: e.target.value || undefined })} placeholder="(optional)" />
          </div>
        </div>
        <ShowWhenEditor field={field} onChange={onChange} />
        <UnitWhenEditor field={field} onChange={onChange} />
      </>
    );
  }

  if (t === 'single-chip' || t === 'multi-chip' || t === 'select') {
    return (
      <>
        {typeRow}
        {(t === 'single-chip') && (
          <div style={{ marginBottom: 12, maxWidth: 200 }}>
            <FieldLabel>Columns</FieldLabel>
            <input className="input" type="number" min="1" max="6" value={field.cols ?? 2} onChange={e => update({ cols: parseInt(e.target.value, 10) || 2 })} />
          </div>
        )}
        <OptionsEditor options={field.options || []} onChange={opts => update({ options: opts })} />
        <ShowWhenEditor field={field} onChange={onChange} />
      </>
    );
  }

  if (t === 'text') {
    return (
      <>
        {typeRow}
        <div>
          <FieldLabel>Placeholder</FieldLabel>
          <input className="input" value={field.placeholder || ''} onChange={e => update({ placeholder: e.target.value || undefined })} />
        </div>
        <ShowWhenEditor field={field} onChange={onChange} />
      </>
    );
  }

  if (t === 'textarea') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Placeholder</FieldLabel>
            <input className="input" value={field.placeholder || ''} onChange={e => update({ placeholder: e.target.value || undefined })} />
          </div>
          <div>
            <FieldLabel>Rows</FieldLabel>
            <input className="input" type="number" min="2" max="20" value={field.rows ?? 3} onChange={e => update({ rows: parseInt(e.target.value, 10) || 3 })} />
          </div>
        </div>
        <ShowWhenEditor field={field} onChange={onChange} />
      </>
    );
  }

  if (t === 'checkbox') {
    return (
      <>
        {typeRow}
        <ShowWhenEditor field={field} onChange={onChange} />
      </>
    );
  }

  if (t === 'list') {
    return (
      <>
        {typeRow}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <FieldLabel>"Add" button label</FieldLabel>
            <input className="input" value={field.addLabel || ''} onChange={e => update({ addLabel: e.target.value || undefined })} placeholder="Add item" />
          </div>
          <div>
            <FieldLabel>Item label (header inside each row)</FieldLabel>
            <input className="input" value={field.itemLabel || ''} onChange={e => update({ itemLabel: e.target.value || undefined })} placeholder="Item" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <FieldLabel>Default item (JSON; copied into each new row)</FieldLabel>
          <DefaultItemEditor value={field.defaultItem || {}} onChange={v => update({ defaultItem: v })} />
        </div>
        <FieldList
          fields={field.itemFields || []}
          onChange={next => update({ itemFields: next })}
          label="Item fields"
        />
        <ShowWhenEditor field={field} onChange={onChange} />
      </>
    );
  }

  if (t === 'row') {
    return (
      <>
        {typeRow}
        <div style={{ marginBottom: 12, maxWidth: 200 }}>
          <FieldLabel>Columns</FieldLabel>
          <input className="input" type="number" min="1" max="6" value={field.cols ?? 2} onChange={e => update({ cols: parseInt(e.target.value, 10) || 2 })} />
        </div>
        <FieldList
          fields={field.fields || []}
          onChange={next => update({ fields: next })}
          label="Row fields"
        />
      </>
    );
  }

  if (t === 'computed') {
    const formula = field.formula || { op: 'multiply', a: '', b: '' };
    const setFormula = (patch) => update({ formula: { ...formula, ...patch } });
    return (
      <>
        {typeRow}
        <div style={{ fontSize: 12, color: RC.muted, marginBottom: 10 }}>
          Read-only value that multiplies two sibling field keys in the same section
          (e.g. tension posts × days). Not entered by the tech.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 12, alignItems: 'end', marginBottom: 12 }}>
          <div>
            <FieldLabel>Field A (key)</FieldLabel>
            <input className="input" value={formula.a || ''} onChange={e => setFormula({ a: e.target.value })} placeholder="tensionPosts" />
          </div>
          <div style={{ textAlign: 'center', paddingBottom: 10, fontWeight: 700, color: RC.muted }}>×</div>
          <div>
            <FieldLabel>Field B (key)</FieldLabel>
            <input className="input" value={formula.b || ''} onChange={e => setFormula({ b: e.target.value })} placeholder="daysInPlace" />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <FieldLabel>Unit</FieldLabel>
            <input className="input" value={field.unit || ''} onChange={e => update({ unit: e.target.value || undefined })} placeholder="post-days" />
          </div>
          <div>
            <FieldLabel>Summary key (for totals)</FieldLabel>
            <input className="input" value={field.summaryKey || ''} onChange={e => update({ summaryKey: e.target.value || undefined })} placeholder="(optional)" />
          </div>
        </div>
        <ShowWhenEditor field={field} onChange={onChange} />
      </>
    );
  }

  return typeRow;
}

function ShowWhenEditor({ field, onChange }) {
  const sw = field.showWhen;
  const [enabled, setEnabled] = useState(!!sw);
  // When this editor instance is reused for a different field, resync the
  // toggle to that field's showWhen. Done during render (not in an effect) to
  // avoid a cascading re-render.
  const [prevSw, setPrevSw] = useState(sw);
  if (sw !== prevSw) { setPrevSw(sw); setEnabled(!!sw); }

  const set = (patch) => {
    const next = { ...(field.showWhen || {}), ...patch };
    onChange({ ...field, showWhen: next });
  };
  const clear = () => {
    const { showWhen, ...rest } = field;  // eslint-disable-line no-unused-vars
    onChange(rest);
    setEnabled(false);
  };

  if (!enabled) {
    return (
      <button onClick={() => { setEnabled(true); set({ field: '', equals: true }); }}
        className="btn btn-secondary btn-sm" style={{ marginTop: 12, padding: '4px 10px', fontSize: 12 }}>
        + Show only when…
      </button>
    );
  }

  const mode = sw?.includes !== undefined ? 'includes' : 'equals';
  return (
    <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <FieldLabel>Show only when…</FieldLabel>
        <button onClick={clear} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <input className="input" placeholder="Field key" value={sw?.field || ''} onChange={e => set({ field: e.target.value })} />
        <select className="input" value={mode} onChange={e => {
          if (e.target.value === 'equals') set({ equals: sw?.equals ?? sw?.includes ?? true, includes: undefined });
          else                              set({ includes: sw?.includes ?? sw?.equals ?? '', equals: undefined });
        }}>
          <option value="equals">equals</option>
          <option value="includes">includes (in array)</option>
        </select>
        {mode === 'equals' ? (
          <select className="input" value={String(sw?.equals)} onChange={e => {
            const v = e.target.value;
            set({ equals: v === 'true' ? true : v === 'false' ? false : v });
          }}>
            <option value="true">true</option>
            <option value="false">false</option>
            {typeof sw?.equals === 'string' && <option value={sw.equals}>{`"${sw.equals}"`}</option>}
          </select>
        ) : (
          <input className="input" placeholder="Value" value={sw?.includes || ''} onChange={e => set({ includes: e.target.value })} />
        )}
      </div>
      {mode === 'equals' && typeof sw?.equals === 'string' && (
        <input className="input" style={{ marginTop: 8 }} placeholder="String value" value={sw.equals} onChange={e => set({ equals: e.target.value })} />
      )}
    </div>
  );
}

function UnitWhenEditor({ field, onChange }) {
  const uw = field.unitWhen;
  if (!uw) {
    return (
      <button onClick={() => onChange({ ...field, unitWhen: { field: '', equals: '', thenLabel: '', thenUnit: '' } })}
        className="btn btn-secondary btn-sm" style={{ marginTop: 8, padding: '4px 10px', fontSize: 12 }}>
        + Conditional unit (e.g. flood cuts LF→SF)
      </button>
    );
  }
  const set = (patch) => onChange({ ...field, unitWhen: { ...uw, ...patch } });
  const clear = () => {
    const { unitWhen, ...rest } = field;  // eslint-disable-line no-unused-vars
    onChange(rest);
  };
  return (
    <div style={{ marginTop: 8, padding: 12, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <FieldLabel>Conditional unit / label</FieldLabel>
        <button onClick={clear} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <input className="input" placeholder="When field key" value={uw.field || ''} onChange={e => set({ field: e.target.value })} />
        <input className="input" placeholder="equals (string)" value={uw.equals || ''} onChange={e => set({ equals: e.target.value })} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <input className="input" placeholder="then label" value={uw.thenLabel || ''} onChange={e => set({ thenLabel: e.target.value || undefined })} />
        <input className="input" placeholder="then unit" value={uw.thenUnit || ''} onChange={e => set({ thenUnit: e.target.value || undefined })} />
      </div>
    </div>
  );
}

function OptionsEditor({ options, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft;
    if (t === undefined || t === null) return;
    onChange([...(options || []), t]);
    setDraft('');
  };
  return (
    <div style={{ marginBottom: 12 }}>
      <FieldLabel>Options</FieldLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        {(options || []).map((opt, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input" value={opt} onChange={e => onChange(replaceAt(options, i, e.target.value))} style={{ flex: 1 }} />
            <RowButton disabled={i === 0} onClick={() => onChange(move(options, i, i - 1))} title="Move up">↑</RowButton>
            <RowButton disabled={i === options.length - 1} onClick={() => onChange(move(options, i, i + 1))} title="Move down">↓</RowButton>
            <RowButton onClick={() => onChange(removeAt(options, i))} title="Remove" style={{ color: '#dc2626' }}>×</RowButton>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add option…" className="input" style={{ flex: 1 }} />
        <button onClick={add} className="btn btn-secondary btn-sm">+ Add</button>
      </div>
    </div>
  );
}

function DefaultItemEditor({ value, onChange }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [error, setError] = useState(null);
  useEffect(() => { setText(JSON.stringify(value, null, 2)); }, [value]);
  const apply = (t) => {
    setText(t);
    try {
      const obj = JSON.parse(t);
      setError(null);
      onChange(obj);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <textarea value={text} onChange={e => apply(e.target.value)} spellCheck={false}
        style={{ width: '100%', minHeight: 80, padding: 8, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.4, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box', resize: 'vertical' }}
      />
      {error && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{error}</div>}
    </>
  );
}

// ── Live preview ─────────────────────────────────────────────────────────────
// Renders an interactive sample room using the shared RoomCard so admins can
// click through the schema as a tech would. Resets when the schema changes.
function LivePreview({ def }) {
  // Re-derive a fresh sample room every time the schema definition changes
  // (we don't try to keep state when fields are added/removed/renamed).
  const sampleRoom = useMemo(() => makeDefaultRoom(def), [def]);
  const [room, setRoom] = useState(sampleRoom);
  useEffect(() => { setRoom(sampleRoom); }, [sampleRoom]);

  const sampleJobData = useMemo(() => makeDefaultJobData(def), [def]);
  const [jobData, setJobData] = useState(sampleJobData);
  useEffect(() => { setJobData(sampleJobData); }, [sampleJobData]);

  const sectionCount = (def?.sections || []).length;
  const jobSectionCount = (def?.jobSections || []).length;

  return (
    <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          Preview · how a tech sees it
        </div>
        <button
          onClick={() => { setRoom(makeDefaultRoom(def)); setJobData(makeDefaultJobData(def)); }}
          className="btn btn-secondary btn-sm"
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          ↺ Reset
        </button>
      </div>
      <div style={{ padding: 'var(--space-3)', background: RC.bg, minHeight: 320 }}>
        {sectionCount === 0 && jobSectionCount === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: '40px 0' }}>
            No sections in this schema yet — add some in the Visual editor to see them here.
          </div>
        ) : (
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            {jobSectionCount > 0 && (
              <JobSections jobData={jobData} onChange={setJobData} schema={def} />
            )}
            {sectionCount > 0 && (
              <RoomCard
                room={room}
                index={0}
                onChange={setRoom}
                totalRooms={1}
                needsDimensions={false}
                schema={def}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
