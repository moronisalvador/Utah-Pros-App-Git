import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));

/* ═══ ICONS ═══ */
function IconPlus(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);}
function IconTrash(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>);}
function IconEdit(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);}
function IconCheck(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="20 6 9 17 4 12"/></svg>);}
function IconX(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>);}
function IconGrip(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>);}
function IconShield(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>);}
function IconUsers(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>);}
function IconSearch(p){return(<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>);}

/* ═══ SETTINGS TABS ═══ */
const SETTINGS_TABS = [
  { key: 'carriers', label: 'Insurance Carriers', icon: IconShield },
  { key: 'referrals', label: 'Referral Sources', icon: IconUsers },
];

/* ═══ REFERRAL SOURCE CATEGORIES ═══ */
const REF_CATEGORIES = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'trade', label: 'Trade' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'digital', label: 'Digital / Marketing' },
  { value: 'traditional', label: 'Traditional' },
  { value: 'personal', label: 'Personal' },
  { value: 'program', label: 'Program / Network' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'other', label: 'Other' },
];

/* ═══ MAIN ═══ */
export default function Settings() {
  const { db } = useAuth();
  const [tab, setTab] = useState('carriers');
  const [carriers, setCarriers] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        db.rpc('get_insurance_carriers').catch(() => []),
        db.rpc('get_referral_sources').catch(() => []),
      ]);
      setCarriers(c);
      setReferrals(r);
    } catch (err) {
      console.error('Settings load error:', err);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  /* ── Carrier CRUD ── */
  const saveCarrier = async (item) => {
    try {
      const params = { p_name: item.name, p_short_name: item.short_name || null, p_sort_order: item.sort_order || 999 };
      if (item.id) params.p_id = item.id;
      await db.rpc('upsert_insurance_carrier', params);
      await load();
      return true;
    } catch (err) {
      errToast('Failed to save: ' + err.message);
      return false;
    }
  };

  const deleteCarrier = async (id) => {
    try {
      await db.rpc('delete_insurance_carrier', { p_id: id });
      setCarriers(prev => prev.filter(c => c.id !== id));
      return true;
    } catch (err) {
      errToast('Failed to delete: ' + err.message);
      return false;
    }
  };

  /* ── Referral CRUD ── */
  const saveReferral = async (item) => {
    try {
      const params = { p_name: item.name, p_category: item.category || 'other', p_sort_order: item.sort_order || 999 };
      if (item.id) params.p_id = item.id;
      await db.rpc('upsert_referral_source', params);
      await load();
      return true;
    } catch (err) {
      errToast('Failed to save: ' + err.message);
      return false;
    }
  };

  const deleteReferral = async (id) => {
    try {
      await db.rpc('delete_referral_source', { p_id: id });
      setReferrals(prev => prev.filter(r => r.id !== id));
      return true;
    } catch (err) {
      errToast('Failed to delete: ' + err.message);
      return false;
    }
  };

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage lookup tables, company preferences, and system configuration.</p>
      </div>

      <div className="settings-body">
        {/* Sidebar nav */}
        <div className="settings-nav">
          <div className="settings-nav-label">Lookup Tables</div>
          {SETTINGS_TABS.map(t => (
            <button
              key={t.key}
              className={`settings-nav-item${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <t.icon style={{ width: 16, height: 16 }} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="settings-content">
          {tab === 'carriers' && (
            <LookupTable
              title="Insurance Carriers"
              subtitle={`${carriers.length} carriers`}
              items={carriers}
              onSave={saveCarrier}
              onDelete={deleteCarrier}
              columns={[
                { key: 'name', label: 'Carrier Name', flex: 3, required: true },
                { key: 'short_name', label: 'Code', flex: 1, placeholder: 'SF' },
                { key: 'sort_order', label: 'Order', flex: 0.5, type: 'number', placeholder: '999' },
              ]}
              newItemDefaults={{ name: '', short_name: '', sort_order: 999 }}
            />
          )}
          {tab === 'referrals' && (
            <LookupTable
              title="Referral Sources"
              subtitle={`${referrals.length} sources`}
              items={referrals}
              onSave={saveReferral}
              onDelete={deleteReferral}
              columns={[
                { key: 'name', label: 'Source Name', flex: 3, required: true },
                { key: 'category', label: 'Category', flex: 2, type: 'select', options: REF_CATEGORIES },
                { key: 'sort_order', label: 'Order', flex: 0.5, type: 'number', placeholder: '999' },
              ]}
              newItemDefaults={{ name: '', category: 'other', sort_order: 999 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOOKUP TABLE — Generic CRUD table for any lookup data
   ═══════════════════════════════════════════════════════════════════ */
function LookupTable({ title, subtitle, items, onSave, onDelete, columns, newItemDefaults }) {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const nameRef = useRef(null);

  const filtered = search.trim()
    ? items.filter(item => columns.some(col => {
        const val = item[col.key];
        return val && String(val).toLowerCase().includes(search.toLowerCase());
      }))
    : items;

  const startEdit = (item) => {
    setEditingId(item.id);
    const form = {};
    for (const col of columns) form[col.key] = item[col.key] ?? '';
    form.id = item.id;
    setEditForm(form);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const startAdd = () => {
    setEditingId('new');
    setEditForm({ ...newItemDefaults });
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async () => {
    const required = columns.filter(c => c.required);
    for (const col of required) {
      if (!editForm[col.key]?.toString().trim()) {
        setValidationError(`${col.label} is required`);
        return;
      }
    }
    setValidationError('');
    setSaving(true);
    const item = { ...editForm };
    if (editingId === 'new') delete item.id;
    if (item.sort_order !== undefined) item.sort_order = parseInt(item.sort_order) || 999;
    const ok = await onSave(item);
    setSaving(false);
    if (ok) cancelEdit();
  };

  const handleDelete = async (id) => {
    await onDelete(id);
    setConfirmDeleteId(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') cancelEdit();
  };

  const set = (key, val) => setEditForm(prev => ({ ...prev, [key]: val }));

  return (
    <div className="lookup-table">
      {/* Header */}
      <div className="lookup-header">
        <div>
          <h2 className="lookup-title">{title}</h2>
          <p className="lookup-subtitle">{subtitle}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={startAdd} disabled={editingId === 'new'}>
          <IconPlus style={{ width: 14, height: 14 }} /> Add
        </button>
      </div>

      {/* Search */}
      <div className="lookup-search-wrap">
        <IconSearch style={{ width: 14, height: 14 }} className="lookup-search-icon" />
        <input
          className="input lookup-search"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="lookup-table-wrap">
        {/* Header row */}
        <div className="lookup-row lookup-row-header">
          {columns.map(col => (
            <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
              {col.label}
            </div>
          ))}
          <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>Actions</div>
        </div>

        {/* Add new row (if active) */}
        {editingId === 'new' && (
          <>
            <div className="lookup-row lookup-row-editing">
              {columns.map(col => (
                <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                  {col.type === 'select' ? (
                    <select className="input lookup-input" value={editForm[col.key] || ''} onChange={e => set(col.key, e.target.value)} style={{ cursor: 'pointer' }}>
                      {col.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      ref={col.required ? nameRef : undefined}
                      className="input lookup-input"
                      type={col.type || 'text'}
                      value={editForm[col.key] ?? ''}
                      onChange={e => { set(col.key, e.target.value); setValidationError(''); }}
                      onKeyDown={handleKeyDown}
                      placeholder={col.placeholder || col.label}
                    />
                  )}
                </div>
              ))}
              <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>
                <button className="lookup-action-btn save" onClick={handleSave} disabled={saving} title="Save">
                  <IconCheck style={{ width: 14, height: 14 }} />
                </button>
                <button className="lookup-action-btn cancel" onClick={cancelEdit} title="Cancel">
                  <IconX style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
            {validationError && (
              <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
                {validationError}
              </div>
            )}
          </>
        )}

        {/* Data rows */}
        {filtered.length === 0 && editingId !== 'new' ? (
          <div className="lookup-empty">
            {search ? `No results for "${search}"` : 'No items yet. Click "Add" to create one.'}
          </div>
        ) : (
          filtered.map(item => (
            editingId === item.id ? (
              /* Editing row */
              <>
                <div key={item.id} className="lookup-row lookup-row-editing">
                  {columns.map(col => (
                    <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                      {col.type === 'select' ? (
                        <select className="input lookup-input" value={editForm[col.key] || ''} onChange={e => set(col.key, e.target.value)} style={{ cursor: 'pointer' }}>
                          {col.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input
                          ref={col.required ? nameRef : undefined}
                          className="input lookup-input"
                          type={col.type || 'text'}
                          value={editForm[col.key] ?? ''}
                          onChange={e => { set(col.key, e.target.value); setValidationError(''); }}
                          onKeyDown={handleKeyDown}
                          placeholder={col.placeholder || col.label}
                        />
                      )}
                    </div>
                  ))}
                  <div className="lookup-cell lookup-cell-actions" style={{ width: 80 }}>
                    <button className="lookup-action-btn save" onClick={handleSave} disabled={saving} title="Save">
                      <IconCheck style={{ width: 14, height: 14 }} />
                    </button>
                    <button className="lookup-action-btn cancel" onClick={cancelEdit} title="Cancel">
                      <IconX style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </div>
                {validationError && (
                  <div style={{ padding: '6px 12px', fontSize: 12, color: '#ef4444', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
                    {validationError}
                  </div>
                )}
              </>
            ) : (
              /* Display row */
              <div key={item.id} className="lookup-row">
                {columns.map(col => (
                  <div key={col.key} className="lookup-cell" style={{ flex: col.flex || 1 }}>
                    {col.type === 'select'
                      ? (col.options?.find(o => o.value === item[col.key])?.label || item[col.key] || '\u2014')
                      : (item[col.key] ?? '\u2014')
                    }
                  </div>
                ))}
                <div className="lookup-cell lookup-cell-actions" style={{ width: confirmDeleteId === item.id ? 140 : 80 }}>
                  {confirmDeleteId === item.id ? (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginRight: 4 }}>Delete?</span>
                      <button className="lookup-action-btn save" onClick={() => handleDelete(item.id)} title="Confirm delete" style={{ background: '#fef2f2', color: '#ef4444' }}>
                        <IconCheck style={{ width: 14, height: 14 }} />
                      </button>
                      <button className="lookup-action-btn cancel" onClick={() => setConfirmDeleteId(null)} title="Cancel">
                        <IconX style={{ width: 14, height: 14 }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="lookup-action-btn edit" onClick={() => startEdit(item)} title="Edit">
                        <IconEdit style={{ width: 14, height: 14 }} />
                      </button>
                      <button className="lookup-action-btn delete" onClick={() => setConfirmDeleteId(item.id)} title="Delete">
                        <IconTrash style={{ width: 14, height: 14 }} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          ))
        )}
      </div>
    </div>
  );
}
