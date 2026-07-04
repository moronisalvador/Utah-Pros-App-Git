/**
 * ════════════════════════════════════════════════
 * FILE: Roles.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Roles & Permissions" settings screen — a grid of every role across every
 *   page, with View/Edit toggles. Flip a toggle to grant or revoke a whole role's
 *   access to a page; it saves instantly. Admin always has full access and can't
 *   be restricted.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/roles
 *   Rendered by:  src/App.jsx (inside SettingsLayout, behind AdminRoute)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/contexts/AuthContext (db), @/lib/navKeys (NAV_KEYS, ROLES, roleLabel)
 *   Data:      reads  → get_all_permissions (RPC; falls back to select nav_permissions)
 *              writes → upsert_permission (RPC; falls back to nav_permissions upsert)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Admin.jsx "Roles & Permissions" tab
 *     (Settings Overhaul Phase F). Toggles auto-save; turning off View also turns
 *     off Edit, turning on Edit also turns on View.
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { NAV_KEYS, ROLES, roleLabel } from '@/lib/navKeys';

export default function Roles() {
  const { db } = useAuth();
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null); // "role:nav_key:field"
  const [error, setError] = useState(null);

  const roles = ROLES.map(r => r.key);

  const loadData = useCallback(async () => {
    try {
      setError(null);

      let perms;
      try {
        perms = await db.rpc('get_all_permissions');
      } catch {
        perms = await db.select('nav_permissions', 'order=role.asc,nav_key.asc').catch(() => []);
      }
      setPermissions(perms || []);
    } catch {
      setError('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { loadData(); }, [loadData]);

  // Get permission value for a role + nav_key
  const getPerm = (role, navKey, field) => {
    const p = permissions.find(pm => pm.role === role && pm.nav_key === navKey);
    return p ? p[field] : false;
  };

  // Toggle a permission
  const togglePerm = async (role, navKey, field) => {
    const current = getPerm(role, navKey, field);
    const newValue = !current;

    // If turning off can_view, also turn off can_edit
    let newView = field === 'can_view' ? newValue : getPerm(role, navKey, 'can_view');
    let newEdit = field === 'can_edit' ? newValue : getPerm(role, navKey, 'can_edit');
    if (field === 'can_view' && !newValue) newEdit = false;
    // If turning on can_edit, also turn on can_view
    if (field === 'can_edit' && newValue) newView = true;

    const saveKey = `${role}:${navKey}:${field}`;
    setSaving(saveKey);

    try {
      // Optimistic update
      setPermissions(prev => {
        const idx = prev.findIndex(p => p.role === role && p.nav_key === navKey);
        const updated = { role, nav_key: navKey, can_view: newView, can_edit: newEdit };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updated };
          return next;
        }
        return [...prev, { id: null, ...updated }];
      });

      // Save via RPC
      try {
        await db.rpc('upsert_permission', {
          p_role: role,
          p_nav_key: navKey,
          p_can_view: newView,
          p_can_edit: newEdit,
        });
      } catch {
        // Fallback: direct upsert
        const existing = permissions.find(p => p.role === role && p.nav_key === navKey);
        if (existing?.id) {
          await db.update('nav_permissions', `id=eq.${existing.id}`, { can_view: newView, can_edit: newEdit });
        } else {
          await db.insert('nav_permissions', { role, nav_key: navKey, can_view: newView, can_edit: newEdit });
        }
      }
    } catch {
      setError('Failed to save permission');
      await loadData(); // Revert
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="admin-loading">Loading permissions…</div>;

  // Group nav keys by section
  const sections = [];
  let currentSection = null;
  for (const nav of NAV_KEYS) {
    if (nav.section !== currentSection) {
      currentSection = nav.section;
      sections.push({ section: nav.section, keys: [] });
    }
    sections[sections.length - 1].keys.push(nav);
  }

  return (
    <div className="admin-section">
      <div className="admin-section-header">
        <div className="admin-section-header-left">
          <span className="admin-count">{roles.length} roles × {NAV_KEYS.length} pages</span>
        </div>
      </div>

      {error && (
        <div className="admin-error">
          {error}
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Permissions Matrix */}
      <div className="admin-perms-wrap">
        <table className="admin-perms-table">
          <thead>
            <tr>
              <th className="admin-perms-nav-header">Page</th>
              {roles.map(role => (
                <th key={role} className="admin-perms-role-header" colSpan={2}>
                  <span className={`admin-role-badge role-${role}`}>{roleLabel(role)}</span>
                </th>
              ))}
            </tr>
            <tr>
              <th></th>
              {roles.map(role => (
                <Fragment key={role}>
                  <th className="admin-perms-sub-header">View</th>
                  <th className="admin-perms-sub-header">Edit</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(sec => (
              <Fragment key={sec.section}>
                <tr className="admin-perms-section-row">
                  <td colSpan={1 + roles.length * 2} className="admin-perms-section-label">
                    {sec.section}
                  </td>
                </tr>
                {sec.keys.map(nav => (
                  <tr key={nav.key}>
                    <td className="admin-perms-nav-cell">{nav.label}</td>
                    {roles.map(role => {
                      const isAdmin = role === 'admin';
                      const canView = isAdmin ? true : getPerm(role, nav.key, 'can_view');
                      const canEdit = isAdmin ? true : getPerm(role, nav.key, 'can_edit');
                      const viewKey = `${role}:${nav.key}:can_view`;
                      const editKey = `${role}:${nav.key}:can_edit`;

                      return (
                        <Fragment key={role}>
                          <td className="admin-perms-toggle-cell">
                            <button
                              className={`admin-toggle${canView ? ' on' : ''}`}
                              onClick={() => !isAdmin && togglePerm(role, nav.key, 'can_view')}
                              disabled={isAdmin || saving === viewKey}
                              title={isAdmin ? 'Admin always has full access' : `${canView ? 'Revoke' : 'Grant'} view`}
                            >
                              <span className="admin-toggle-dot" />
                            </button>
                          </td>
                          <td className="admin-perms-toggle-cell">
                            <button
                              className={`admin-toggle${canEdit ? ' on' : ''}`}
                              onClick={() => !isAdmin && togglePerm(role, nav.key, 'can_edit')}
                              disabled={isAdmin || saving === editKey}
                              title={isAdmin ? 'Admin always has full access' : `${canEdit ? 'Revoke' : 'Grant'} edit`}
                            >
                              <span className="admin-toggle-dot" />
                            </button>
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-perms-note">
        Admin role always has full access and cannot be restricted. Toggles auto-save.
        Turning off View also turns off Edit. Turning on Edit also turns on View.
      </div>
    </div>
  );
}
