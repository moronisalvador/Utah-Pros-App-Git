/**
 * ════════════════════════════════════════════════
 * FILE: PageAccess.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Page Access" settings screen — pick one employee and grant or restrict
 *   individual pages just for them, overriding what their role would normally
 *   allow. Shows the role default, the override, and where the effective access
 *   comes from. Admins are unaffected.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/page-access
 *   Rendered by:  src/App.jsx (inside SettingsLayout, behind AdminRoute)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db, employee), @/lib/navKeys
 *              (PAGE_ACCESS_KEYS, roleLabel)
 *   Data:      reads  → get_all_employees, get_employee_page_access,
 *              get_feature_flags, nav_permissions (RPCs/selects)
 *              writes → upsert_employee_page_access / delete_employee_page_access (RPCs)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Admin.jsx "Page Access" tab
 *     (Settings Overhaul Phase F). The fixed inline grid + mobile pass is P3's
 *     polish job — Foundation keeps it byte-identical.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PAGE_ACCESS_KEYS, roleLabel } from '@/lib/navKeys';

export default function PageAccess() {
  const { db, employee: currentEmployee } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [overrides, setOverrides] = useState({}); // nav_key → boolean
  const [rolePerms, setRolePerms] = useState({}); // nav_key → boolean
  const [flags, setFlags] = useState({}); // key → flag row
  const [loading, setLoading] = useState(true);
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [saving, setSaving] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Load employees (non-admin, active only)
  const loadEmployees = useCallback(async () => {
    try {
      const data = await db.rpc('get_all_employees');
      const nonAdmin = (data || []).filter(e => e.is_active !== false && e.role !== 'admin');
      setEmployees(nonAdmin);
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load employees', type: 'error' } }));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  // When employee selected, load their overrides + role perms + flags in parallel
  const loadAccess = useCallback(async (empId) => {
    if (!empId) { setOverrides({}); setRolePerms({}); return; }
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    setLoadingAccess(true);
    try {
      const [accessRows, permRows, flagRows] = await Promise.all([
        db.rpc('get_employee_page_access', { p_employee_id: empId }),
        db.select('nav_permissions', `role=eq.${encodeURIComponent(emp.role)}&select=nav_key,can_view`),
        db.rpc('get_feature_flags'),
      ]);
      const oMap = {};
      (accessRows || []).forEach(r => { oMap[r.nav_key] = r.can_view; });
      setOverrides(oMap);
      const rMap = {};
      (permRows || []).forEach(r => { rMap[r.nav_key] = r.can_view; });
      setRolePerms(rMap);
      const fMap = {};
      (flagRows || []).forEach(f => { fMap[f.key] = f; });
      setFlags(fMap);
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load access data', type: 'error' } }));
    } finally {
      setLoadingAccess(false);
    }
  }, [db, employees]);

  useEffect(() => { loadAccess(selectedEmployeeId); }, [selectedEmployeeId, loadAccess]);

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  const handleToggle = async (navKey) => {
    const currentOverride = Object.prototype.hasOwnProperty.call(overrides, navKey) ? overrides[navKey] : undefined;
    const roleDefault = rolePerms[navKey] || false;
    const newValue = currentOverride === undefined ? !roleDefault : !currentOverride;
    setSaving(navKey);
    try {
      await db.rpc('upsert_employee_page_access', {
        p_employee_id: selectedEmployeeId,
        p_nav_key:     navKey,
        p_can_view:    newValue,
        p_updated_by:  currentEmployee?.id,
      });
      setOverrides(prev => ({ ...prev, [navKey]: newValue }));
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: `${navKey} ${newValue ? 'granted' : 'revoked'} for ${selectedEmployee?.full_name}`, type: 'success' } }));
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to save', type: 'error' } }));
    } finally {
      setSaving(null);
    }
  };

  const clearOverride = async (navKey) => {
    setSaving(navKey + '_clear');
    try {
      await db.rpc('delete_employee_page_access', {
        p_employee_id: selectedEmployeeId,
        p_nav_key:     navKey,
      });
      setOverrides(prev => {
        const next = { ...prev };
        delete next[navKey];
        return next;
      });
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Override cleared — reverted to role default', type: 'success' } }));
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to clear override', type: 'error' } }));
    } finally {
      setSaving(null);
    }
  };

  const clearAllOverrides = async () => {
    if (!confirmClearAll) { setConfirmClearAll(true); return; }
    setConfirmClearAll(false);
    setSaving('clear_all');
    try {
      const keys = Object.keys(overrides);
      await Promise.all(keys.map(k =>
        db.rpc('delete_employee_page_access', { p_employee_id: selectedEmployeeId, p_nav_key: k })
      ));
      setOverrides({});
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: `All overrides cleared for ${selectedEmployee?.full_name}`, type: 'success' } }));
    } catch {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to clear overrides', type: 'error' } }));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Loading…</div>;

  // Group page keys by section
  const sections = PAGE_ACCESS_KEYS.reduce((acc, p) => {
    (acc[p.section] = acc[p.section] || []).push(p);
    return acc;
  }, {});

  const overrideCount = Object.keys(overrides).length;

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Page Access</div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
          Grant or restrict individual pages per employee. Overrides role defaults. Admins are unaffected.
        </div>
      </div>

      {/* Employee selector + Clear All */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <select
          className="input"
          value={selectedEmployeeId}
          onChange={e => { setSelectedEmployeeId(e.target.value); setConfirmClearAll(false); }}
          style={{ flex: 1, maxWidth: 360, height: 36, fontSize: 13 }}
        >
          <option value="">Select an employee…</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.full_name} — {roleLabel(e.role)}</option>
          ))}
        </select>
        {selectedEmployeeId && overrideCount > 0 && (
          <button
            onClick={clearAllOverrides}
            onBlur={() => setConfirmClearAll(false)}
            disabled={saving === 'clear_all'}
            style={{
              padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600,
              cursor: saving === 'clear_all' ? 'not-allowed' : 'pointer',
              background: confirmClearAll ? '#fef2f2' : 'var(--bg-tertiary)',
              color: confirmClearAll ? '#dc2626' : 'var(--text-secondary)',
              border: `1px solid ${confirmClearAll ? '#fecaca' : 'var(--border-color)'}`,
              transition: 'all 0.12s',
            }}
          >
            {confirmClearAll ? `Confirm Clear ${overrideCount} Override${overrideCount !== 1 ? 's' : ''}` : `Clear All Overrides (${overrideCount})`}
          </button>
        )}
      </div>

      {!selectedEmployeeId && (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
          Select an employee above to manage their page access.
        </div>
      )}

      {selectedEmployeeId && loadingAccess && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>
          Loading access data…
        </div>
      )}

      {selectedEmployeeId && !loadingAccess && (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          {Object.entries(sections).map(([section, pages], sIdx) => (
            <Fragment key={section}>
              {/* Section header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 120px 100px 40px',
                padding: '8px 16px', background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-color)',
                borderTop: sIdx > 0 ? '1px solid var(--border-color)' : 'none',
                fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                <span>{section}</span>
                <span>Role</span>
                <span>Override</span>
                <span>Source</span>
                <span></span>
              </div>
              {/* Page rows */}
              {pages.map((page, pIdx) => {
                const roleDefault = rolePerms[page.key] || false;
                const hasOverride = Object.prototype.hasOwnProperty.call(overrides, page.key);
                const overrideVal = hasOverride ? overrides[page.key] : undefined;
                const effectiveAccess = hasOverride ? overrideVal : roleDefault;
                const flag = flags[`page:${page.key}`];
                const forceDisabled = flag?.force_disabled;
                const isSaving = saving === page.key || saving === page.key + '_clear';
                const isLast = sIdx === Object.keys(sections).length - 1 && pIdx === pages.length - 1;

                return (
                  <div key={page.key} style={{
                    display: 'grid', gridTemplateColumns: '1fr 80px 120px 100px 40px',
                    alignItems: 'center', padding: '10px 16px',
                    borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                    background: forceDisabled ? '#fef2f2' : 'var(--bg-primary)',
                    opacity: isSaving ? 0.5 : 1, transition: 'opacity 0.12s',
                  }}>
                    {/* Page label */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{page.label}</span>
                      {forceDisabled && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-full)',
                          background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca',
                        }}>⚠️ GLOBALLY DISABLED</span>
                      )}
                    </div>
                    {/* Role default */}
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: roleDefault ? '#16a34a' : '#dc2626',
                    }}>
                      {roleDefault ? '✅' : '❌'}
                    </span>
                    {/* Toggle */}
                    <div>
                      <button
                        onClick={() => handleToggle(page.key)}
                        disabled={!!saving || forceDisabled}
                        title={forceDisabled ? 'Page is globally disabled in Dev Tools — override has no effect' : hasOverride ? `Override: ${overrideVal ? 'ON' : 'OFF'} — click to flip` : 'No override — click to set one'}
                        style={{
                          position: 'relative', width: 40, height: 22, borderRadius: 11,
                          border: hasOverride ? 'none' : '2px dashed var(--border-color)',
                          background: !hasOverride ? 'var(--bg-tertiary)' : effectiveAccess ? '#16a34a' : '#dc2626',
                          cursor: (saving || forceDisabled) ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                          opacity: forceDisabled ? 0.4 : 1,
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: hasOverride ? 3 : 2,
                          left: !hasOverride ? 10 : effectiveAccess ? 21 : 3,
                          width: hasOverride ? 16 : 14, height: hasOverride ? 16 : 14,
                          borderRadius: '50%',
                          background: hasOverride ? '#fff' : 'var(--border-color)',
                          boxShadow: hasOverride ? '0 1px 3px rgba(0,0,0,0.2)' : 'none',
                          transition: 'left 0.15s',
                          display: 'block',
                        }} />
                      </button>
                    </div>
                    {/* Source label */}
                    <span style={{
                      fontSize: 11, fontWeight: 500,
                      color: !hasOverride ? 'var(--text-tertiary)' : effectiveAccess ? '#16a34a' : '#dc2626',
                    }}>
                      {!hasOverride ? 'Role default' : effectiveAccess ? 'Override: ON' : 'Override: OFF'}
                    </span>
                    {/* Clear button */}
                    <div style={{ textAlign: 'center' }}>
                      {hasOverride && (
                        <button
                          onClick={() => clearOverride(page.key)}
                          disabled={!!saving}
                          title="Remove override — revert to role default"
                          style={{
                            width: 24, height: 24, borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-light)', background: 'var(--bg-tertiary)',
                            color: 'var(--text-tertiary)', cursor: saving ? 'not-allowed' : 'pointer',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 14, lineHeight: 1, transition: 'all 0.12s',
                          }}
                        >×</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
