import { useState, useEffect, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthHeader } from '@/lib/realtime';

/* ── Toast helpers ── */
const ok  = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));
const err = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error'   } }));

/* ── Icons ── */
function IconFlag(p)    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>; }
function IconHeart(p)   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>; }
function IconUsers(p)   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>; }
function IconZap(p)     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>; }
function IconShield(p)  { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>; }
function IconMsg(p)     { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }
function IconPlus(p)    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IconTrash(p)   { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }
function IconRefresh(p) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.1"/></svg>; }
function IconUser(p)    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function IconCode(p)    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>; }
function IconX(p)       { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>; }
function IconSend(p)    { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>; }

/* ── Tab config ── */
const TABS = [
  { key: 'flags',      label: 'Feature Flags', icon: IconFlag   },
  { key: 'health',     label: 'Health',        icon: IconHeart  },
  { key: 'employees',  label: 'Employees',     icon: IconUsers  },
  { key: 'workers',    label: 'Workers',       icon: IconZap    },
  { key: 'integrity',  label: 'Integrity',     icon: IconShield },
  { key: 'messaging',  label: 'Messaging',     icon: IconMsg    },
  { key: 'advanced',   label: 'Advanced',      icon: IconCode   },
];

const CATEGORY_COLOR = {
  page:    { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  tool:    { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  feature: { bg: '#faf5ff', color: '#7c3aed', border: '#ddd6fe' },
};

/* ════════════════════════════════════════════════════
   FEATURE FLAGS TAB
   ════════════════════════════════════════════════════ */
function FlagsTab() {
  const { db, employee, featureFlags: ctxFlags, isFeatureEnabled } = useAuth();
  const [flags, setFlags]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(null); // key of flag being saved
  const [confirmDel, setConfirmDel] = useState(null); // key of flag awaiting delete confirm
  const [showAdd, setShowAdd]   = useState(false);
  const [newFlag, setNewFlag]   = useState({ key: '', label: '', category: 'page', description: '' });
  const [adding, setAdding]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_feature_flags');
      setFlags(rows || []);
    } catch (e) {
      err('Failed to load flags');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (flag) => {
    setSaving(flag.key);
    try {
      await db.rpc('upsert_feature_flag', {
        p_key:             flag.key,
        p_enabled:         !flag.enabled,
        p_dev_only_user_id: flag.dev_only_user_id,
        p_category:        flag.category,
        p_label:           flag.label,
        p_description:     flag.description,
        p_updated_by:      employee?.id,
        p_force_disabled:  flag.force_disabled || false,
      });
      setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, enabled: !f.enabled } : f));
      ok(`${flag.label} ${!flag.enabled ? 'enabled' : 'disabled'}`);
    } catch (e) {
      err('Failed to update flag');
    } finally {
      setSaving(null);
    }
  };

  const toggleDevOnly = async (flag) => {
    const newVal = flag.dev_only_user_id === employee?.id ? null : employee?.id;
    setSaving(flag.key + '_dev');
    try {
      await db.rpc('upsert_feature_flag', {
        p_key:             flag.key,
        p_enabled:         flag.enabled,
        p_dev_only_user_id: newVal,
        p_category:        flag.category,
        p_label:           flag.label,
        p_description:     flag.description,
        p_updated_by:      employee?.id,
        p_force_disabled:  flag.force_disabled || false,
      });
      setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, dev_only_user_id: newVal } : f));
      ok(newVal ? 'Dev-only mode on (only you see this)' : 'Dev-only mode cleared');
    } catch (e) {
      err('Failed to update dev-only');
    } finally {
      setSaving(null);
    }
  };

  const toggleForceDisabled = async (flag) => {
    setSaving(flag.key + '_force');
    try {
      await db.rpc('upsert_feature_flag', {
        p_key:             flag.key,
        p_enabled:         flag.enabled,
        p_dev_only_user_id: flag.dev_only_user_id,
        p_category:        flag.category,
        p_label:           flag.label,
        p_description:     flag.description,
        p_updated_by:      employee?.id,
        p_force_disabled:  !flag.force_disabled,
      });
      setFlags(prev => prev.map(f => f.key === flag.key ? { ...f, force_disabled: !f.force_disabled } : f));
      ok(!flag.force_disabled ? '⚠️ Force disabled — hidden for everyone including admins' : 'Force disable cleared');
    } catch (e) {
      err('Failed to update force disable');
    } finally {
      setSaving(null);
    }
  };

  const deleteFlag = async (flag) => {
    if (confirmDel !== flag.key) { setConfirmDel(flag.key); return; }
    setConfirmDel(null);
    setSaving(flag.key + '_del');
    try {
      await db.rpc('delete_feature_flag', { p_key: flag.key });
      setFlags(prev => prev.filter(f => f.key !== flag.key));
      ok(`Flag "${flag.key}" deleted`);
    } catch (e) {
      err('Failed to delete flag');
    } finally {
      setSaving(null);
    }
  };

  const addFlag = async () => {
    if (!newFlag.key.trim() || !newFlag.label.trim()) { err('Key and label are required'); return; }
    if (!/^[a-z_:]+$/.test(newFlag.key)) { err('Key must be lowercase letters, underscores, colons only'); return; }
    setAdding(true);
    try {
      await db.rpc('upsert_feature_flag', {
        p_key:             newFlag.key.trim(),
        p_enabled:         false,
        p_dev_only_user_id: null,
        p_category:        newFlag.category,
        p_label:           newFlag.label.trim(),
        p_description:     newFlag.description.trim() || null,
        p_updated_by:      employee?.id,
        p_force_disabled:  false,
      });
      ok(`Flag "${newFlag.key}" created`);
      setNewFlag({ key: '', label: '', category: 'page', description: '' });
      setShowAdd(false);
      load();
    } catch (e) {
      err('Failed to create flag');
    } finally {
      setAdding(false);
    }
  };

  // Group flags by category
  const grouped = flags.reduce((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f);
    return acc;
  }, {});
  const ORDER = ['page', 'tool', 'feature'];

  if (loading) return <TabLoading />;

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Feature Flags</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Toggle pages and tools on/off without a deploy. No row = unrestricted.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={load}>
            <IconRefresh style={{ width: 13, height: 13 }} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(v => !v)}>
            <IconPlus style={{ width: 13, height: 13 }} /> New Flag
          </button>
        </div>
      </div>

      {/* Add flag form */}
      {showAdd && (
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)', padding: 16, marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>New Feature Flag</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Key <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(e.g. page:reports)</span></label>
              <input style={inputStyle} value={newFlag.key} placeholder="page:my_feature"
                onChange={e => setNewFlag(v => ({ ...v, key: e.target.value.toLowerCase() }))} />
            </div>
            <div>
              <label style={labelStyle}>Label</label>
              <input style={inputStyle} value={newFlag.label} placeholder="My Feature"
                onChange={e => setNewFlag(v => ({ ...v, label: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={inputStyle} value={newFlag.category}
                onChange={e => setNewFlag(v => ({ ...v, category: e.target.value }))}>
                <option value="page">page</option>
                <option value="tool">tool</option>
                <option value="feature">feature</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Description <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
              <input style={inputStyle} value={newFlag.description} placeholder="What does this control?"
                onChange={e => setNewFlag(v => ({ ...v, description: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={addFlag} disabled={adding}>
              {adding ? 'Creating…' : 'Create Flag'}
            </button>
          </div>
        </div>
      )}

      {/* Flag groups */}
      {ORDER.map(cat => {
        const items = grouped[cat];
        if (!items?.length) return null;
        const col = CATEGORY_COLOR[cat] || CATEGORY_COLOR.feature;
        return (
          <div key={cat} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '2px 8px', borderRadius: 'var(--radius-full)',
                background: col.bg, color: col.color, border: `1px solid ${col.border}`,
              }}>{cat}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{items.length} flag{items.length !== 1 ? 's' : ''}</span>
            </div>
            <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
              {items.map((flag, idx) => {
                const isSaving  = saving === flag.key;
                const isDevSave = saving === flag.key + '_dev';
                const isDevOnly = flag.dev_only_user_id === employee?.id;
                const isLast    = idx === items.length - 1;
                return (
                  <div key={flag.key} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 16px',
                    background: flag.enabled ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                    borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                    transition: 'background 0.15s',
                  }}>
                    {/* Toggle */}
                    <button
                      onClick={() => toggle(flag)}
                      disabled={!!saving}
                      style={{
                        position: 'relative', flexShrink: 0,
                        width: 40, height: 22, borderRadius: 11,
                        background: flag.enabled ? 'var(--accent)' : 'var(--border-color)',
                        border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                        transition: 'background 0.15s',
                        opacity: isSaving ? 0.5 : 1,
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 3,
                        left: flag.enabled ? 21 : 3,
                        width: 16, height: 16, borderRadius: '50%',
                        background: '#fff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        transition: 'left 0.15s',
                        display: 'block',
                      }} />
                    </button>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                          {flag.label}
                        </span>
                        <code style={{
                          fontSize: 11, fontFamily: 'var(--font-mono)',
                          color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)',
                          padding: '1px 5px', borderRadius: 3,
                        }}>{flag.key}</code>
                        {flag.enabled && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#16a34a' }}>● ON</span>
                        )}
                        {isDevOnly && (
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: '1px 7px',
                            borderRadius: 'var(--radius-full)',
                            background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a',
                          }}>DEV ONLY</span>
                        )}
                        {flag.force_disabled && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '1px 7px',
                            borderRadius: 'var(--radius-full)',
                            background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                          }}>FORCE DISABLED — ALL USERS</span>
                        )}
                      </div>
                      {flag.description && (
                        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                          {flag.description}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {/* Dev-only toggle */}
                      <button
                        onClick={() => toggleDevOnly(flag)}
                        disabled={!!saving}
                        title={isDevOnly ? 'Clear dev-only (flag hidden for everyone when disabled)' : 'Set dev-only (only you see it when disabled)'}
                        style={{
                          padding: '4px 10px', borderRadius: 'var(--radius-md)', border: '1px solid',
                          fontSize: 11, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                          background: isDevOnly ? '#fef3c7' : 'var(--bg-tertiary)',
                          color:      isDevOnly ? '#d97706' : 'var(--text-tertiary)',
                          borderColor: isDevOnly ? '#fde68a' : 'var(--border-light)',
                          opacity: isDevSave ? 0.5 : 1,
                          transition: 'all 0.12s',
                        }}
                      >
                        <IconUser style={{ width: 11, height: 11, display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                        {isDevOnly ? 'Dev Only' : 'Set Dev'}
                      </button>
                      {/* Force disable — kills for everyone including admins */}
                      <button
                        onClick={() => toggleForceDisabled(flag)}
                        disabled={!!saving}
                        title={flag.force_disabled ? 'Clear force disable (page returns to normal flag behavior)' : 'Force disable for EVERYONE including admins (bug fix kill switch)'}
                        style={{
                          padding: '4px 10px', borderRadius: 'var(--radius-md)', border: '1px solid',
                          fontSize: 11, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                          background: flag.force_disabled ? '#fef2f2' : 'var(--bg-tertiary)',
                          color:      flag.force_disabled ? '#dc2626' : 'var(--text-tertiary)',
                          borderColor: flag.force_disabled ? '#fecaca' : 'var(--border-light)',
                          opacity: saving === flag.key + '_force' ? 0.5 : 1,
                          transition: 'all 0.12s',
                        }}
                      >
                        {flag.force_disabled ? '🔴 FORCE OFF' : 'Force Off'}
                      </button>
                      {/* Delete — requires two clicks (confirm pattern) */}
                      <button
                        onClick={() => deleteFlag(flag)}
                        disabled={!!saving}
                        title={confirmDel === flag.key ? 'Click again to confirm delete' : 'Delete flag'}
                        style={{
                          padding: '4px 8px', borderRadius: 'var(--radius-md)',
                          border: `1px solid ${confirmDel === flag.key ? '#fecaca' : 'var(--border-light)'}`,
                          background: confirmDel === flag.key ? '#fef2f2' : 'var(--bg-tertiary)',
                          color: confirmDel === flag.key ? '#dc2626' : 'var(--text-tertiary)',
                          cursor: saving ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: confirmDel === flag.key ? 600 : 400,
                          transition: 'all 0.12s',
                        }}
                        onBlur={() => setConfirmDel(null)}
                      >
                        <IconTrash style={{ width: 12, height: 12 }} />
                        {confirmDel === flag.key && 'Confirm'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {flags.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
          No flags found. Create one above.
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   HEALTH TAB
   ════════════════════════════════════════════════════ */
function HealthTab() {
  const { db } = useAuth();
  const [checks, setChecks]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [bustLoading, setBustLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const results = [];
    const t = (label, fn) => ({ label, fn });

    const runCheck = async (label, fn) => {
      const start = Date.now();
      try {
        const result = await fn();
        return { label, status: 'ok', detail: result, ms: Date.now() - start };
      } catch (e) {
        return { label, status: 'error', detail: e.message, ms: Date.now() - start };
      }
    };

    const [jobs, contacts, employees, flags, workerRuns] = await Promise.all([
      runCheck('Jobs table readable', async () => {
        const r = await db.rpc('get_dashboard_stats');
        return `${r?.total_jobs ?? '?'} jobs`;
      }),
      runCheck('Contacts table readable', async () => {
        const r = await db.select('contacts', 'select=id&limit=1');
        return `${r?.length ?? 0} row(s) returned`;
      }),
      runCheck('get_all_employees RPC', async () => {
        const r = await db.rpc('get_all_employees');
        return `${r?.length ?? 0} employees`;
      }),
      runCheck('get_feature_flags RPC', async () => {
        const r = await db.rpc('get_feature_flags');
        return `${r?.length ?? 0} flags`;
      }),
      runCheck('worker_runs table readable', async () => {
        const r = await db.rpc('get_worker_runs', { p_limit: 1 });
        return `${r?.length ?? 0} recent run(s)`;
      }),
    ]);

    setChecks([jobs, contacts, employees, flags, workerRuns]);
    setLoading(false);
  }, [db]);

  const bustCache = async () => {
    setBustLoading(true);
    try {
      await db.rpc('bust_postgrest_cache');
      ok('PostgREST schema cache reloaded');
    } catch (e) {
      err('Cache bust failed: ' + e.message);
    } finally {
      setBustLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Health Checks</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            Verify DB connectivity and key RPCs are responding.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={bustCache} disabled={bustLoading}>
            <IconRefresh style={{ width: 13, height: 13 }} />
            {bustLoading ? 'Busting…' : 'Bust Schema Cache'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
            <IconZap style={{ width: 13, height: 13 }} />
            {loading ? 'Running…' : 'Run Checks'}
          </button>
        </div>
      </div>

      {!checks && !loading && (
        <div style={{
          textAlign: 'center', padding: '48px 0',
          color: 'var(--text-tertiary)', fontSize: 13,
          border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)',
        }}>
          Click "Run Checks" to test DB connectivity and key RPCs.
        </div>
      )}

      {loading && <TabLoading label="Running checks…" />}

      {checks && !loading && (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          {checks.map((c, i) => (
            <div key={c.label} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
              borderBottom: i < checks.length - 1 ? '1px solid var(--border-light)' : 'none',
              background: 'var(--bg-primary)',
            }}>
              <span style={{ fontSize: 14 }}>{c.status === 'ok' ? '✅' : '❌'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</div>
                <div style={{ fontSize: 12, color: c.status === 'ok' ? 'var(--text-tertiary)' : '#ef4444', marginTop: 1 }}>
                  {typeof c.detail === 'object' ? JSON.stringify(c.detail) : String(c.detail)}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {c.ms}ms
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Schema Cache Buster info box */}
      <div style={{
        marginTop: 20, padding: '12px 16px', borderRadius: 'var(--radius-lg)',
        background: '#fffbeb', border: '1px solid #fde68a',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#d97706', marginBottom: 4 }}>
          PostgREST Schema Cache
        </div>
        <div style={{ fontSize: 12, color: '#92400e' }}>
          After creating new tables or columns, PostgREST may not see them immediately.
          "Bust Schema Cache" fires <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>NOTIFY pgrst, 'reload schema'</code> without requiring a redeploy.
          Use this if RPCs on new tables return 404.
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   EMPLOYEES TAB
   ════════════════════════════════════════════════════ */
function EmployeesTab() {
  const { db } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [inviting, setInviting]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_all_employees');
      setEmployees(rows || []);
    } catch (e) {
      err('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const sendInvite = async (emp) => {
    if (!emp.email) { err('Employee has no email — add one in Admin first'); return; }
    setInviting(emp.id);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'invite', employee_id: emp.id, email: emp.email }),
      });
      if (!res.ok) throw new Error(await res.text());
      ok(`Invite sent to ${emp.email}`);
      load();
    } catch (e) {
      err('Invite failed: ' + e.message);
    } finally {
      setInviting(null);
    }
  };

  const linked   = employees.filter(e => e.auth_user_id);
  const unlinked = employees.filter(e => !e.auth_user_id);

  if (loading) return <TabLoading />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Employee Auth Status</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {linked.length} linked · {unlinked.length} unlinked
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          <IconRefresh style={{ width: 13, height: 13 }} /> Refresh
        </button>
      </div>

      {/* Summary pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <StatPill label="Total" value={employees.length} color="var(--text-secondary)" />
        <StatPill label="Auth Linked" value={linked.length}   color="#16a34a" bg="#f0fdf4" border="#bbf7d0" />
        <StatPill label="Unlinked"    value={unlinked.length} color="#d97706" bg="#fffbeb" border="#fde68a" />
      </div>

      <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 120px 80px 120px',
          padding: '8px 16px', background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          <span>Name</span><span>Email</span><span>Role</span><span>Auth</span><span></span>
        </div>

        {employees.map((emp, i) => {
          const isLinked = !!emp.auth_user_id;
          const isLast = i === employees.length - 1;
          return (
            <div key={emp.id} style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 120px 80px 120px',
              alignItems: 'center', padding: '10px 16px',
              borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
              background: 'var(--bg-primary)',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {emp.full_name}
              </span>
              <span style={{ fontSize: 12, color: emp.email ? 'var(--text-secondary)' : 'var(--text-tertiary)', fontStyle: emp.email ? 'normal' : 'italic' }}>
                {emp.email || 'no email'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{emp.role}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: isLinked ? '#16a34a' : '#d97706' }}>
                {isLinked ? '✅ linked' : '⚠️ none'}
              </span>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {!isLinked && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => sendInvite(emp)}
                    disabled={inviting === emp.id || !emp.email}
                    title={!emp.email ? 'Add email in Admin first' : 'Send invite email'}
                  >
                    <IconSend style={{ width: 11, height: 11 }} />
                    {inviting === emp.id ? 'Sending…' : 'Invite'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════
   WORKERS TAB
   ════════════════════════════════════════════════════ */
const WORKER_NAMES = ['send-message', 'twilio-webhook', 'twilio-status', 'process-scheduled', 'sync-encircle'];

const STATUS_STYLE = {
  completed: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  error:     { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  started:   { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
};

function WorkersTab() {
  const { db } = useAuth();
  const [runs, setRuns]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [limit, setLimit]     = useState(20);

  const load = useCallback(async (n = limit) => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_worker_runs', { p_limit: n });
      setRuns(rows || []);
    } catch (e) {
      err('Failed to load worker runs');
    } finally {
      setLoading(false);
    }
  }, [db, limit]);

  useEffect(() => { load(); }, [load]);

  const triggerSync = async () => {
    setSyncing(true);
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/sync-encircle', { method: 'POST', headers: auth });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      ok(`Encircle sync triggered — ${data.synced ?? '?'} records`);
      setTimeout(() => load(), 2000); // Give it a moment to write worker_run row
    } catch (e) {
      err('Sync failed: ' + e.message);
    } finally {
      setSyncing(false);
    }
  };

  // Group runs by worker_name for the summary cards
  const byWorker = WORKER_NAMES.map(name => {
    const workerRuns = runs.filter(r => r.worker_name === name);
    const latest = workerRuns[0];
    return { name, runs: workerRuns, latest };
  });

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const duration = (start, end) => {
    if (!start || !end) return '—';
    const ms = new Date(end) - new Date(start);
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) return <TabLoading />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Worker Execution Log</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {runs.length} recent run{runs.length !== 1 ? 's' : ''} · workers log to <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>worker_runs</code> table
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => load()}>
            <IconRefresh style={{ width: 13, height: 13 }} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={triggerSync} disabled={syncing}>
            <IconZap style={{ width: 13, height: 13 }} />
            {syncing ? 'Syncing…' : 'Trigger Encircle Sync'}
          </button>
        </div>
      </div>

      {/* Worker summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 24 }}>
        {byWorker.map(({ name, runs: wRuns, latest }) => {
          const st = latest?.status;
          const col = st ? STATUS_STYLE[st] : { bg: 'var(--bg-secondary)', color: 'var(--text-tertiary)', border: 'var(--border-color)' };
          return (
            <div key={name} style={{
              padding: '12px 14px', borderRadius: 'var(--radius-lg)',
              border: `1px solid ${col.border}`, background: col.bg,
            }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: col.color, marginBottom: 4 }}>
                {name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {latest ? `Last: ${fmt(latest.started_at)}` : 'No runs recorded'}
              </div>
              {latest?.status && (
                <div style={{ fontSize: 11, fontWeight: 600, color: col.color, marginTop: 2, textTransform: 'uppercase' }}>
                  {latest.status}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Full log table */}
      {runs.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13,
          border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)',
        }}>
          No worker runs recorded yet. Workers need to be updated to log to this table.
        </div>
      ) : (
        <>
          <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '160px 90px 80px 100px 1fr',
              padding: '8px 16px', background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--border-color)',
              fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              <span>Worker</span><span>Status</span><span>Records</span><span>Duration</span><span>Error</span>
            </div>
            {runs.map((run, i) => {
              const col = STATUS_STYLE[run.status] || STATUS_STYLE.started;
              return (
                <div key={run.id} style={{
                  display: 'grid', gridTemplateColumns: '160px 90px 80px 100px 1fr',
                  alignItems: 'center', padding: '9px 16px',
                  borderBottom: i < runs.length - 1 ? '1px solid var(--border-light)' : 'none',
                  background: 'var(--bg-primary)',
                }}>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {run.worker_name}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, display: 'inline-block',
                    padding: '2px 7px', borderRadius: 'var(--radius-full)',
                    background: col.bg, color: col.color, border: `1px solid ${col.border}`,
                    textTransform: 'uppercase',
                  }}>
                    {run.status}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {run.records_processed ?? 0}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {duration(run.started_at, run.completed_at)}
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-sans)', marginTop: 1 }}>
                      {fmt(run.started_at)}
                    </div>
                  </span>
                  <span style={{ fontSize: 11, color: run.error_message ? '#dc2626' : 'var(--text-tertiary)', fontFamily: run.error_message ? 'var(--font-mono)' : 'var(--font-sans)' }}>
                    {run.error_message || '—'}
                  </span>
                </div>
              );
            })}
          </div>
          {runs.length >= limit && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 10, width: '100%' }}
              onClick={() => { const n = limit + 20; setLimit(n); load(n); }}
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   INTEGRITY TAB — Phase 4
   ════════════════════════════════════════════════════ */
const DIVISION_ICON = { water: '\u{1F4A7}', mold: '\u{1F9EB}', reconstruction: '\u{1F3D7}\uFE0F', fire: '\u{1F525}', contents: '\u{1F4E6}' };

function IntegrityTab() {
  const [subTab, setSubTab] = useState('orphans');
  const subs = [
    { key: 'orphans', label: 'Orphans' },
    { key: 'tree', label: 'Claim Tree' },
    { key: 'duplicates', label: 'Duplicates' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Data Integrity Tools</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>Orphan checker, claim/job tree viewer, and duplicate contact detector.</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {subs.map(s => (
          <button key={s.key} onClick={() => setSubTab(s.key)} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid',
            fontSize: 12, fontWeight: subTab === s.key ? 600 : 400, cursor: 'pointer',
            background: subTab === s.key ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: subTab === s.key ? '#fff' : 'var(--text-secondary)',
            borderColor: subTab === s.key ? 'var(--accent)' : 'var(--border-color)',
          }}>{s.label}</button>
        ))}
      </div>
      {subTab === 'orphans' && <OrphanChecker />}
      {subTab === 'tree' && <ClaimTreeViewer />}
      {subTab === 'duplicates' && <DuplicateDetector />}
    </div>
  );
}

/* ── 4A: Orphan Checker ── */
const ORPHAN_CHECKS = [
  { id: 'jobs_no_claim', label: 'Jobs with no claim', rpc: 'get_orphan_jobs_no_claim', display: r => r.job_number || r.id },
  { id: 'jobs_no_contact', label: 'Jobs with no primary contact', rpc: 'get_orphan_jobs_no_contact', display: r => r.job_number || r.id },
  { id: 'contacts_no_job', label: 'Contacts with no job links', rpc: 'get_orphan_contacts', display: r => r.name || r.phone || r.id },
  { id: 'conversations_no_participant', label: 'Conversations with no participants', rpc: 'get_orphan_conversations', display: r => r.id },
  { id: 'claims_no_jobs', label: 'Claims with no jobs', rpc: 'get_orphan_claims', display: r => r.claim_number || r.id },
];

function OrphanChecker() {
  const { db } = useAuth();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const runChecks = async () => {
    setLoading(true);
    try {
      const all = await Promise.all(ORPHAN_CHECKS.map(async (chk) => {
        try {
          const rows = await db.rpc(chk.rpc);
          return { ...chk, rows: rows || [], error: null };
        } catch (e) {
          return { ...chk, rows: [], error: e.message };
        }
      }));
      setResults(all);
      ok('Orphan checks complete');
    } catch (e) {
      err('Failed to run orphan checks');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={runChecks} disabled={loading}>
          <IconShield style={{ width: 13, height: 13 }} /> {loading ? 'Running…' : 'Run Checks'}
        </button>
      </div>
      {!results && !loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
          Click "Run Checks" to scan for orphaned records.
        </div>
      )}
      {loading && <TabLoading label="Running orphan checks…" />}
      {results && !loading && (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          {results.map((r, i) => {
            const count = r.rows.length;
            const isGood = count === 0 && !r.error;
            const isExpanded = expanded === r.id;
            return (
              <div key={r.id} style={{ borderBottom: i < results.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                  background: 'var(--bg-primary)', cursor: count > 0 ? 'pointer' : 'default',
                }} onClick={() => count > 0 && setExpanded(isExpanded ? null : r.id)}>
                  <span style={{ fontSize: 14 }}>{r.error ? '⚠️' : isGood ? '✅' : '❌'}</span>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.label}</div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 'var(--radius-full)',
                    background: r.error ? '#fef3c7' : isGood ? '#f0fdf4' : '#fef2f2',
                    color: r.error ? '#d97706' : isGood ? '#16a34a' : '#dc2626',
                    border: `1px solid ${r.error ? '#fde68a' : isGood ? '#bbf7d0' : '#fecaca'}`,
                  }}>{r.error ? 'err' : count}</span>
                  {count > 0 && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{isExpanded ? '▲' : '▼'}</span>}
                </div>
                {isExpanded && (
                  <div style={{ padding: '0 16px 12px 44px' }}>
                    {r.rows.slice(0, 20).map((row, j) => (
                      <div key={j} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '3px 0', fontFamily: 'var(--font-mono)' }}>
                        {r.display(row)}
                        {row.division && <span style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>[{row.division}]</span>}
                        {row.status && <span style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>[{row.status}]</span>}
                      </div>
                    ))}
                    {r.rows.length > 20 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>…and {r.rows.length - 20} more</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── 4B: Claim/Job Tree Viewer ── */
function ClaimTreeViewer() {
  const { db } = useAuth();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q) => {
    if (q.length < 2) { setSuggestions([]); return; }
    try {
      const rows = await db.select('claims', `claim_number=ilike.*${q}*&select=id,claim_number,status&limit=10`);
      setSuggestions(rows || []);
    } catch { setSuggestions([]); }
  }, [db]);

  useEffect(() => { const t = setTimeout(() => search(query), 300); return () => clearTimeout(t); }, [query, search]);

  const loadTree = async (claim) => {
    setQuery(claim.claim_number);
    setSuggestions([]);
    setLoading(true);
    try {
      const data = await db.rpc('get_claim_jobs', { p_claim_id: claim.id });
      const claimData = { ...claim, jobs: data?.jobs || data || [] };
      // Load contacts and tasks for each job
      const jobsWithDetails = await Promise.all((claimData.jobs || []).map(async (job) => {
        const [contacts, tasks] = await Promise.all([
          db.rpc('get_job_contacts', { p_job_id: job.id }).catch(() => []),
          db.rpc('get_job_task_summary', { p_job_id: job.id }).catch(() => null),
        ]);
        return { ...job, contacts: contacts || [], tasks: tasks || {} };
      }));
      claimData.jobs = jobsWithDetails;
      setTree(claimData);
    } catch (e) {
      err('Failed to load claim tree: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 20 }}>
        <input style={inputStyle} placeholder="Search by claim number…" value={query}
          onChange={e => setQuery(e.target.value)} />
        {suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            maxHeight: 200, overflowY: 'auto',
          }}>
            {suggestions.map(s => (
              <div key={s.id} onClick={() => loadTree(s)} style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                borderBottom: '1px solid var(--border-light)',
              }}>
                <span style={{ fontWeight: 600 }}>{s.claim_number}</span>
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>{s.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {loading && <TabLoading label="Loading claim tree…" />}
      {tree && !loading && (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: 20, background: 'var(--bg-primary)' }}>
          {/* Claim header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{tree.claim_number}</span>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
              background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
            }}>{tree.status}</span>
          </div>
          {/* Contacts from all jobs */}
          {tree.jobs?.map(job => (job.contacts || []).filter(c => c.role === 'homeowner' || c.role === 'adjuster' || c.is_primary).map(c => (
            <div key={c.id || c.contact_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 4px 20px' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>├──</span>
              <span style={{ fontSize: 13 }}>{'\u{1F464}'}</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {c.role ? `${c.role.charAt(0).toUpperCase() + c.role.slice(1)}: ` : ''}{c.name || c.phone || 'Unknown'}
              </span>
            </div>
          )))}
          {/* Jobs */}
          {(tree.jobs || []).length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingLeft: 20 }}>No jobs linked to this claim.</div>
          )}
          {(tree.jobs || []).map((job, i) => {
            const isLast = i === tree.jobs.length - 1;
            const icon = DIVISION_ICON[job.division] || '\u{1F4C1}';
            const tasksComplete = job.tasks?.completed || job.tasks?.complete || 0;
            const tasksTotal = job.tasks?.total || 0;
            const contactCount = (job.contacts || []).length;
            return (
              <div key={job.id} style={{ padding: '6px 0 6px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{isLast ? '└──' : '├──'}</span>
                  <span style={{ fontSize: 14 }}>{icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    Job: {job.division ? job.division.charAt(0).toUpperCase() + job.division.slice(1) : 'Unknown'}
                  </span>
                  <code style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', background: 'var(--bg-tertiary)', padding: '1px 5px', borderRadius: 3 }}>
                    {job.job_number || job.id?.slice(0, 8)}
                  </code>
                  {job.current_phase && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                      background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0',
                    }}>{job.current_phase}</span>
                  )}
                </div>
                <div style={{ paddingLeft: 52, fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  Tasks: {tasksComplete}/{tasksTotal} complete &nbsp;&nbsp; Contacts: {contactCount}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!tree && !loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
          Search for a claim number above to view its job tree.
        </div>
      )}
    </div>
  );
}

/* ── 4C: Duplicate Contact Detector ── */
function DuplicateDetector() {
  const { db } = useAuth();
  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_duplicate_contacts');
      setGroups(rows || []);
      ok(`Found ${(rows || []).length} duplicate group(s)`);
    } catch (e) {
      err('Failed to check duplicates: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const formatPhone = (p) => {
    if (!p || p.length < 10) return p;
    return `(${p.slice(-10, -7)}) ${p.slice(-7, -4)}-${p.slice(-4)}`;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={run} disabled={loading}>
          <IconUsers style={{ width: 13, height: 13 }} /> {loading ? 'Scanning…' : 'Scan for Duplicates'}
        </button>
      </div>
      {!groups && !loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
          Click "Scan for Duplicates" to find contacts sharing the same phone number.
        </div>
      )}
      {loading && <TabLoading label="Scanning for duplicates…" />}
      {groups && !loading && groups.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
          No duplicate contacts found. All clear!
        </div>
      )}
      {groups && groups.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {groups.map((g, i) => (
            <div key={i} style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', padding: 16, background: 'var(--bg-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {formatPhone(g.phone_normalized)}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                }}>{g.count} contacts</span>
              </div>
              {(g.names || []).map((name, j) => (
                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <IconUser style={{ width: 12, height: 12, color: 'var(--text-tertiary)' }} />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>{name}</span>
                  {g.contact_ids?.[j] && (
                    <NavLink to={`/customers/${g.contact_ids[j]}`} style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
                      View →
                    </NavLink>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   MESSAGING TAB — Phase 5
   ════════════════════════════════════════════════════ */
function MessagingTab() {
  const [subTab, setSubTab] = useState('templates');
  const subs = [
    { key: 'templates', label: 'Template Preview' },
    { key: 'log', label: 'Message Log' },
    { key: 'queue', label: 'Scheduled Queue' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Messaging Tools</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>Template preview, message log, and scheduled queue.</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {subs.map(s => (
          <button key={s.key} onClick={() => setSubTab(s.key)} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid',
            fontSize: 12, fontWeight: subTab === s.key ? 600 : 400, cursor: 'pointer',
            background: subTab === s.key ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: subTab === s.key ? '#fff' : 'var(--text-secondary)',
            borderColor: subTab === s.key ? 'var(--accent)' : 'var(--border-color)',
          }}>{s.label}</button>
        ))}
      </div>
      {subTab === 'templates' && <TemplatePreview />}
      {subTab === 'log' && <MessageLog />}
      {subTab === 'queue' && <ScheduledQueue />}
    </div>
  );
}

/* ── 5A: Template Preview/Test ── */
function TemplatePreview() {
  const { db } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [vars, setVars] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const rows = await db.select('message_templates', 'select=id,title,body,category,variables&order=title&is_active=eq.true');
        setTemplates(rows || []);
      } catch (e) {
        err('Failed to load templates');
      } finally {
        setLoading(false);
      }
    })();
  }, [db]);

  const detectVars = (body) => {
    const matches = body?.match(/\{\{(\w+)\}\}/g) || [];
    return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
  };

  const handleSelect = (tpl) => {
    setSelected(tpl);
    const detected = detectVars(tpl.body);
    const initial = {};
    detected.forEach(v => { initial[v] = ''; });
    setVars(initial);
  };

  const preview = selected ? selected.body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`) : '';
  const charCount = preview.length;
  const segments = charCount > 0 ? Math.ceil(charCount / 160) : 0;

  if (loading) return <TabLoading />;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Select Template</label>
        <select style={inputStyle} value={selected?.id || ''} onChange={e => {
          const tpl = templates.find(t => t.id === e.target.value);
          if (tpl) handleSelect(tpl);
        }}>
          <option value="">— Choose a template —</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.title} {t.category ? `[${t.category}]` : ''}</option>)}
        </select>
      </div>
      {selected && (
        <>
          {detectVars(selected.body).length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 16 }}>
              {detectVars(selected.body).map(v => (
                <div key={v}>
                  <label style={labelStyle}>{`{{${v}}}`}</label>
                  <input style={inputStyle} placeholder={v} value={vars[v] || ''}
                    onChange={e => setVars(prev => ({ ...prev, [v]: e.target.value }))} />
                </div>
              ))}
            </div>
          )}
          <div style={{
            padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)', marginBottom: 10,
          }}>
            <label style={{ ...labelStyle, marginBottom: 8 }}>Preview</label>
            <div style={{ fontSize: 14, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
              {preview || '(empty template)'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
            <span>{charCount} character{charCount !== 1 ? 's' : ''}</span>
            <span>{segments} SMS segment{segments !== 1 ? 's' : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}

/* ── 5B: Message Log Viewer ── */
function MessageLog() {
  const { db } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const LIMIT = 50;

  const load = useCallback(async (off = 0, append = false) => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_message_log', {
        p_limit: LIMIT, p_offset: off,
        p_direction: direction || null,
        p_status: status || null,
      });
      setMessages(prev => append ? [...prev, ...(rows || [])] : (rows || []));
      setOffset(off);
    } catch (e) {
      err('Failed to load messages: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [db, direction, status]);

  useEffect(() => { load(0); }, [load]);

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const DIR_STYLE = {
    inbound:  { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
    outbound: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  };
  const STAT_STYLE = {
    delivered:   { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    sent:        { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
    failed:      { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
    undelivered: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
    queued:      { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={labelStyle}>Direction</label>
          <select style={{ ...inputStyle, width: 140 }} value={direction} onChange={e => setDirection(e.target.value)}>
            <option value="">All</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select style={{ ...inputStyle, width: 140 }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="delivered">Delivered</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="undelivered">Undelivered</option>
            <option value="queued">Queued</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => load(0)}>
            <IconRefresh style={{ width: 13, height: 13 }} /> Refresh
          </button>
        </div>
      </div>
      {loading && messages.length === 0 && <TabLoading label="Loading messages…" />}
      {!loading && messages.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
          No messages found with the current filters.
        </div>
      )}
      {messages.length > 0 && (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 1.5fr 100px',
            padding: '8px 16px', background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            <span>Contact</span><span>Phone</span><span>Dir</span><span>Status</span><span>Body</span><span>Time</span>
          </div>
          {messages.map((m, i) => {
            const dir = DIR_STYLE[m.direction] || DIR_STYLE.outbound;
            const st = STAT_STYLE[m.status] || STAT_STYLE.queued;
            const isExp = expanded === m.id;
            return (
              <div key={m.id + '-' + i}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 1.5fr 100px',
                  alignItems: 'center', padding: '9px 16px',
                  borderBottom: i < messages.length - 1 ? '1px solid var(--border-light)' : 'none',
                  background: 'var(--bg-primary)', cursor: 'pointer',
                }} onClick={() => setExpanded(isExp ? null : m.id)}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.contact_name || 'Unknown'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    {m.contact_phone ? m.contact_phone.slice(-4) : '—'}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-full)',
                    background: dir.bg, color: dir.color, border: `1px solid ${dir.border}`,
                    textTransform: 'uppercase', display: 'inline-block', width: 'fit-content',
                  }}>{m.direction === 'inbound' ? 'IN' : 'OUT'}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-full)',
                    background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                    textTransform: 'uppercase', display: 'inline-block', width: 'fit-content',
                  }}>{m.status || '—'}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(m.body || '').slice(0, 60)}{(m.body || '').length > 60 ? '…' : ''}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmt(m.created_at)}</span>
                </div>
                {isExp && (
                  <div style={{ padding: '10px 16px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-light)', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                    {m.body || '(empty)'}
                    {m.media_url && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>Media: {m.media_url}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {messages.length > 0 && messages.length >= LIMIT && (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 10, width: '100%' }}
          onClick={() => load(offset + LIMIT, true)} disabled={loading}>
          {loading ? 'Loading…' : 'Load More'}
        </button>
      )}
    </div>
  );
}

/* ── 5C: Scheduled Message Queue ── */
function ScheduledQueue() {
  const { db } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_scheduled_queue', { p_limit: 50 });
      setItems(rows || []);
    } catch (e) {
      err('Failed to load scheduled queue');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const cancelMsg = async (item) => {
    if (confirmCancel !== item.id) { setConfirmCancel(item.id); return; }
    setConfirmCancel(null);
    try {
      await db.update('scheduled_messages', 'id=eq.' + item.id, { status: 'cancelled' });
      ok('Message cancelled');
      load();
    } catch (e) {
      err('Failed to cancel: ' + e.message);
    }
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const filtered = showAll ? items : items.filter(i => i.status === 'pending');

  if (loading) return <TabLoading />;

  const QUEUE_STATUS = {
    pending:   { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
    sent:      { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
    cancelled: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
    failed:    { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Show all statuses
        </label>
        <button className="btn btn-secondary btn-sm" onClick={load}>
          <IconRefresh style={{ width: 13, height: 13 }} /> Refresh
        </button>
      </div>
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-tertiary)', fontSize: 13, border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
          {showAll ? 'No scheduled messages found.' : 'No pending scheduled messages.'}
        </div>
      )}
      {filtered.length > 0 && (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 100px 120px 100px 1.5fr 80px',
            padding: '8px 16px', background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            <span>Contact</span><span>Phone</span><span>Send At</span><span>Status</span><span>Body</span><span></span>
          </div>
          {filtered.map((item, i) => {
            const st = QUEUE_STATUS[item.status] || QUEUE_STATUS.pending;
            return (
              <div key={item.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 100px 120px 100px 1.5fr 80px',
                alignItems: 'center', padding: '9px 16px',
                borderBottom: i < filtered.length - 1 ? '1px solid var(--border-light)' : 'none',
                background: 'var(--bg-primary)',
              }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.contact_name || 'Unknown'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {item.contact_phone ? item.contact_phone.slice(-4) : '—'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{fmt(item.send_at)}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 'var(--radius-full)',
                  background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                  textTransform: 'uppercase', display: 'inline-block', width: 'fit-content',
                }}>{item.status}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.template_name && <span style={{ fontWeight: 600, marginRight: 4 }}>[{item.template_name}]</span>}
                  {(item.body || '').slice(0, 50)}{(item.body || '').length > 50 ? '…' : ''}
                </span>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {item.status === 'pending' && (
                    <button
                      onClick={() => cancelMsg(item)}
                      onBlur={() => setConfirmCancel(null)}
                      style={{
                        padding: '3px 8px', borderRadius: 'var(--radius-md)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        background: confirmCancel === item.id ? '#fef2f2' : 'var(--bg-tertiary)',
                        color: confirmCancel === item.id ? '#dc2626' : 'var(--text-tertiary)',
                        border: `1px solid ${confirmCancel === item.id ? '#fecaca' : 'var(--border-light)'}`,
                      }}
                    >{confirmCancel === item.id ? 'Confirm' : 'Cancel'}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   ADVANCED TAB — Phase 6
   ════════════════════════════════════════════════════ */
const RPC_LIST = [
  { name: 'get_dashboard_stats',      params: [] },
  { name: 'get_all_employees',        params: [] },
  { name: 'get_feature_flags',        params: [] },
  { name: 'get_worker_runs',          params: [{ key: 'p_limit', type: 'number', default: 10 }] },
  { name: 'get_orphan_jobs_no_claim',  params: [] },
  { name: 'get_orphan_contacts',      params: [] },
  { name: 'get_orphan_claims',        params: [] },
  { name: 'get_customers_list',       params: [] },
  { name: 'get_claims_list',          params: [] },
  { name: 'bust_postgrest_cache',     params: [] },
  { name: 'get_claim_jobs',           params: [{ key: 'p_claim_id', type: 'text', default: '' }] },
  { name: 'get_job_task_summary',     params: [{ key: 'p_job_id',   type: 'text', default: '' }] },
  { name: 'get_message_log',          params: [{ key: 'p_limit', type: 'number', default: 20 }] },
  { name: 'get_scheduled_queue',      params: [{ key: 'p_limit', type: 'number', default: 20 }] },
];

const TABLE_LIST = [
  'jobs', 'contacts', 'claims', 'conversations', 'messages',
  'scheduled_messages', 'employees', 'feature_flags', 'worker_runs',
  'sign_requests', 'job_tasks', 'appointments', 'job_documents',
  'system_events', 'sms_consent_log',
];

function AdvancedTab() {
  const [subTab, setSubTab] = useState('rpc');
  const subs = [
    { key: 'rpc', label: 'RPC Runner' },
    { key: 'tables', label: 'Tables' },
    { key: 'cache', label: 'Cache' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Advanced Dev Tools</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>RPC test runner, table inspector, and cache tools.</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {subs.map(s => (
          <button key={s.key} onClick={() => setSubTab(s.key)} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-full)', border: '1px solid',
            fontSize: 12, fontWeight: subTab === s.key ? 600 : 400, cursor: 'pointer',
            background: subTab === s.key ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: subTab === s.key ? '#fff' : 'var(--text-secondary)',
            borderColor: subTab === s.key ? 'var(--accent)' : 'var(--border-color)',
          }}>{s.label}</button>
        ))}
      </div>
      {subTab === 'rpc' && <RpcRunner />}
      {subTab === 'tables' && <TableInspector />}
      {subTab === 'cache' && (
        <div style={{
          padding: '24px 20px', borderRadius: 'var(--radius-lg)',
          background: '#fffbeb', border: '1px solid #fde68a',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#d97706', marginBottom: 6 }}>PostgREST Cache Buster</div>
          <div style={{ fontSize: 13, color: '#92400e' }}>
            The "Bust Schema Cache" button is available in the <strong>Health</strong> tab.
            Switch to the Health tab and click "Bust Schema Cache" to reload PostgREST's schema after creating new tables or columns.
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 6A: RPC Test Runner ── */
function RpcRunner() {
  const { db } = useAuth();
  const [selected, setSelected] = useState(RPC_LIST[0].name);
  const [paramVals, setParamVals] = useState({});
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const rpc = RPC_LIST.find(r => r.name === selected);

  const handleSelect = (name) => {
    setSelected(name);
    setResult(null);
    setError(null);
    setElapsed(null);
    const r = RPC_LIST.find(x => x.name === name);
    const vals = {};
    (r?.params || []).forEach(p => { vals[p.key] = p.default; });
    setParamVals(vals);
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    const params = {};
    (rpc?.params || []).forEach(p => {
      const val = paramVals[p.key];
      if (p.type === 'number') params[p.key] = Number(val) || p.default;
      else if (val) params[p.key] = val;
    });
    const start = Date.now();
    try {
      const res = await db.rpc(selected, Object.keys(params).length > 0 ? params : undefined);
      setResult(res);
      setElapsed(Date.now() - start);
    } catch (e) {
      setError(e.message);
      setElapsed(Date.now() - start);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={labelStyle}>RPC Function</label>
          <select style={inputStyle} value={selected} onChange={e => handleSelect(e.target.value)}>
            {RPC_LIST.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
          </select>
        </div>
        {(rpc?.params || []).map(p => (
          <div key={p.key} style={{ minWidth: 120 }}>
            <label style={labelStyle}>{p.key}</label>
            <input style={inputStyle} type={p.type === 'number' ? 'number' : 'text'}
              value={paramVals[p.key] ?? p.default}
              onChange={e => setParamVals(prev => ({ ...prev, [p.key]: e.target.value }))} />
          </div>
        ))}
        <button className="btn btn-primary btn-sm" onClick={run} disabled={running}>
          <IconZap style={{ width: 13, height: 13 }} /> {running ? 'Running…' : 'Run'}
        </button>
      </div>
      {elapsed !== null && (
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
          Response time: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{elapsed}ms</span>
          {result && Array.isArray(result) && <span> · {result.length} row(s)</span>}
        </div>
      )}
      {error && (
        <div style={{
          padding: 12, borderRadius: 'var(--radius-md)', background: '#fef2f2',
          border: '1px solid #fecaca', color: '#dc2626', fontSize: 12, fontFamily: 'var(--font-mono)',
          marginBottom: 8,
        }}>{error}</div>
      )}
      {result !== null && !error && (
        <pre style={{
          padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)', fontSize: 11, fontFamily: 'var(--font-mono)',
          maxHeight: 400, overflowX: 'auto', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: 'var(--text-primary)',
        }}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

/* ── 6B: Table Inspector ── */
function TableInspector() {
  const { db } = useAuth();
  const [selected, setSelected] = useState(TABLE_LIST[0]);
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  const inspect = useCallback(async (table) => {
    setLoading(true);
    setStats(null);
    setRows(null);
    try {
      const [statsResult, recentRows] = await Promise.all([
        db.rpc('get_table_stats', { p_table: table }),
        db.select(table, 'select=*&order=created_at.desc&limit=5').catch(() => []),
      ]);
      const s = Array.isArray(statsResult) ? statsResult[0] : statsResult;
      setStats(s || { row_count: '?', latest_created_at: null });
      setRows(recentRows || []);
    } catch (e) {
      err('Failed to inspect table: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { inspect(selected); }, [selected, inspect]);

  const fmt = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Table</label>
          <select style={inputStyle} value={selected} onChange={e => { setSelected(e.target.value); }}>
            {TABLE_LIST.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => inspect(selected)} disabled={loading}>
          <IconRefresh style={{ width: 13, height: 13 }} /> Refresh
        </button>
      </div>
      {loading && <TabLoading label="Inspecting table…" />}
      {stats && !loading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <StatPill label="Rows" value={stats.row_count ?? '?'} color="var(--text-secondary)" />
          <StatPill label="Last Insert" value={fmt(stats.latest_created_at)} color="var(--text-secondary)" />
        </div>
      )}
      {rows && rows.length > 0 && !loading && (
        <>
          <label style={{ ...labelStyle, marginBottom: 8 }}>Last {rows.length} row(s)</label>
          <pre style={{
            padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)', fontSize: 11, fontFamily: 'var(--font-mono)',
            maxHeight: 400, overflowX: 'auto', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: 'var(--text-primary)',
          }}>{JSON.stringify(rows, null, 2)}</pre>
        </>
      )}
      {rows && rows.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
          Table is empty or not accessible via REST.
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════
   SHARED COMPONENTS
   ════════════════════════════════════════════════════ */
function TabLoading({ label = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
      {label}
    </div>
  );
}

function StatPill({ label, value, color, bg = 'var(--bg-tertiary)', border = 'var(--border-color)' }) {
  return (
    <div style={{
      padding: '6px 14px', borderRadius: 'var(--radius-full)',
      background: bg, border: `1px solid ${border}`,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{label}</span>
    </div>
  );
}

function ComingSoon({ phase, label, description }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 24 }}>{description}</div>
      <div style={{
        padding: 32, borderRadius: 'var(--radius-lg)',
        border: '1px dashed var(--border-color)', textAlign: 'center',
        color: 'var(--text-tertiary)', fontSize: 13,
      }}>
        Phase {phase} — build in progress
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
};
const inputStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
  fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
  outline: 'none',
};

/* ════════════════════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════════════════════ */
const TAB_COMPONENTS = {
  flags:     FlagsTab,
  health:    HealthTab,
  employees: EmployeesTab,
  workers:   WorkersTab,
  integrity: IntegrityTab,
  messaging: MessagingTab,
  advanced:  AdvancedTab,
};

export default function DevTools() {
  const { employee } = useAuth();
  const [activeTab, setActiveTab] = useState('flags');
  const ActiveComponent = TAB_COMPONENTS[activeTab] || FlagsTab;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 20px 48px' }}>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 4 }}>
          Internal · {employee?.full_name}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Dev Tools
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Feature flags, health checks, employee auth, worker monitoring, and data integrity.
        </p>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 2, marginBottom: 24,
        borderBottom: '1px solid var(--border-color)', paddingBottom: 0,
        overflowX: 'auto', WebkitOverflowScrolling: 'touch',
      }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', border: 'none', background: 'none',
                borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: isActive ? 600 : 400,
                cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
                transition: 'color 0.12s, border-color 0.12s',
              }}
            >
              <Icon style={{ width: 14, height: 14 }} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      <ActiveComponent />
    </div>
  );
}
