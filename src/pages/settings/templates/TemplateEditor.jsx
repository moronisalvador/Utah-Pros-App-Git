/**
 * ════════════════════════════════════════════════
 * FILE: TemplateEditor.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The editor screen for one legal document template. You type the heading and
 *   body for each section, drop in {{variables}}, toggle a live preview, and save.
 *   Certificate of Completion has one section per restoration division; the other
 *   documents are a single long section.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/templates/:docType (rendered inside the editor page)
 *   Rendered by:  src/pages/settings/Templates.jsx (the editor route wrapper)
 *
 * DEPENDS ON:
 *   Packages:  react (useState, useRef, useEffect)
 *   Internal:  ./templateData (defaults, variables, markdown + preview helpers)
 *   Data:      reads → none directly · writes → document_templates (via the
 *              upsert_document_template RPC, using the db passed in props)
 *
 * NOTES / GOTCHAS:
 *   - Extracted verbatim (behavior-identical) from the old Settings.jsx monolith
 *     during Settings Overhaul Phase F. The in-component confirmBack covers the
 *     breadcrumb "Documents" button; the ROUTE wrapper adds a router-level
 *     unsaved-changes guard via onDirtyChange (dirty is lifted to the parent).
 *   - Feedback via toasts (CLAUDE.md rule 2), no alert()/confirm().
 *   - Reset-to-defaults uses the same inline two-click confirm as the delete
 *     pattern (CLAUDE.md rule 2) — added in Settings Overhaul P4 (this module
 *     has exactly one in-wave consumer, the P4 Templates pages, so the change
 *     was made directly here rather than a copy-in; see P4's close-out notes).
 * ════════════════════════════════════════════════
 */
import { useState, useRef, useEffect } from 'react';
import {
  DEFAULT_TEMPLATES, DIVISION_META, TEMPLATE_VARIABLES, DOC_TYPE_LABELS,
  renderMarkdown, substituteVarsPreview,
} from './templateData';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

function IconEye(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>);}
function IconEyeOff(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>);}
function IconRefresh(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.1"/></svg>);}
function IconChevronLeft(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="15 18 9 12 15 6"/></svg>);}

const tplLbl = { display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 };

export default function TemplateEditor({ db, docType, docMeta, initialSections, onBack, onSaved, onDirtyChange }) {
  const [sections,    setSections]    = useState(() => initialSections.map(s => ({ ...s })));
  const [dirty,       setDirty]       = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [preview,     setPreview]     = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const lastFocused = useRef(null);

  // Lift dirty state so the route wrapper can install a router-level guard.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const update = (idx, field, value) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
    setDirty(true);
  };

  const insertVar = (varKey) => {
    if (!lastFocused.current) return;
    const { el, idx, field } = lastFocused.current;
    if (!el) return;
    const start  = el.selectionStart ?? el.value.length;
    const end    = el.selectionEnd   ?? el.value.length;
    const newVal = el.value.substring(0, start) + varKey + el.value.substring(end);
    update(idx, field, newVal);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + varKey.length, start + varKey.length); });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(sections.map(s => db.rpc('upsert_document_template', {
        p_doc_type: docType, p_division: s.division, p_heading: s.heading, p_body: s.body, p_sort_order: s.sort_order,
      })));
      setDirty(false);
      onSaved(sections);
    } catch (err) { errToast('Save failed: ' + err.message); }
    finally { setSaving(false); }
  };

  const handleReset = () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    setSections((DEFAULT_TEMPLATES[docType] || []).map(d => ({ ...d })));
    setDirty(true);
  };
  const handleBack  = () => { if (dirty) { setConfirmBack(true); return; } onBack(); };
  const isLong = docType !== 'coc';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleBack} style={{ gap: 4, padding: '0 8px', height: 30 }}>
            <IconChevronLeft style={{ width: 14, height: 14 }} /> Documents
          </button>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>/</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{docMeta?.icon} {docMeta?.label}</span>
          {dirty && <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>● Unsaved</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            onBlur={() => setConfirmReset(false)}
            style={{
              gap: 4,
              background: confirmReset ? 'var(--status-needs-response-bg)' : undefined,
              color: confirmReset ? 'var(--status-needs-response)' : undefined,
              border: confirmReset ? '1px solid #fecaca' : undefined,
            }}
            title="Reset to built-in defaults"
          >
            <IconRefresh style={{ width: 12, height: 12 }} /> {confirmReset ? 'Confirm reset?' : 'Reset'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => !p)} style={{ gap: 4 }}>
            {preview ? <><IconEyeOff style={{ width: 14, height: 14 }} /> Edit</> : <><IconEye style={{ width: 14, height: 14 }} /> Preview</>}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleBack}>Discard</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {confirmBack && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: '#92400e', flex: 1 }}>You have unsaved changes. Discard them?</span>
          <button className="btn btn-sm" onClick={onBack} style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', fontSize: 12 }}>Discard changes</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmBack(false)} style={{ fontSize: 12 }}>Keep editing</button>
        </div>
      )}

      {preview ? (
        <TemplatePreview docType={docType} sections={sections} />
      ) : (
        <>
          <div style={{ marginBottom: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Insert variable at cursor</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {TEMPLATE_VARIABLES.map(v => (
                <button key={v.key} onClick={() => insertVar(v.key)} style={{
                  fontSize: 11, fontFamily: 'monospace', cursor: 'pointer',
                  background: v.special ? '#eff6ff' : 'var(--bg-primary)',
                  border: `1px solid ${v.special ? '#bfdbfe' : 'var(--border-color)'}`,
                  borderRadius: 4, padding: '3px 8px',
                  color: v.special ? '#1d4ed8' : 'var(--brand-primary)',
                  fontWeight: 600, lineHeight: 1.4,
                }} title={v.special ? 'Smart: renders insurance DTP or private-pay+conditional-assignment paragraph based on job' : `Insert ${v.key}`}>
                  {v.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6 }}>
              <strong style={{ color: '#1d4ed8' }}>Insurance/Pay §</strong> — insurance job: DTP paragraph · out-of-pocket: private-pay + pre-assignment clause if claim is ever filed later
            </div>
          </div>

          <div style={{ marginBottom: 12, fontSize: 11, color: 'var(--text-tertiary)' }}>
            Formatting: <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3 }}>## Heading</code> for section titles &nbsp;·&nbsp;
            <code style={{ background: 'var(--bg-tertiary)', padding: '1px 4px', borderRadius: 3 }}>**bold**</code> for emphasis &nbsp;·&nbsp; Ctrl+B = bold
          </div>

          {sections.map((sec, idx) => {
            const divMeta = sec.division ? DIVISION_META[sec.division] : null;
            return (
              <SectionEditor key={idx} divMeta={divMeta} heading={sec.heading} body={sec.body}
                onHeadingChange={v => update(idx, 'heading', v)}
                onBodyChange={v => update(idx, 'body', v)}
                onFocus={(el, field) => { lastFocused.current = { el, idx, field }; }}
                isLong={isLong}
              />
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border-light)' }}>
            <button className="btn btn-secondary btn-sm" onClick={handleBack}>Discard</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ═══ RICH TEXT AREA ═══ */
function RichTextArea({ value, onChange, onFocus, isLong }) {
  const ref = useRef(null);

  const wrapSelection = (marker) => {
    const el = ref.current; if (!el) return;
    const start  = el.selectionStart; const end = el.selectionEnd;
    const sel    = el.value.substring(start, end);
    const newVal = el.value.substring(0, start) + marker + sel + marker + el.value.substring(end);
    onChange(newVal);
    requestAnimationFrame(() => {
      el.focus();
      const pos = sel.length > 0 ? start + marker.length + sel.length + marker.length : start + marker.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const toggleHeading = () => {
    const el = ref.current; if (!el) return;
    const start     = el.selectionStart;
    const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
    const rest      = el.value.substring(lineStart);
    const isH       = rest.startsWith('## ');
    onChange(el.value.substring(0, lineStart) + (isH ? rest.slice(3) : '## ' + rest));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + (isH ? -3 : 3), start + (isH ? -3 : 3)); });
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); wrapSelection('**'); }
  };

  const tbBtn = { fontSize: 11, fontWeight: 700, padding: '2px 8px', height: 24, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 4, cursor: 'pointer', color: 'var(--text-secondary)', lineHeight: 1, display: 'inline-flex', alignItems: 'center' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, padding: '4px 6px', background: 'var(--bg-secondary)', borderRadius: '6px 6px 0 0', border: '1px solid var(--border-light)', borderBottom: 'none' }}>
        <button type="button" onClick={() => wrapSelection('**')} style={{ ...tbBtn, fontWeight: 900, fontSize: 13 }} title="Bold (Ctrl+B)">B</button>
        <button type="button" onClick={toggleHeading}             style={tbBtn}                                        title="Section Heading (## )">H</button>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', alignSelf: 'center', marginLeft: 4 }}>Ctrl+B = bold</span>
      </div>
      <textarea ref={ref} className="input textarea" value={value} onChange={e => onChange(e.target.value)} onFocus={e => { onFocus?.(e.target); }} onKeyDown={handleKeyDown}
        rows={isLong ? 20 : 4} style={{ fontSize: 13, lineHeight: 1.65, resize: 'vertical', minHeight: isLong ? 280 : 72, fontFamily: 'monospace', borderRadius: '0 0 6px 6px' }} />
    </div>
  );
}

/* ═══ SECTION EDITOR ═══ */
function SectionEditor({ divMeta, heading, body, onHeadingChange, onBodyChange, onFocus, isLong }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
      {divMeta && (
        <button onClick={() => setExpanded(p => !p)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-secondary)', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: expanded ? '1px solid var(--border-light)' : 'none' }}>
          <span style={{ fontSize: 16 }}>{divMeta.emoji}</span>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{divMeta.label}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)', fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
        </button>
      )}
      {(expanded || !divMeta) && (
        <div style={{ padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={tplLbl}>Section Heading</label>
            <input className="input" value={heading} onChange={e => onHeadingChange(e.target.value)} onFocus={e => onFocus(e.target, 'heading')} style={{ height: 34, fontSize: 13 }} />
          </div>
          <div>
            <label style={tplLbl}>Body Text</label>
            <RichTextArea value={body} onChange={onBodyChange} onFocus={el => onFocus(el, 'body')} isLong={isLong} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ TEMPLATE PREVIEW ═══ */
function TemplatePreview({ docType, sections }) {
  const [oop, setOop] = useState(false);
  return (
    <div>
      {docType === 'work_auth' && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Preview as:</span>
          <button className={`btn btn-sm ${!oop ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOop(false)} style={{ fontSize: 11 }}>Insurance job</button>
          <button className={`btn btn-sm ${oop  ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOop(true)}  style={{ fontSize: 11 }}>Out-of-pocket job</button>
        </div>
      )}
      <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ background: '#1e293b', padding: '12px 18px' }}>
          <div style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>Utah Pros Restoration</div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Licensed · Insured · Utah</div>
        </div>
        <div style={{ padding: '24px 28px', background: '#f8fafc', maxHeight: 620, overflowY: 'auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: '#0f172a' }}>{DOC_TYPE_LABELS[docType] || docType}</h3>
            <div style={{ width: 60, height: 3, background: '#2563eb', margin: '0 auto', borderRadius: 2 }} />
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '12px 16px', marginBottom: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
            {(oop
              ? [['Client','Dorothy Killian'],['Job #','UPR-2024-001'],['Property','1295 Oquirrh Dr, Provo, UT']]
              : [['Client','Dorothy Killian'],['Job #','UPR-2024-001'],['Property','1295 Oquirrh Dr, Provo, UT'],['Insurance','State Farm'],['Claim #','SF-12345678'],['Date of Loss','January 15, 2024']]
            ).map(([l,v]) => (
              <div key={l}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{l}</div>
                <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 500, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>
          {sections.map((s, i) => (
            <div key={i} style={{ marginBottom: 16, background: '#fff', padding: '14px 16px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1e293b' }}>
                {substituteVarsPreview(s.heading, !oop)}
              </p>
              <div>{renderMarkdown(substituteVarsPreview(s.body, !oop))}</div>
            </div>
          ))}
          <div style={{ padding: '12px 16px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', borderLeft: '3px solid #2563eb' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>Authorization clause, full-name field, signature pad, and agreement checkbox appear here in the actual document.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
