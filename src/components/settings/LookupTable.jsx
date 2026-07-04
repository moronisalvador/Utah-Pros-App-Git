/**
 * ════════════════════════════════════════════════
 * FILE: LookupTable.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A reusable little spreadsheet for simple "name + a few fields" lists — used
 *   by the Insurance Carriers and Referral Sources settings screens. It shows the
 *   rows, lets you search, add, edit inline, and delete (with a two-click
 *   confirm). The parent screen supplies the data and the save/delete functions.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (shared presentational component)
 *   Rendered by:  src/pages/settings/Carriers.jsx, src/pages/settings/Referrals.jsx
 *
 * DEPENDS ON:
 *   Packages:  react (useState, useRef)
 *   Internal:  none (self-contained icons)
 *   Data:      reads → none directly · writes → none directly (onSave / onDelete
 *              callbacks passed by the parent do the actual RPC calls)
 *
 * NOTES / GOTCHAS:
 *   - Extracted verbatim (behavior-identical) from the old Settings.jsx monolith
 *     during Settings Overhaul Phase F. onSave must return a truthy value on
 *     success so the row exits edit mode; onDelete performs the delete.
 *   - Delete uses the inline two-click confirm pattern (CLAUDE.md rule 2), no
 *     modal.
 * ════════════════════════════════════════════════
 */
import { useState, useRef } from 'react';

function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconTrash(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconCheck(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconSearch(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);}

export default function LookupTable({ title, subtitle, items, onSave, onDelete, columns, newItemDefaults }) {
  const [search,          setSearch]          = useState('');
  const [editingId,       setEditingId]       = useState(null);
  const [editForm,        setEditForm]        = useState({});
  const [saving,          setSaving]          = useState(false);
  const [validationError, setValidationError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const nameRef = useRef(null);

  const filtered    = search.trim() ? items.filter(item => columns.some(col => { const val = item[col.key]; return val && String(val).toLowerCase().includes(search.toLowerCase()); })) : items;
  const startEdit   = (item) => { setEditingId(item.id); const form = {}; for (const col of columns) form[col.key] = item[col.key] ?? ''; form.id = item.id; setEditForm(form); setTimeout(() => nameRef.current?.focus(), 50); };
  const startAdd    = () => { setEditingId('new'); setEditForm({ ...newItemDefaults }); setTimeout(() => nameRef.current?.focus(), 50); };
  const cancelEdit  = () => { setEditingId(null); setEditForm({}); };
  const handleSave  = async () => {
    const required = columns.filter(c => c.required);
    for (const col of required) { if (!editForm[col.key]?.toString().trim()) { setValidationError(`${col.label} is required`); return; } }
    setValidationError(''); setSaving(true);
    const item = { ...editForm }; if (editingId === 'new') delete item.id;
    if (item.sort_order !== undefined) item.sort_order = parseInt(item.sort_order) || 999;
    const ok = await onSave(item); setSaving(false); if (ok) cancelEdit();
  };
  const handleDelete  = async (id) => { await onDelete(id); setConfirmDeleteId(null); };
  const handleKeyDown = (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } if (e.key === 'Escape') cancelEdit(); };
  const set           = (key, val) => setEditForm(prev => ({ ...prev, [key]: val }));

  const RowCells = () => columns.map(col => (
    <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
      {col.type === 'select'
        ? <select className="input lookup-input" value={editForm[col.key] || ''} onChange={e => set(col.key, e.target.value)} style={{ cursor: 'pointer' }}>{col.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        : <input ref={col.required ? nameRef : undefined} className="input lookup-input" type={col.type || 'text'} value={editForm[col.key] ?? ''} onChange={e => { set(col.key, e.target.value); setValidationError(''); }} onKeyDown={handleKeyDown} placeholder={col.placeholder || col.label} />
      }
    </div>
  ));

  return (
    <div className="lookup-table">
      <div className="lookup-header">
        <div><h2 className="lookup-title">{title}</h2><p className="lookup-subtitle">{subtitle}</p></div>
        <button className="btn btn-primary btn-sm" onClick={startAdd} disabled={editingId === 'new'}><IconPlus style={{ width: 14, height: 14 }} /> Add</button>
      </div>
      <div className="lookup-search-wrap">
        <IconSearch style={{ width: 14, height: 14 }} className="lookup-search-icon" />
        <input className="input lookup-search" placeholder={`Search ${title.toLowerCase()}...`} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="lookup-table-wrap">
        <div className="lookup-row lookup-row-header">
          {columns.map(col => <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>{col.label}</div>)}
          <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>Actions</div>
        </div>
        {editingId === 'new' && (
          <>
            <div className="lookup-row lookup-row-editing"><RowCells /><div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}><button className="lookup-action-btn save" onClick={handleSave} disabled={saving}><IconCheck style={{ width: 14, height: 14 }} /></button><button className="lookup-action-btn cancel" onClick={cancelEdit}><IconX style={{ width: 14, height: 14 }} /></button></div></div>
            {validationError && <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>{validationError}</div>}
          </>
        )}
        {filtered.length === 0 && editingId !== 'new'
          ? <div className="lookup-empty">{search ? `No results for "${search}"` : 'No items yet. Click "Add" to create one.'}</div>
          : filtered.map(item => editingId === item.id ? (
            <>
              <div key={item.id} className="lookup-row lookup-row-editing"><RowCells /><div className="lookup-cell lookup-cell-actions" style={{ width:80 }}><button className="lookup-action-btn save" onClick={handleSave} disabled={saving}><IconCheck style={{ width: 14, height: 14 }} /></button><button className="lookup-action-btn cancel" onClick={cancelEdit}><IconX style={{ width: 14, height: 14 }} /></button></div></div>
              {validationError && <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>{validationError}</div>}
            </>
          ) : (
            <div key={item.id} className="lookup-row">
              {columns.map(col => (
                <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                  {col.type === 'select' ? (col.options?.find(o => o.value === item[col.key])?.label || item[col.key] || '—') : (item[col.key] ?? '—')}
                </div>
              ))}
              <div className="lookup-cell lookup-cell-actions" style={{ width: confirmDeleteId === item.id ? 140 : 80 }}>
                {confirmDeleteId === item.id ? (<>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginRight: 4 }}>Delete?</span>
                  <button className="lookup-action-btn save" onClick={() => handleDelete(item.id)} style={{ background: '#fef2f2', color: '#ef4444' }}><IconCheck style={{ width: 14, height: 14 }} /></button>
                  <button className="lookup-action-btn cancel" onClick={() => setConfirmDeleteId(null)}><IconX style={{ width: 14, height: 14 }} /></button>
                </>) : (<>
                  <button className="lookup-action-btn edit"   onClick={() => startEdit(item)}             title="Edit"><IconEdit  style={{ width: 14, height: 14 }} /></button>
                  <button className="lookup-action-btn delete" onClick={() => setConfirmDeleteId(item.id)} title="Delete"><IconTrash style={{ width: 14, height: 14 }} /></button>
                </>)}
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}
