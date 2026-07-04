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
 *   Internal:  @/contexts/AuthContext (db, employee),
 *              @/components/settings/SettingsPageHeader,
 *              @/lib/navKeys (PAGE_ACCESS_KEYS, roleLabel)
 *   Data:      reads  → get_all_employees, get_employee_page_access,
 *              get_feature_flags, nav_permissions (RPCs/selects)
 *              writes → upsert_employee_page_access / delete_employee_page_access (RPCs)
 *
 * NOTES / GOTCHAS:
 *   - P3 polish (Settings Overhaul): the fixed inline-styled grid
 *     ('1fr 80px 120px 100px 40px' — crushed phones) is replaced with the
 *     `.pa-*` class grid + a <768px stacked-card pass and 44px toggle/clear
 *     targets. Data behavior is unchanged from the Foundation extraction.
 *   - `computeAccess` is the pure effective-access resolver, exported for the
 *     P3 unit test (armed/disarm + access math are test-first).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import SettingsPageHeader from '@/components/settings/SettingsPageHeader';
import { PAGE_ACCESS_KEYS, roleLabel } from '@/lib/navKeys';

// ─── SECTION: Helpers ───
// Pure resolver: given the loaded override map + the role-default map, what is
// the effective access for one page and where does it come from? Kept pure so
// the render stays declarative and the math is unit-tested.
// eslint-disable-next-line react-refresh/only-export-components
export function computeAccess(overrides, rolePerms, navKey) {
  const hasOverride = Object.prototype.hasOwnProperty.call(overrides, navKey);
  const roleDefault = !!rolePerms[navKey];
  const overrideVal = hasOverride ? !!overrides[navKey] : undefined;
  const effective = hasOverride ? overrideVal : roleDefault;
  const source = !hasOverride ? 'role' : overrideVal ? 'override_on' : 'override_off';
  return { hasOverride, roleDefault, overrideVal, effective, source };
}

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

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

  // ─── SECTION: Data fetching ───
  // Load employees (non-admin, active only)
  const loadEmployees = useCallback(async () => {
    try {
      const data = await db.rpc('get_all_employees');
      const nonAdmin = (data || []).filter(e => e.is_active !== false && e.role !== 'admin');
      setEmployees(nonAdmin);
    } catch {
      toast('Failed to load employees', 'error');
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
      toast('Failed to load access data', 'error');
    } finally {
      setLoadingAccess(false);
    }
  }, [db, employees]);

  useEffect(() => { loadAccess(selectedEmployeeId); }, [selectedEmployeeId, loadAccess]);

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  // ─── SECTION: Event handlers ───
  const handleToggle = async (navKey) => {
    const { hasOverride, roleDefault, overrideVal } = computeAccess(overrides, rolePerms, navKey);
    const newValue = !hasOverride ? !roleDefault : !overrideVal;
    setSaving(navKey);
    try {
      await db.rpc('upsert_employee_page_access', {
        p_employee_id: selectedEmployeeId,
        p_nav_key:     navKey,
        p_can_view:    newValue,
        p_updated_by:  currentEmployee?.id,
      });
      setOverrides(prev => ({ ...prev, [navKey]: newValue }));
      toast(`${navKey} ${newValue ? 'granted' : 'revoked'} for ${selectedEmployee?.full_name}`);
    } catch {
      toast('Failed to save', 'error');
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
      toast('Override cleared — reverted to role default');
    } catch {
      toast('Failed to clear override', 'error');
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
      toast(`All overrides cleared for ${selectedEmployee?.full_name}`);
    } catch {
      toast('Failed to clear overrides', 'error');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="admin-loading">Loading…</div>;

  // Group page keys by section
  const sections = PAGE_ACCESS_KEYS.reduce((acc, p) => {
    (acc[p.section] = acc[p.section] || []).push(p);
    return acc;
  }, {});

  const overrideCount = Object.keys(overrides).length;

  // ─── SECTION: Render ───
  return (
    <div className="pa-page">
      <SettingsPageHeader
        title="Page Access"
        subtitle="Grant or restrict individual pages per employee. Overrides role defaults. Admins are unaffected."
      />

      {/* Employee selector + Clear All */}
      <div className="pa-toolbar">
        <select
          className="input pa-select"
          value={selectedEmployeeId}
          onChange={e => { setSelectedEmployeeId(e.target.value); setConfirmClearAll(false); }}
        >
          <option value="">Select an employee…</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.full_name} — {roleLabel(e.role)}</option>
          ))}
        </select>
        {selectedEmployeeId && overrideCount > 0 && (
          <button
            className={`pa-clearall${confirmClearAll ? ' confirm' : ''}`}
            onClick={clearAllOverrides}
            onBlur={() => setConfirmClearAll(false)}
            disabled={saving === 'clear_all'}
          >
            {confirmClearAll ? `Confirm clear ${overrideCount} override${overrideCount !== 1 ? 's' : ''}` : `Clear all overrides (${overrideCount})`}
          </button>
        )}
      </div>

      {!selectedEmployeeId && (
        <div className="pa-empty">Select an employee above to manage their page access.</div>
      )}

      {selectedEmployeeId && loadingAccess && (
        <div className="pa-empty">Loading access data…</div>
      )}

      {selectedEmployeeId && !loadingAccess && (
        <div className="pa-table">
          {Object.entries(sections).map(([section, pages]) => (
            <Fragment key={section}>
              <div className="pa-section-head pa-grid">
                <span>{section}</span>
                <span className="pa-col-label">Role</span>
                <span className="pa-col-label">Override</span>
                <span className="pa-col-label">Source</span>
                <span aria-hidden="true" />
              </div>
              {pages.map((page) => {
                const { hasOverride, roleDefault, overrideVal, effective, source } =
                  computeAccess(overrides, rolePerms, page.key);
                const flag = flags[`page:${page.key}`];
                const forceDisabled = flag?.force_disabled;
                const isSaving = saving === page.key || saving === page.key + '_clear';
                const toggleMod = !hasOverride ? 'pa-toggle--role' : effective ? 'pa-toggle--on' : 'pa-toggle--off';

                return (
                  <div
                    key={page.key}
                    className={`pa-row pa-grid${forceDisabled ? ' pa-row--disabled' : ''}${isSaving ? ' pa-row--saving' : ''}`}
                  >
                    {/* Page label */}
                    <div className="pa-page-label">
                      <span className="pa-page-name">{page.label}</span>
                      {forceDisabled && <span className="pa-badge-disabled">⚠️ Globally disabled</span>}
                    </div>

                    {/* Role default */}
                    <span className={`pa-roledef${roleDefault ? ' on' : ' off'}`} data-label="Role">
                      {roleDefault ? '✅' : '❌'}
                    </span>

                    {/* Override toggle */}
                    <div className="pa-toggle-cell" data-label="Override">
                      <button
                        type="button"
                        className={`pa-toggle ${toggleMod}`}
                        onClick={() => handleToggle(page.key)}
                        disabled={!!saving || forceDisabled}
                        aria-pressed={hasOverride ? effective : undefined}
                        title={
                          forceDisabled
                            ? 'Page is globally disabled in Dev Tools — override has no effect'
                            : hasOverride
                              ? `Override: ${overrideVal ? 'ON' : 'OFF'} — click to flip`
                              : 'No override — click to set one'
                        }
                      >
                        <span className="pa-toggle-dot" />
                      </button>
                    </div>

                    {/* Source label */}
                    <span
                      className={`pa-source pa-source--${source === 'role' ? 'role' : effective ? 'on' : 'off'}`}
                      data-label="Source"
                    >
                      {source === 'role' ? 'Role default' : effective ? 'Override: ON' : 'Override: OFF'}
                    </span>

                    {/* Clear button */}
                    <div className="pa-clear-cell">
                      {hasOverride && (
                        <button
                          type="button"
                          className="pa-clear"
                          onClick={() => clearOverride(page.key)}
                          disabled={!!saving}
                          title="Remove override — revert to role default"
                          aria-label={`Clear override for ${page.label}`}
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
