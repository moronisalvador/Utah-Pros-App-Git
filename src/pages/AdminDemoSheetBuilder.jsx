// AdminDemoSheetBuilder — desktop admin tool to create / edit / publish
// demo_sheet_schemas. Drives the section/field tree the field-tech demo
// sheet renders from. v1 (initial port) was seeded via Phase 1; admins
// here can clone it, edit anything, and publish a new active version.
//
// Phase 3a: JSON-based editor (the schema is JSONB; a structured visual
// editor is Phase 3b). Lets you add/remove/reorder sections, fields,
// option lists, room presets — anything the schema supports.
//
// Each saved sheet is FK'd to its schema_id (Phase 1), so editing /
// publishing a new schema does NOT change how previously-saved sheets
// render — they keep their snapshot.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';

// Allowed field types (kept in sync with TechDemoSheet's FieldRenderer).
const FIELD_TYPES = [
  'stepper', 'single-chip', 'multi-chip', 'text', 'textarea',
  'checkbox', 'select', 'list', 'row',
];

function emptySchema() {
  return {
    version: 1,
    name: 'New schema',
    roomPresets: [],
    sections: [],
  };
}

// Quick structural validation. Doesn't fully type-check; just catches
// the obvious "what did I just paste in there" mistakes.
function validateSchemaShape(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['Definition must be an object'];
  if (!Array.isArray(def.roomPresets)) errors.push('roomPresets must be an array of strings');
  if (!Array.isArray(def.sections))    errors.push('sections must be an array');
  (def.sections || []).forEach((s, i) => {
    if (!s.key)   errors.push(`sections[${i}]: missing "key"`);
    if (!s.label) errors.push(`sections[${i}]: missing "label"`);
    if (!s.alwaysOn && !s.gateField) {
      errors.push(`sections[${i}] (${s.key || 'unnamed'}): must have alwaysOn=true or a gateField`);
    }
    if (s.alwaysOn && !s.doneFlag) {
      errors.push(`sections[${i}] (${s.key || 'unnamed'}): alwaysOn=true requires a doneFlag`);
    }
    if (!Array.isArray(s.fields)) errors.push(`sections[${i}] (${s.key || 'unnamed'}): fields must be an array`);
    walkFields(s.fields || [], (f, path) => {
      if (f.type === 'row') {
        if (!Array.isArray(f.fields)) errors.push(`${path}: row must have a "fields" array`);
        if (typeof f.cols !== 'number') errors.push(`${path}: row missing numeric "cols"`);
        return;
      }
      if (!f.key) errors.push(`${path}: missing "key"`);
      if (!f.type) errors.push(`${path}: missing "type"`);
      else if (!FIELD_TYPES.includes(f.type)) errors.push(`${path}: unknown type "${f.type}"`);
      if (f.type === 'list' && !Array.isArray(f.itemFields)) {
        errors.push(`${path}: list field needs "itemFields"`);
      }
    });
  });
  return errors;
}

function walkFields(fields, fn, basePath = '') {
  (fields || []).forEach((f, i) => {
    const path = `${basePath}[${i}]${f.key ? `:${f.key}` : (f.type === 'row' ? ':row' : '')}`;
    fn(f, path);
    if (f.type === 'row')  walkFields(f.fields, fn, path);
    if (f.type === 'list') walkFields(f.itemFields || [], fn, path + '.itemFields');
  });
}

// Quick read-only summary of the schema for the header panel.
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
  const [definitionText, setDefinitionText] = useState('');
  const [originalText, setOriginalText] = useState('');
  const [parsedDef, setParsedDef] = useState(null);
  const [parseError, setParseError] = useState(null);

  const [confirmPublish, setConfirmPublish] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('list_demo_schemas');
      setVersions(rows || []);
      if (!selectedId && rows?.length) {
        // Default to the active one, else the newest.
        const active = rows.find(r => r.is_active) || rows[0];
        setSelectedId(active.id);
      }
    } catch (e) {
      toast?.('Failed to load schemas: ' + (e.message || 'unknown'), 'error');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useEffect(() => { loadVersions(); }, [loadVersions]);

  // Load full schema when selection changes.
  useEffect(() => {
    if (!selectedId) {
      setName(''); setNotes(''); setDefinitionText(''); setOriginalText(''); setParsedDef(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rows = await db.rpc('get_demo_schema', { p_id: selectedId });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (cancelled) return;
        if (row) {
          setName(row.name || '');
          setNotes(row.notes || '');
          const text = JSON.stringify(row.definition, null, 2);
          setDefinitionText(text);
          setOriginalText(text);
          setParsedDef(row.definition);
          setParseError(null);
        }
      } catch (e) {
        if (!cancelled) toast?.('Failed to load schema: ' + (e.message || 'unknown'), 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [db, selectedId]);

  // Re-parse on every keystroke so we can show validation live.
  useEffect(() => {
    if (!definitionText) { setParsedDef(null); setParseError(null); return; }
    try {
      const obj = JSON.parse(definitionText);
      setParsedDef(obj);
      setParseError(null);
    } catch (e) {
      setParsedDef(null);
      setParseError(e.message || 'Invalid JSON');
    }
  }, [definitionText]);

  const validationErrors = useMemo(
    () => parsedDef ? validateSchemaShape(parsedDef) : [],
    [parsedDef],
  );

  const dirty = definitionText !== originalText;
  const summary = parsedDef ? summarize(parsedDef) : null;
  const selected = versions.find(v => v.id === selectedId) || null;
  const canEdit = employee?.role === 'admin';
  const isActive = !!selected?.is_active;

  const handleNewDraft = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      // Clone from currently-active schema if there is one, otherwise empty.
      let baseDef = emptySchema();
      const active = versions.find(v => v.is_active);
      if (active) {
        const rows = await db.rpc('get_demo_schema', { p_id: active.id });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row?.definition) baseDef = row.definition;
      }
      const newName = `Draft ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      const newId = await db.rpc('upsert_demo_schema', {
        p_id: null,
        p_name: newName,
        p_definition: baseDef,
        p_notes: 'Draft — not yet published',
        p_created_by: employee?.id || null,
      });
      toast?.('New draft created');
      await loadVersions();
      setSelectedId(newId);
    } catch (e) {
      toast?.('Failed to create draft: ' + (e.message || 'unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit || !selected || !parsedDef) return;
    if (validationErrors.length) {
      toast?.(`Fix ${validationErrors.length} validation error${validationErrors.length > 1 ? 's' : ''} first`, 'error');
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
      setOriginalText(definitionText);
      toast?.('Saved');
      await loadVersions();
    } catch (e) {
      toast?.('Save failed: ' + (e.message || 'unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!canEdit || !selected) return;
    setPublishing(true);
    try {
      await db.rpc('publish_demo_schema', { p_id: selected.id });
      toast?.(`Published — ${selected.name} is now active`, 'success');
      setConfirmPublish(false);
      await loadVersions();
    } catch (e) {
      toast?.('Publish failed: ' + (e.message || 'unknown'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  if (!canEdit) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Admin only</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 6 }}>
          The Demo Sheet Builder is restricted to admin users.
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
            Demo Sheet Builder
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 720 }}>
            Edit the section + field tree the field-tech Demo Sheet renders from. Each saved
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
          <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                Versions
              </div>
              <button onClick={handleNewDraft} disabled={saving} className="btn btn-primary btn-sm" style={{ padding: '4px 10px', fontSize: 12 }}>
                + New
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {versions.map(v => {
                const active = selectedId === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedId(v.id)}
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
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        v{v.version} · {v.name}
                      </span>
                      {v.is_active && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {v.sheet_count || 0} sheet{v.sheet_count === 1 ? '' : 's'} · {new Date(v.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </button>
                );
              })}
              {versions.length === 0 && (
                <div style={{ padding: '24px 14px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                  No schemas yet. Click + New.
                </div>
              )}
            </div>
          </div>

          {/* Right: editor */}
          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {/* Top action bar */}
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                      Name
                    </div>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="input"
                      style={{ width: '100%' }}
                      placeholder="e.g. v2 — May 2026"
                    />
                  </div>
                  <div style={{ flex: 2, minWidth: 280 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                      Notes (admin only)
                    </div>
                    <input
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      className="input"
                      style={{ width: '100%' }}
                      placeholder="What changed in this version?"
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <button
                      onClick={handleSave}
                      disabled={saving || !!parseError || validationErrors.length > 0 || !dirty}
                      className="btn btn-secondary btn-sm"
                      style={{ minWidth: 90 }}
                    >
                      {saving ? 'Saving…' : (dirty ? 'Save' : 'Saved')}
                    </button>
                    {!isActive && (
                      <button
                        onClick={() => setConfirmPublish(true)}
                        disabled={publishing || !!parseError || validationErrors.length > 0 || dirty}
                        className="btn btn-primary btn-sm"
                        style={{ minWidth: 90 }}
                        title={dirty ? 'Save first, then publish' : 'Make this the active schema'}
                      >
                        Publish
                      </button>
                    )}
                  </div>
                </div>

                {/* Stats / status row */}
                <div style={{ display: 'flex', gap: 16, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-light)', fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
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
                  {parseError && <div style={{ color: '#dc2626', fontWeight: 600 }}>JSON error</div>}
                  {!parseError && validationErrors.length > 0 && <div style={{ color: '#d97706', fontWeight: 600 }}>{validationErrors.length} validation issue{validationErrors.length === 1 ? '' : 's'}</div>}
                </div>
              </div>

              {/* JSON editor */}
              <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                    Definition (JSON)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    Edit sections, fields, options, room presets here.
                  </div>
                </div>
                <textarea
                  value={definitionText}
                  onChange={e => setDefinitionText(e.target.value)}
                  spellCheck={false}
                  style={{
                    width: '100%', minHeight: 480,
                    padding: 'var(--space-3)',
                    fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5,
                    border: 'none', outline: 'none', resize: 'vertical',
                    background: 'var(--bg-primary)', color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Validation panel */}
              {(parseError || validationErrors.length > 0) && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#dc2626', marginBottom: 8 }}>
                    Issues
                  </div>
                  {parseError && (
                    <div style={{ fontSize: 12, color: '#dc2626', fontFamily: 'var(--font-mono)', marginBottom: 6 }}>
                      JSON parse error: {parseError}
                    </div>
                  )}
                  {validationErrors.map((err, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#d97706', marginBottom: 4 }}>
                      • {err}
                    </div>
                  ))}
                </div>
              )}

              {/* Section preview (read-only summary; full visual preview is Phase 3b) */}
              {parsedDef && validationErrors.length === 0 && (
                <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                    Section overview
                  </div>
                  <div>
                    {(parsedDef.sections || []).map((sec, i) => (
                      <div key={sec.key || i} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-light)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 16 }}>{sec.icon || '•'}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{sec.label}</span>
                          <code style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{sec.key}</code>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: sec.alwaysOn ? '#eff6ff' : '#fffbeb', color: sec.alwaysOn ? '#2563eb' : '#d97706', border: `1px solid ${sec.alwaysOn ? '#bfdbfe' : '#fde68a'}` }}>
                            {sec.alwaysOn ? 'Always on' : `Gated · ${sec.gateField}`}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', paddingLeft: 24 }}>
                          {(() => {
                            let count = 0;
                            walkFields(sec.fields || [], () => { count++; });
                            return `${count} field${count === 1 ? '' : 's'}`;
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Publish confirm modal */}
      {confirmPublish && selected && (
        <div onClick={() => !publishing && setConfirmPublish(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius-lg)', padding: 24, width: '100%', maxWidth: 440, boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
              Publish v{selected.version} — {selected.name}?
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
              Future demo sheets will use this schema. Existing saved sheets keep their snapshot.
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
