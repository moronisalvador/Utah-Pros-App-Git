/**
 * ════════════════════════════════════════════════
 * FILE: CrmForms.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The build-your-own lead form screen. You give a form a name, add the fields
 *   you want (name, phone, a dropdown, a consent checkbox, and so on), pick a
 *   couple of colors, and see a live preview as you go. "Save draft" keeps your
 *   changes private; "Publish" makes the form live at its own web address and
 *   never changes the previously-published copy. Once published you copy a
 *   one-line snippet to paste on the website, and a tab shows every submission
 *   that has come in.
 *
 * WHERE IT LIVES:
 *   Route:        /crm/forms
 *   Rendered by:  src/App.jsx, inside CrmLayout, behind
 *                 <FeatureRoute flag="page:crm">
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db, employee),
 *              functions/lib/forms.js (sanitizeLinkMarkup — the same XSS-safe
 *              link renderer the hosted form uses, so the preview matches live)
 *   Data:      reads  → form_definitions/versions/submissions (get_forms RPC)
 *              writes → form_definitions/versions (upsert_form RPC)
 *
 * NOTES / GOTCHAS:
 *   - Owned by Phase 10 (.claude/rules/crm-wave-ownership.md).
 *   - Labels / description / thank-you support a restricted [text](url) link
 *     markup only. The preview renders them through sanitizeLinkMarkup (the
 *     unit-tested sanitizer) into innerHTML — never raw user input.
 *   - Not a drag-and-drop builder by design (roadmap): fields reorder with
 *     up/down buttons, which is simpler and more reliable.
 *   - The embed origin is window.location.origin, so the copied snippet points
 *     at whichever host (dev/prod) the CRM is being used from.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sanitizeLinkMarkup, validateSubmission } from '../../../functions/lib/forms.js';
import { ok, err } from '@/lib/toast';

const FIELD_TYPES = [
  { type: 'text',     label: 'Text' },
  { type: 'email',    label: 'Email' },
  { type: 'phone',    label: 'Phone' },
  { type: 'textarea', label: 'Long text' },
  { type: 'select',   label: 'Dropdown' },
  { type: 'radio',    label: 'Multiple choice' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'date',     label: 'Date' },
  { type: 'consent',  label: 'Consent (SMS opt-in)' },
];
// Field types that carry a list of options (dropdown, multiple-choice, checkbox group).
const OPTION_TYPES = new Set(['select', 'radio', 'checkbox']);
// Types whose live render honors a placeholder (so we only show that control for them).
const PLACEHOLDER_TYPES = new Set(['text', 'email', 'phone', 'textarea']);
// Types that accept a simple default value the visitor can change.
const DEFAULT_TYPES = new Set(['text', 'email', 'phone', 'textarea', 'date', 'select', 'radio']);
const DEFAULT_THEME = { primary: '#6366f1', background: '#ffffff', text: '#111827' };

// Field width on the row. Fields flow into a 6-column grid; two halves or three
// thirds share one line, everything collapses to a single column on mobile.
const WIDTHS = [
  { value: 'full',  label: 'Full width' },
  { value: 'half',  label: 'Half (½)' },
  { value: 'third', label: 'Third (⅓)' },
];
// Class suffix for a field's width ('' for full so existing/default fields are untouched).
const widthClass = (w) => (w === 'half' ? ' w-half' : w === 'third' ? ' w-third' : '');

const CONSENT_DEFAULT =
  'I agree to receive SMS text messages from Utah Pros Restoration about my request, and I agree to the ' +
  '[Privacy Policy](https://utahrestorationpros.com/privacy-policy) and ' +
  '[Terms & Conditions](https://utahrestorationpros.com/terms-and-conditions). ' +
  'Message & data rates may apply. Reply STOP to opt out.';

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
}
function uniqueKey(base, fields) {
  const taken = new Set(fields.map((f) => f.key));
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

function starterForm() {
  return {
    id: null,
    public_id: null,
    name: 'New lead form',
    status: 'draft',
    turnstile_enabled: false,
    theme: { ...DEFAULT_THEME },
    fields: [
      { key: 'name',    type: 'text',    label: 'Full name', required: true, placeholder: '' },
      { key: 'phone',   type: 'phone',   label: 'Phone',     required: true, placeholder: '' },
      { key: 'email',   type: 'email',   label: 'Email',     required: false, placeholder: '' },
      { key: 'message', type: 'textarea', label: 'How can we help?', required: false, placeholder: '' },
      { key: 'consent', type: 'consent', label: CONSENT_DEFAULT, required: true },
    ],
    description: '',
    submitText: 'Request a quote',
    thankYou: 'Thanks — a Utah Pros team member will reach out shortly.',
    submissions: [],
    submission_count: 0,
  };
}

// Turn a get_forms row into the editor's working shape (prefers the draft schema).
function toEditor(form) {
  const schema = form.draft_schema || form.published_schema || {};
  return {
    id: form.id,
    public_id: form.public_id,
    name: form.name,
    status: form.status,
    turnstile_enabled: !!form.turnstile_enabled,
    theme: { ...DEFAULT_THEME, ...(form.theme || {}) },
    fields: Array.isArray(schema.fields) ? schema.fields.map((f) => ({ ...f })) : [],
    description: schema.description || '',
    submitText: schema.submitText || 'Submit',
    thankYou: schema.thankYou || '',
    submissions: form.submissions || [],
    submission_count: form.submission_count || 0,
  };
}

export default function CrmForms() {
  const { db, employee } = useAuth();
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState(null); // null = list view
  const [tab, setTab] = useState('build');
  const [saving, setSaving] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_forms', {});
      setForms(rows || []);
    } catch {
      err('Failed to load forms');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditor(starterForm()); setTab('build'); setConfirmPublish(false); };
  const openForm = (form) => { setEditor(toEditor(form)); setTab('build'); setConfirmPublish(false); };
  const closeEditor = () => { setEditor(null); load(); };

  // ─── SECTION: Field handlers ───
  const setField = (idx, patch) =>
    setEditor((e) => ({ ...e, fields: e.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) }));
  const addField = (type) =>
    setEditor((e) => {
      const label = type === 'consent' ? CONSENT_DEFAULT : `${FIELD_TYPES.find((t) => t.type === type).label} field`;
      const field = { key: uniqueKey(slugify(label), e.fields), type, label, required: false };
      if (OPTION_TYPES.has(type)) field.options = ['Option 1', 'Option 2'];
      return { ...e, fields: [...e.fields, field] };
    });
  const duplicateField = (idx) =>
    setEditor((e) => {
      const src = e.fields[idx];
      const copy = { ...src, options: src.options ? [...src.options] : undefined, key: uniqueKey(slugify(src.label || src.type), e.fields) };
      const next = [...e.fields];
      next.splice(idx + 1, 0, copy);
      return { ...e, fields: next };
    });
  const removeField = (idx) => setEditor((e) => ({ ...e, fields: e.fields.filter((_, i) => i !== idx) }));
  const moveField = (idx, dir) =>
    setEditor((e) => {
      const next = [...e.fields];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return e;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...e, fields: next };
    });

  // Persist options as a trimmed, blank-free string[] so no consumer ever sees an
  // empty option (which would otherwise be a selectable/valid value).
  const cleanField = (f) => {
    if (!OPTION_TYPES.has(f.type)) return f;
    return { ...f, options: (f.options || []).map((o) => o.trim()).filter(Boolean) };
  };
  const buildSchema = (e) => ({
    fields: e.fields.map(cleanField),
    description: e.description || undefined,
    submitText: e.submitText || 'Submit',
    thankYou: e.thankYou || undefined,
  });

  const validateBeforeSave = (e) => {
    if (!e.name.trim()) return 'Give the form a name.';
    if (e.fields.length === 0) return 'Add at least one field.';
    for (const f of e.fields) {
      if (!f.label || !f.label.trim()) return 'Every field needs a label.';
      if (OPTION_TYPES.has(f.type) && (!f.options || f.options.filter((o) => o.trim()).length === 0))
        return `"${f.label}" needs at least one option.`;
    }
    return null;
  };

  const save = async (publish) => {
    const problem = validateBeforeSave(editor);
    if (problem) { err(problem); return; }
    setSaving(true);
    try {
      const row = await db.rpc('upsert_form', {
        p_id: editor.id,
        p_name: editor.name.trim(),
        p_schema: buildSchema(editor),
        p_theme: editor.theme,
        p_turnstile_enabled: editor.turnstile_enabled,
        p_publish: !!publish,
        p_created_by: employee?.id || null,
      });
      const saved = Array.isArray(row) ? row[0] : row;
      setEditor((e) => ({ ...e, id: saved.id, public_id: saved.public_id, status: saved.status }));
      ok(publish ? 'Form published' : 'Draft saved');
      setConfirmPublish(false);
      // Refresh the underlying list so submissions/status stay current.
      load();
    } catch (e2) {
      err(e2.message || 'Failed to save form');
    } finally {
      setSaving(false);
    }
  };

  const archive = async (form) => {
    try {
      await db.rpc('upsert_form', { p_id: form.id, p_status: 'archived' });
      ok('Form archived');
      load();
    } catch (e2) {
      err(e2.message || 'Failed to archive');
    }
  };

  if (loading) return <div className="crm-page"><div className="crm-loading">Loading…</div></div>;

  if (!editor) {
    return <FormsList forms={forms} onNew={openNew} onOpen={openForm} onArchive={archive} />;
  }

  return (
    <FormEditor
      editor={editor}
      setEditor={setEditor}
      tab={tab}
      setTab={setTab}
      saving={saving}
      confirmPublish={confirmPublish}
      setConfirmPublish={setConfirmPublish}
      onSave={save}
      onClose={closeEditor}
      fieldHandlers={{ setField, addField, removeField, moveField, duplicateField }}
    />
  );
}

// ─── SECTION: List view ───
function FormsList({ forms, onNew, onOpen, onArchive }) {
  const [confirmArchiveId, setConfirmArchiveId] = useState(null);
  return (
    <div className="crm-page">
      <div className="crm-page-header crm-forms-header">
        <div>
          <h1 className="crm-page-title">Forms</h1>
          <p className="crm-page-subtitle">Build embeddable lead-capture forms for your website. Every submission becomes a lead with full ad attribution.</p>
        </div>
        <button className="crm-btn crm-btn-primary" onClick={onNew}>+ New form</button>
      </div>

      {forms.length === 0 ? (
        <div className="crm-forms-empty">No forms yet. Create your first lead form to embed on the site.</div>
      ) : (
        <div className="crm-forms-grid">
          {forms.map((f) => (
            <div key={f.id} className="crm-forms-card">
              <div className="crm-forms-card-top" onClick={() => onOpen(f)} role="button" tabIndex={0}
                   onKeyDown={(e) => { if (e.key === 'Enter') onOpen(f); }}>
                <div className="crm-forms-card-name">{f.name}</div>
                <span className={`crm-badge crm-forms-status crm-forms-status-${f.status}`}>{f.status}</span>
              </div>
              <div className="crm-forms-card-meta">
                {f.submission_count} submission{f.submission_count === 1 ? '' : 's'}
              </div>
              <div className="crm-forms-card-actions">
                <button className="crm-btn crm-btn-ghost" onClick={() => onOpen(f)}>Edit</button>
                {confirmArchiveId === f.id ? (
                  <button className="crm-btn crm-btn-danger" onClick={() => { onArchive(f); setConfirmArchiveId(null); }} onBlur={() => setConfirmArchiveId(null)}>Confirm archive?</button>
                ) : (
                  <button className="crm-btn crm-btn-ghost" onClick={() => setConfirmArchiveId(f.id)}>Archive</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SECTION: Editor ───
function FormEditor({ editor, setEditor, tab, setTab, saving, confirmPublish, setConfirmPublish, onSave, onClose, fieldHandlers }) {
  const { setField, addField, removeField, moveField, duplicateField } = fieldHandlers;
  const [addType, setAddType] = useState('text');

  const embedSnippet = editor.public_id
    ? `<script src="${window.location.origin}/embed.js" data-upr-form="${editor.public_id}" async></script>`
    : '';

  return (
    <div className="crm-page crm-forms-editor">
      <div className="crm-page-header crm-forms-header">
        <div className="crm-forms-titlewrap">
          <button className="crm-btn crm-btn-ghost" onClick={onClose}>← All forms</button>
          <input
            className="crm-integration-input crm-forms-name-input"
            value={editor.name}
            onChange={(e) => setEditor((s) => ({ ...s, name: e.target.value }))}
            placeholder="Form name"
          />
          <span className={`crm-badge crm-forms-status crm-forms-status-${editor.status}`}>{editor.status}</span>
        </div>
        <div className="crm-forms-save-actions">
          <button className="crm-btn crm-btn-ghost" disabled={saving} onClick={() => onSave(false)}>Save draft</button>
          {confirmPublish ? (
            <button className="crm-btn crm-btn-primary" disabled={saving} onClick={() => onSave(true)} onBlur={() => setConfirmPublish(false)}>
              {saving ? 'Publishing…' : 'Confirm publish'}
            </button>
          ) : (
            <button className="crm-btn crm-btn-primary" disabled={saving} onClick={() => setConfirmPublish(true)}>Publish</button>
          )}
        </div>
      </div>

      <div className="crm-forms-tabs">
        {['build', 'preview', 'submissions', 'embed'].map((t) => (
          <button key={t} className={`crm-forms-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t === 'build' ? 'Build' : t === 'preview' ? 'Preview' : t === 'submissions' ? `Submissions (${editor.submission_count})` : 'Embed'}
          </button>
        ))}
      </div>

      {tab === 'build' && (
        <div className="crm-forms-build">
          <div className="crm-forms-fields">
            {editor.fields.map((f, idx) => (
              <FieldRow
                key={idx}
                field={f}
                idx={idx}
                count={editor.fields.length}
                onChange={(patch) => setField(idx, patch)}
                onRemove={() => removeField(idx)}
                onMove={(dir) => moveField(idx, dir)}
                onDuplicate={() => duplicateField(idx)}
              />
            ))}

            <div className="crm-forms-addbar">
              <select className="crm-integration-input" value={addType} onChange={(e) => setAddType(e.target.value)}>
                {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <button className="crm-btn crm-btn-primary" onClick={() => addField(addType)}>+ Add field</button>
            </div>
          </div>

          <div className="crm-forms-settings">
            <div className="crm-forms-setting-group">
              <label className="crm-forms-label">Description (optional)</label>
              <textarea className="crm-integration-input" rows={2} value={editor.description}
                        onChange={(e) => setEditor((s) => ({ ...s, description: e.target.value }))}
                        placeholder="Short text above the form. [links](https://…) allowed." />
            </div>
            <div className="crm-forms-setting-group">
              <label className="crm-forms-label">Submit button text</label>
              <input className="crm-integration-input" value={editor.submitText}
                     onChange={(e) => setEditor((s) => ({ ...s, submitText: e.target.value }))} />
            </div>
            <div className="crm-forms-setting-group">
              <label className="crm-forms-label">Thank-you message</label>
              <textarea className="crm-integration-input" rows={2} value={editor.thankYou}
                        onChange={(e) => setEditor((s) => ({ ...s, thankYou: e.target.value }))}
                        placeholder="Shown after a successful submission. [links](https://…) allowed." />
            </div>

            <div className="crm-forms-setting-group">
              <label className="crm-forms-label">Theme</label>
              <div className="crm-forms-theme">
                {[['primary', 'Button'], ['background', 'Background'], ['text', 'Text']].map(([k, lbl]) => (
                  <label key={k} className="crm-forms-color">
                    <input type="color" value={editor.theme[k] || '#000000'}
                           onChange={(e) => setEditor((s) => ({ ...s, theme: { ...s.theme, [k]: e.target.value } }))} />
                    <span>{lbl}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="crm-forms-setting-group">
              <label className="crm-forms-toggle-row">
                <input type="checkbox" checked={editor.turnstile_enabled}
                       onChange={(e) => setEditor((s) => ({ ...s, turnstile_enabled: e.target.checked }))} />
                <span>Require Cloudflare Turnstile (bot check). Takes effect once a site key is configured.</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {tab === 'preview' && <FormPreview editor={editor} />}

      {tab === 'submissions' && <SubmissionsView submissions={editor.submissions} fields={editor.fields} />}

      {tab === 'embed' && (
        <div className="crm-forms-embed">
          {!editor.public_id || editor.status !== 'published' ? (
            <div className="crm-forms-embed-note">Publish the form to get its live embed snippet. A draft has no public address yet.</div>
          ) : (
            <>
              <p className="crm-forms-embed-note">Paste this snippet on any page of the website where the form should appear:</p>
              <pre className="crm-forms-embed-code"><code>{embedSnippet}</code></pre>
              <button className="crm-btn crm-btn-primary" onClick={() => { navigator.clipboard?.writeText(embedSnippet); ok('Embed snippet copied'); }}>Copy snippet</button>
              <p className="crm-forms-embed-note">Direct link: <a href={`${window.location.origin}/f/${editor.public_id}`} target="_blank" rel="noreferrer">{`${window.location.origin}/f/${editor.public_id}`}</a></p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── SECTION: Field editor row ───
function FieldRow({ field, idx, count, onChange, onRemove, onMove, onDuplicate }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const options = field.options || [];
  const hasOptions = OPTION_TYPES.has(field.type);

  // Changing type seeds an option list when moving into an options type.
  const changeType = (type) => {
    const patch = { type };
    if (OPTION_TYPES.has(type) && (!field.options || field.options.length === 0)) patch.options = ['Option 1', 'Option 2'];
    onChange(patch);
  };
  const setOption = (i, val) => onChange({ options: options.map((o, k) => (k === i ? val : o)) });
  const addOption = () => onChange({ options: [...options, `Option ${options.length + 1}`] });
  const removeOption = (i) => onChange({ options: options.filter((_, k) => k !== i) });
  const moveOption = (i, dir) => {
    const next = [...options];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ options: next });
  };

  const labelHint = field.type === 'consent'
    ? 'Consent wording (shown next to the checkbox)'
    : field.type === 'checkbox' ? 'Question (shown above the checkboxes)' : 'Field label';

  return (
    <div className="crm-forms-field">
      <div className="crm-forms-field-head">
        <select
          className="crm-integration-input crm-forms-type-select"
          value={field.type}
          onChange={(e) => changeType(e.target.value)}
          aria-label="Field type"
        >
          {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </select>
        <div className="crm-forms-field-move">
          <button className="crm-btn crm-btn-ghost" disabled={idx === 0} onClick={() => onMove(-1)} title="Move up">↑</button>
          <button className="crm-btn crm-btn-ghost" disabled={idx === count - 1} onClick={() => onMove(1)} title="Move down">↓</button>
          <button className="crm-btn crm-btn-ghost" onClick={onDuplicate} title="Duplicate field">⧉</button>
          {confirmRemove ? (
            <button className="crm-btn crm-btn-danger" onClick={onRemove} onBlur={() => setConfirmRemove(false)}>Remove?</button>
          ) : (
            <button className="crm-btn crm-btn-ghost" onClick={() => setConfirmRemove(true)}>Remove</button>
          )}
        </div>
      </div>

      {field.type === 'consent' ? (
        <>
          <textarea
            className="crm-integration-input crm-forms-consent-input"
            rows={3}
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder={labelHint}
          />
          <div className="crm-forms-consent-hint">
            Add links with <code>[text](https://…)</code> — e.g. <code>[Privacy Policy](https://utahrestorationpros.com/privacy-policy)</code>. Only the text shows; links open in a new tab.
          </div>
        </>
      ) : (
        <input
          className="crm-integration-input"
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={labelHint}
        />
      )}

      <input
        className="crm-integration-input crm-forms-help-input"
        value={field.help || ''}
        onChange={(e) => onChange({ help: e.target.value })}
        placeholder="Help text under the field (optional)"
      />

      {hasOptions && (
        <div className="crm-forms-options-editor">
          {options.map((o, i) => (
            <div key={i} className="crm-forms-option-row">
              <input
                className="crm-integration-input"
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
              />
              <button className="crm-btn crm-btn-ghost" disabled={i === 0} onClick={() => moveOption(i, -1)} title="Move up">↑</button>
              <button className="crm-btn crm-btn-ghost" disabled={i === options.length - 1} onClick={() => moveOption(i, 1)} title="Move down">↓</button>
              <button className="crm-btn crm-btn-ghost" disabled={options.length <= 1} onClick={() => removeOption(i)} title="Remove option">✕</button>
            </div>
          ))}
          <button className="crm-btn crm-btn-ghost crm-forms-add-option" onClick={addOption}>+ Add option</button>
          {field.type === 'select' && (
            <input
              className="crm-integration-input crm-forms-prompt-input"
              value={field.prompt || ''}
              onChange={(e) => onChange({ prompt: e.target.value })}
              placeholder="First-choice prompt (default: Choose…)"
            />
          )}
        </div>
      )}

      <div className="crm-forms-field-foot">
        {PLACEHOLDER_TYPES.has(field.type) && (
          <input
            className="crm-integration-input crm-forms-placeholder"
            value={field.placeholder || ''}
            onChange={(e) => onChange({ placeholder: e.target.value })}
            placeholder="Placeholder (optional)"
          />
        )}
        {DEFAULT_TYPES.has(field.type) && (
          (field.type === 'select' || field.type === 'radio') ? (
            <select
              className="crm-integration-input crm-forms-default-select"
              value={field.default || ''}
              onChange={(e) => onChange({ default: e.target.value })}
              aria-label="Default value"
            >
              <option value="">No default</option>
              {options.filter((o) => o.trim()).map((o, i) => <option key={i} value={o}>{`Default: ${o}`}</option>)}
            </select>
          ) : (
            <input
              className="crm-integration-input crm-forms-default"
              type={field.type === 'date' ? 'date' : 'text'}
              value={field.default || ''}
              onChange={(e) => onChange({ default: e.target.value })}
              placeholder="Default value (optional)"
            />
          )
        )}
        <div className="crm-forms-field-controls">
          <label className="crm-forms-required">
            <input type="checkbox" checked={!!field.required} onChange={(e) => onChange({ required: e.target.checked })} /> Required
          </label>
          <label className="crm-forms-width">
            Width
            <select
              className="crm-integration-input crm-forms-width-select"
              value={field.width || 'full'}
              onChange={(e) => onChange({ width: e.target.value })}
            >
              {WIDTHS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

// ─── SECTION: Live preview (mirrors the hosted page; labels via the sanitizer) ───
function SafeInline({ text, tag = 'span', className }) {
  const Tag = tag;
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: sanitizeLinkMarkup(text || '') }} />;
}

// Seed the interactive preview's answers from each field's default.
function initialAnswers(fields) {
  const a = {};
  for (const f of fields) {
    if (!f.key) continue;
    if (f.type === 'checkbox') {
      const opts = (f.options || []).filter((o) => o.trim());
      a[f.key] = opts.length === 0 ? false : (Array.isArray(f.default) ? f.default : []);
    } else if (f.type === 'consent') {
      a[f.key] = false;
    } else {
      a[f.key] = f.default || '';
    }
  }
  return a;
}

function FormPreview({ editor }) {
  const theme = editor.theme || DEFAULT_THEME;
  const style = { '--upr-primary': theme.primary, '--upr-bg': theme.background, '--upr-text': theme.text };
  const fields = editor.fields;
  const [answers, setAnswers] = useState(() => initialAnswers(fields));
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);

  const setAns = (key, val) => setAnswers((a) => ({ ...a, [key]: val }));
  const toggleBox = (key, opt) => setAnswers((a) => {
    const cur = Array.isArray(a[key]) ? a[key] : [];
    return { ...a, [key]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
  });
  const reset = () => { setAnswers(initialAnswers(fields)); setErrors({}); setDone(false); };
  const submit = () => {
    // Same validator the live form uses — preview behavior == production behavior.
    const res = validateSubmission({ fields }, answers);
    setErrors(res.errors);
    if (res.valid) setDone(true);
  };

  if (done) {
    return (
      <div className="crm-forms-preview-wrap">
        <div className="crm-forms-preview" style={style}>
          <SafeInline tag="div" className="crm-forms-preview-thanks" text={editor.thankYou || 'Thank you — we\'ll be in touch shortly.'} />
          <div className="crm-forms-preview-testnote">Preview only — nothing was saved.</div>
          <button className="crm-btn crm-btn-ghost" onClick={reset}>Test again</button>
        </div>
      </div>
    );
  }

  const published = editor.public_id && editor.status === 'published';
  return (
    <div className="crm-forms-preview-wrap">
      <div className="crm-forms-preview" style={style}>
        <div className="crm-forms-preview-banner">
          Preview — fill it in to test. Nothing here is saved.
          {published && <> · <a href={`${window.location.origin}/f/${editor.public_id}`} target="_blank" rel="noreferrer">Open live form ↗</a></>}
        </div>
        <div className="crm-forms-preview-title">{editor.name || 'Untitled form'}</div>
        {editor.description && <SafeInline tag="p" className="crm-forms-preview-desc" text={editor.description} />}
        <div className="crm-forms-preview-grid">
          {fields.map((f, i) => (
            <div key={f.key || i} className={`crm-forms-preview-row${widthClass(f.width)}`}>
              <PreviewField field={f} value={answers[f.key]} setAns={setAns} toggleBox={toggleBox} error={errors[f.key]} />
            </div>
          ))}
        </div>
        <button className="crm-forms-preview-submit" onClick={submit}>{editor.submitText || 'Submit'}</button>
      </div>
    </div>
  );
}

// One interactive field in the preview. Mirrors the hosted page's render per type.
function PreviewField({ field: f, value, setAns, toggleBox, error }) {
  const opts = (f.options || []).filter((o) => o.trim());
  const help = f.help ? <SafeInline tag="div" className="crm-forms-preview-help" text={f.help} /> : null;
  const errEl = error ? <div className="crm-forms-preview-error">{error}</div> : null;
  const labelText = f.label + (f.required ? ' *' : '');

  // Consent, or a legacy single checkbox (no options) → one box.
  if (f.type === 'consent' || (f.type === 'checkbox' && opts.length === 0)) {
    return (
      <>
        <label className="crm-forms-preview-choice">
          <input type="checkbox" checked={!!value} onChange={(e) => setAns(f.key, e.target.checked)} />
          <SafeInline text={labelText} />
        </label>
        {help}{errEl}
      </>
    );
  }
  // Checkbox group (multi-select).
  if (f.type === 'checkbox') {
    const arr = Array.isArray(value) ? value : [];
    return (
      <>
        <SafeInline className="crm-forms-preview-label" text={labelText} />
        <div className="crm-forms-preview-radios">
          {opts.map((o, k) => (
            <label key={k}><input type="checkbox" checked={arr.includes(o)} onChange={() => toggleBox(f.key, o)} /> {o}</label>
          ))}
        </div>
        {help}{errEl}
      </>
    );
  }

  const label = <SafeInline className="crm-forms-preview-label" text={labelText} />;
  let control;
  if (f.type === 'textarea') {
    control = <textarea rows={3} placeholder={f.placeholder || ''} value={value || ''} onChange={(e) => setAns(f.key, e.target.value)} />;
  } else if (f.type === 'select') {
    control = (
      <select value={value || ''} onChange={(e) => setAns(f.key, e.target.value)}>
        <option value="">{f.prompt || 'Choose…'}</option>
        {opts.map((o, k) => <option key={k} value={o}>{o}</option>)}
      </select>
    );
  } else if (f.type === 'radio') {
    control = (
      <div className="crm-forms-preview-radios">
        {opts.map((o, k) => (
          <label key={k}><input type="radio" name={f.key} checked={value === o} onChange={() => setAns(f.key, o)} /> {o}</label>
        ))}
      </div>
    );
  } else {
    const inputType = f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text';
    control = <input type={inputType} placeholder={f.placeholder || ''} value={value || ''} onChange={(e) => setAns(f.key, e.target.value)} />;
  }
  return <>{label}{control}{help}{errEl}</>;
}

// ─── SECTION: Submissions ───
// Checkbox-group values arrive as arrays; single boxes as booleans.
function renderSubValue(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

function SubmissionsView({ submissions, fields }) {
  const labelFor = useMemo(() => {
    const map = {};
    (fields || []).forEach((f) => { map[f.key] = f.label; });
    return map;
  }, [fields]);

  if (!submissions || submissions.length === 0) {
    return <div className="crm-forms-empty">No submissions yet.</div>;
  }
  return (
    <div className="crm-forms-subs">
      {submissions.map((s) => (
        <div key={s.id} className="crm-forms-sub">
          <div className="crm-forms-sub-head">
            <span className="crm-forms-sub-date">{new Date(s.created_at).toLocaleString()}</span>
            {s.is_spam && <span className="crm-badge crm-badge-lost">spam</span>}
          </div>
          <div className="crm-forms-sub-body">
            {Object.entries(s.data || {}).map(([k, v]) => (
              <div key={k} className="crm-forms-sub-field">
                <span className="crm-forms-sub-key">{labelFor[k] || k}</span>
                <span className="crm-forms-sub-val">{renderSubValue(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
