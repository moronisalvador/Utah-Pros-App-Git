/**
 * ════════════════════════════════════════════════
 * FILE: NotificationDefaultsTab.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The admin "Notifications" screen. It lets an admin decide, for each staff
 *   role, which alerts people get and how (in-app bell, push, or email), and
 *   whether each person is allowed to change that themselves (the "lock"). It
 *   also lets an admin override those choices for one specific employee. Every
 *   toggle saves the moment you click it.
 *
 * WHERE IT LIVES:
 *   Route:        /admin (the "Notifications" tab)
 *   Rendered by:  src/pages/Admin.jsx
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (useAuth → db, current employee)
 *   Data:      reads  → notification catalog + role defaults via
 *                        get_notification_defaults();
 *                        per-employee tri-state via
 *                        get_employee_notification_overrides();
 *                        employee list via get_all_employees
 *              writes → set_notification_default (role×type×channel + lock),
 *                        set_employee_notification_override,
 *                        delete_employee_notification_override
 *
 * NOTES / GOTCHAS:
 *   - The three preference layers resolve ONLY in the F2 resolver
 *     (get_effective_notification_prefs); this screen writes layers 1 (role
 *     default) and 2 (employee override). It never touches layer 3 (a user's own
 *     self-service pref) — that's Session C's NotificationsPanel.
 *   - The "lock" (user_customizable) is stored per role×type×channel but presented
 *     as one per-role×type control; flipping it writes all three channel rows so
 *     they stay in sync (each keeps its current on/off value).
 *   - Clearing an employee's overrides is a two-click inline confirm (Rule 2 — no
 *     confirm()/modal); toggles auto-save with a toast.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Role order + labels for the defaults matrix. Mirrors Admin.jsx ROLES and the
// role set get_notification_defaults() expands over.
const ROLE_LABELS = {
  admin: 'Admin',
  office: 'Office',
  project_manager: 'Project Manager',
  supervisor: 'Supervisor',
  field_tech: 'Field Tech',
  crm_partner: 'CRM Partner',
};
const ROLE_ORDER = ['admin', 'office', 'project_manager', 'supervisor', 'field_tech', 'crm_partner'];
const CHANNELS = [
  { key: 'bell', label: 'Bell' },
  { key: 'push', label: 'Push' },
  { key: 'email', label: 'Email' },
];

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

export default function NotificationDefaultsTab() {
  const [view, setView] = useState('roles'); // 'roles' | 'employees'

  return (
    <div className="notify-def">
      <div className="notify-def-intro">
        <div className="notify-def-title">Notifications</div>
        <div className="notify-def-sub">
          System-wide defaults per role, and per-employee overrides. The <strong>lock</strong> hides
          a row from that person&rsquo;s own notification settings. The bell is always on for enabled
          alerts; push only reaches devices that opted in.
        </div>
      </div>

      <div className="notify-def-viewnav">
        <button
          className={`notify-def-viewbtn${view === 'roles' ? ' active' : ''}`}
          onClick={() => setView('roles')}
        >
          Role Defaults
        </button>
        <button
          className={`notify-def-viewbtn${view === 'employees' ? ' active' : ''}`}
          onClick={() => setView('employees')}
        >
          Employee Overrides
        </button>
      </div>

      {view === 'roles' ? <RoleDefaults /> : <EmployeeOverrides />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ROLE DEFAULTS — role × type × channel matrix + per-type lock
// ══════════════════════════════════════════════════════════════
function RoleDefaults() {
  const { db } = useAuth();
  const [rows, setRows] = useState([]); // flat rows from get_notification_defaults
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('field_tech');
  const [saving, setSaving] = useState(null); // "type|channel" or "type|lock"

  // ─── SECTION: Data fetching ───
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.rpc('get_notification_defaults');
      setRows(data || []);
    } catch {
      toast('Failed to load notification defaults', 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="notify-def-loading">Loading defaults…</div>;

  // Roles actually present in the data, in preferred order.
  const rolesPresent = ROLE_ORDER.filter(r => rows.some(x => x.role === r));

  // Types for the selected role, one entry per type (deduped), sorted.
  const typeMap = new Map();
  for (const r of rows) {
    if (r.role !== role) continue;
    if (!typeMap.has(r.type_key)) {
      typeMap.set(r.type_key, {
        type_key: r.type_key, label: r.label, category: r.category,
        sort_order: r.sort_order, type_enabled: r.type_enabled, channels: {},
      });
    }
    typeMap.get(r.type_key).channels[r.channel] = r;
  }
  const types = [...typeMap.values()].sort((a, b) => a.sort_order - b.sort_order);

  // ─── SECTION: Event handlers ───
  const patchRow = (roleKey, typeKey, channel, patch) => {
    setRows(prev => prev.map(x =>
      x.role === roleKey && x.type_key === typeKey && x.channel === channel
        ? { ...x, ...patch } : x));
  };

  const toggleChannel = async (t, channel) => {
    const cell = t.channels[channel];
    const next = !cell.enabled;
    const key = `${t.type_key}|${channel}`;
    setSaving(key);
    try {
      // p_user_customizable omitted → server leaves the lock unchanged.
      await db.rpc('set_notification_default', {
        p_role: role, p_type_key: t.type_key, p_channel: channel, p_enabled: next,
      });
      patchRow(role, t.type_key, channel, { enabled: next, has_default: true });
    } catch {
      toast('Failed to save', 'error');
    } finally {
      setSaving(null);
    }
  };

  // Lock is per role×type: write all three channels so they stay in sync,
  // each carrying its current enabled value.
  const toggleLock = async (t) => {
    const currentlyLocked = CHANNELS.some(c => t.channels[c.key]?.user_customizable === false);
    const nextCustomizable = currentlyLocked; // if locked → make customizable; else lock
    const key = `${t.type_key}|lock`;
    setSaving(key);
    try {
      await Promise.all(CHANNELS.map(c =>
        db.rpc('set_notification_default', {
          p_role: role, p_type_key: t.type_key, p_channel: c.key,
          p_enabled: !!t.channels[c.key]?.enabled,
          p_user_customizable: nextCustomizable,
        })));
      CHANNELS.forEach(c =>
        patchRow(role, t.type_key, c.key, { user_customizable: nextCustomizable, has_default: true }));
      toast(nextCustomizable ? 'Unlocked — employees can change this' : 'Locked — hidden from employees');
    } catch {
      toast('Failed to save lock', 'error');
    } finally {
      setSaving(null);
    }
  };

  // ─── SECTION: Render ───
  return (
    <div>
      <div className="notify-def-roletabs">
        {rolesPresent.map(r => (
          <button
            key={r}
            className={`notify-def-roletab${role === r ? ' active' : ''}`}
            onClick={() => setRole(r)}
          >
            {ROLE_LABELS[r] || r}
          </button>
        ))}
      </div>

      <div className="notify-def-tablewrap">
        <table className="notify-def-table">
          <thead>
            <tr>
              <th className="notify-def-th-type">Notification</th>
              {CHANNELS.map(c => <th key={c.key} className="notify-def-th-ch">{c.label}</th>)}
              <th className="notify-def-th-lock">Lock</th>
            </tr>
          </thead>
          <tbody>
            {types.map(t => {
              const locked = CHANNELS.some(c => t.channels[c.key]?.user_customizable === false);
              return (
                <tr key={t.type_key} className={t.type_enabled ? '' : 'notify-def-row-inert'}>
                  <td className="notify-def-td-type">
                    <span className="notify-def-typelabel">{t.label}</span>
                    {!t.type_enabled && <span className="notify-def-inert-badge">Not live yet</span>}
                  </td>
                  {CHANNELS.map(c => {
                    const cell = t.channels[c.key];
                    const on = !!cell?.enabled;
                    const busy = saving === `${t.type_key}|${c.key}`;
                    return (
                      <td key={c.key} className="notify-def-td-ch">
                        <button
                          className={`admin-toggle${on ? ' on' : ''}`}
                          onClick={() => toggleChannel(t, c.key)}
                          disabled={busy || saving === `${t.type_key}|lock`}
                          title={`${on ? 'Disable' : 'Enable'} ${c.label.toLowerCase()} for ${ROLE_LABELS[role] || role}`}
                        >
                          <span className="admin-toggle-dot" />
                        </button>
                      </td>
                    );
                  })}
                  <td className="notify-def-td-lock">
                    <button
                      className={`notify-def-lockbtn${locked ? ' locked' : ''}`}
                      onClick={() => toggleLock(t)}
                      disabled={saving === `${t.type_key}|lock`}
                      title={locked
                        ? 'Locked — employees cannot change this; click to unlock'
                        : 'Unlocked — employees may change this in their own settings; click to lock'}
                    >
                      {locked ? '🔒' : '🔓'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="notify-def-note">
        Toggles auto-save. A <strong>locked</strong> row uses the role default (or an employee
        override) and disappears from that person&rsquo;s self-service notification settings.
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// EMPLOYEE OVERRIDES — per-employee tri-state (default / on / off)
// ══════════════════════════════════════════════════════════════
function EmployeeOverrides() {
  const { db, employee: currentEmployee } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [rows, setRows] = useState([]); // get_employee_notification_overrides
  const [loading, setLoading] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(null); // "type|channel"
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // ─── SECTION: Data fetching ───
  const loadEmployees = useCallback(async () => {
    try {
      const data = await db.rpc('get_all_employees');
      setEmployees((data || []).filter(e => e.is_active !== false && e.role !== 'admin'));
    } catch {
      toast('Failed to load employees', 'error');
    } finally {
      setLoading(false);
    }
  }, [db]);
  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const loadRows = useCallback(async (empId) => {
    if (!empId) { setRows([]); return; }
    setLoadingRows(true);
    try {
      const data = await db.rpc('get_employee_notification_overrides', { p_employee_id: empId });
      setRows(data || []);
    } catch {
      toast('Failed to load overrides', 'error');
    } finally {
      setLoadingRows(false);
    }
  }, [db]);
  useEffect(() => { loadRows(selectedId); }, [selectedId, loadRows]);

  const selected = employees.find(e => e.id === selectedId);

  if (loading) return <div className="notify-def-loading">Loading…</div>;

  // Group rows by type (preserving sort order); each holds its 3 channel cells.
  const typeMap = new Map();
  for (const r of rows) {
    if (!typeMap.has(r.type_key)) {
      typeMap.set(r.type_key, {
        type_key: r.type_key, label: r.label, sort_order: r.sort_order,
        type_enabled: r.type_enabled, channels: {},
      });
    }
    typeMap.get(r.type_key).channels[r.channel] = r;
  }
  const types = [...typeMap.values()].sort((a, b) => a.sort_order - b.sort_order);
  const overrideCount = rows.filter(r => r.has_override).length;

  // ─── SECTION: Event handlers ───
  const patchCell = (typeKey, channel, patch) => {
    setRows(prev => prev.map(x =>
      x.type_key === typeKey && x.channel === channel ? { ...x, ...patch } : x));
  };

  // Clicking a channel: no override → set one opposite the role default; has
  // override → flip it.
  const toggleOverride = async (cell) => {
    const next = cell.has_override ? !cell.override_enabled : !cell.role_default;
    const key = `${cell.type_key}|${cell.channel}`;
    setSaving(key);
    try {
      await db.rpc('set_employee_notification_override', {
        p_employee_id: selectedId, p_type_key: cell.type_key, p_channel: cell.channel,
        p_enabled: next, p_actor_id: currentEmployee?.id,
      });
      patchCell(cell.type_key, cell.channel, {
        has_override: true, override_enabled: next, effective: next,
      });
    } catch {
      toast('Failed to save override', 'error');
    } finally {
      setSaving(null);
    }
  };

  const clearOverride = async (cell) => {
    const key = `${cell.type_key}|${cell.channel}`;
    setSaving(key + '|clear');
    try {
      await db.rpc('delete_employee_notification_override', {
        p_employee_id: selectedId, p_type_key: cell.type_key, p_channel: cell.channel,
      });
      // Effective reverts to the role default (my-pref layer isn't shown here).
      patchCell(cell.type_key, cell.channel, {
        has_override: false, override_enabled: null, effective: cell.role_default,
      });
      toast('Override cleared — back to role default');
    } catch {
      toast('Failed to clear override', 'error');
    } finally {
      setSaving(null);
    }
  };

  const clearAll = async () => {
    if (!confirmClearAll) { setConfirmClearAll(true); return; }
    setConfirmClearAll(false);
    setSaving('clear_all');
    try {
      const overridden = rows.filter(r => r.has_override);
      await Promise.all(overridden.map(r =>
        db.rpc('delete_employee_notification_override', {
          p_employee_id: selectedId, p_type_key: r.type_key, p_channel: r.channel,
        })));
      setRows(prev => prev.map(r =>
        r.has_override ? { ...r, has_override: false, override_enabled: null, effective: r.role_default } : r));
      toast(`All overrides cleared for ${selected?.full_name || 'employee'}`);
    } catch {
      toast('Failed to clear overrides', 'error');
    } finally {
      setSaving(null);
    }
  };

  // ─── SECTION: Render ───
  return (
    <div>
      <div className="notify-def-empbar">
        <select
          className="input notify-def-empselect"
          value={selectedId}
          onChange={e => { setSelectedId(e.target.value); setConfirmClearAll(false); }}
        >
          <option value="">Select an employee…</option>
          {employees.map(e => (
            <option key={e.id} value={e.id}>{e.full_name} — {ROLE_LABELS[e.role] || e.role}</option>
          ))}
        </select>
        {selectedId && overrideCount > 0 && (
          <button
            className={`notify-def-clearall${confirmClearAll ? ' confirm' : ''}`}
            onClick={clearAll}
            onBlur={() => setConfirmClearAll(false)}
            disabled={saving === 'clear_all'}
          >
            {confirmClearAll
              ? `Confirm — clear ${overrideCount} override${overrideCount !== 1 ? 's' : ''}`
              : `Clear all overrides (${overrideCount})`}
          </button>
        )}
      </div>

      {!selectedId && (
        <div className="notify-def-empty">Select an employee to manage their notification overrides.</div>
      )}

      {selectedId && loadingRows && <div className="notify-def-loading">Loading overrides…</div>}

      {selectedId && !loadingRows && (
        <div className="notify-def-tablewrap">
          <table className="notify-def-table">
            <thead>
              <tr>
                <th className="notify-def-th-type">Notification</th>
                {CHANNELS.map(c => <th key={c.key} className="notify-def-th-ch">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {types.map(t => (
                <tr key={t.type_key} className={t.type_enabled ? '' : 'notify-def-row-inert'}>
                  <td className="notify-def-td-type">
                    <span className="notify-def-typelabel">{t.label}</span>
                    {!t.type_enabled && <span className="notify-def-inert-badge">Not live yet</span>}
                  </td>
                  {CHANNELS.map(c => {
                    const cell = t.channels[c.key];
                    if (!cell) return <td key={c.key} className="notify-def-td-ch" />;
                    const busy = saving === `${t.type_key}|${c.key}` || saving === `${t.type_key}|${c.key}|clear`;
                    const hasOv = cell.has_override;
                    const eff = cell.effective;
                    return (
                      <td key={c.key} className="notify-def-td-ch">
                        <div className="notify-def-tri">
                          <button
                            className={`notify-def-tri-toggle${hasOv ? (eff ? ' on' : ' off') : ' inherit'}`}
                            onClick={() => toggleOverride(cell)}
                            disabled={busy || saving === 'clear_all'}
                            title={hasOv
                              ? `Override: ${eff ? 'ON' : 'OFF'} — click to flip (role default ${cell.role_default ? 'ON' : 'OFF'})`
                              : `Following role default (${cell.role_default ? 'ON' : 'OFF'}) — click to override`}
                          >
                            <span className="notify-def-tri-dot" />
                          </button>
                          {hasOv && (
                            <button
                              className="notify-def-clearone"
                              onClick={() => clearOverride(cell)}
                              disabled={busy || saving === 'clear_all'}
                              title="Remove override — revert to role default"
                            >×</button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && !loadingRows && (
        <div className="notify-def-note">
          A dashed toggle follows the role default. Set an override to force a channel on or off for
          this employee; the <strong>×</strong> reverts it. Effective values match what the employee
          actually receives, except where they&rsquo;ve set their own (unlocked) preference.
        </div>
      )}
    </div>
  );
}
