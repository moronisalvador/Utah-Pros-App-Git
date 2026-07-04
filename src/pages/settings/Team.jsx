/**
 * ════════════════════════════════════════════════
 * FILE: Team.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The "Team" settings screen — the staff directory. Add a new employee, edit
 *   someone's details/role/pay, send them a welcome (login) email, deactivate or
 *   reactivate them, and permanently delete inactive accounts. Loads everyone and
 *   saves changes through the admin-users worker.
 *
 * WHERE IT LIVES:
 *   Route:        /settings/team
 *   Rendered by:  src/App.jsx (inside SettingsLayout, behind AdminRoute)
 *
 * DEPENDS ON:
 *   Packages:  react, (implicit) crypto.randomUUID
 *   Internal:  @/contexts/AuthContext (db), @/lib/realtime (realtimeClient,
 *              getAuthHeader), @/components/PullToRefresh, @/lib/navKeys (ROLES,
 *              roleLabel)
 *   Data:      reads  → get_all_employees (RPC; falls back to select employees)
 *              writes → employees + Supabase Auth accounts (via /api/admin-users:
 *              POST create, PATCH update, PUT toggle-active, DELETE hard-delete;
 *              welcome email via supabase auth resetPasswordForEmail)
 *
 * NOTES / GOTCHAS:
 *   - Behavior-identical extraction of the old Admin.jsx "Employees" tab (Settings
 *     Overhaul Phase F). The route is AdminRoute-gated, so the old in-component
 *     admin guard was dropped. EmployeeModal travels with this page.
 *   - Hard-delete still uses a confirmation modal here (Rule-2 two-click inline
 *     conversion is P3's job — flagged, not done in Foundation).
 * ════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { realtimeClient, getAuthHeader } from '@/lib/realtime';
import PullToRefresh from '@/components/PullToRefresh';
import { ROLES, roleLabel } from '@/lib/navKeys';

export default function Team() {
  const { db } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [showInactive, setShowInactive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const loadEmployees = useCallback(async () => {
    try {
      setError(null);
      const data = await db.rpc('get_all_employees');
      setEmployees(data || []);
    } catch (err) {
      console.error('Load employees error:', err);
      // Fallback: direct select
      try {
        const data = await db.select('employees', 'order=full_name.asc');
        setEmployees(data || []);
      } catch {
        setError('Failed to load employees');
      }
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const handleToggleActive = async (emp) => {
    setActionLoading(emp.id);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
        body: JSON.stringify({ employee_id: emp.id, is_active: !emp.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      await loadEmployees();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleHardDelete = async (emp) => {
    setActionLoading(emp.id);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
        body: JSON.stringify({ employee_id: emp.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      setConfirmDelete(null);
      await loadEmployees();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const [inviteMsg, setInviteMsg] = useState(null); // { type: 'success'|'error', text }

  const handleSendInvite = async (emp) => {
    setActionLoading(`invite-${emp.id}`);
    setInviteMsg(null);
    try {
      // If no auth account, create one first with a random temp password
      if (!emp.auth_user_id) {
        const tempPw = crypto.randomUUID();
        const res = await fetch('/api/admin-users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
          body: JSON.stringify({ employee_id: emp.id, password: tempPw }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create auth account');
      }

      // Send recovery email via Supabase (this IS the welcome email)
      const { error: resetErr } = await realtimeClient.auth.resetPasswordForEmail(emp.email, {
        redirectTo: 'https://utahpros.app/set-password',
      });
      if (resetErr) throw resetErr;

      setInviteMsg({ type: 'success', text: `Welcome email sent to ${emp.email}` });
      await loadEmployees(); // Refresh to show updated auth_user_id
    } catch (err) {
      setInviteMsg({ type: 'error', text: err.message });
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = showInactive ? employees : employees.filter(e => e.is_active !== false);
  const activeCount = employees.filter(e => e.is_active !== false).length;
  const inactiveCount = employees.filter(e => e.is_active === false).length;

  return (
    <PullToRefresh onRefresh={loadEmployees}>
      <div className="admin-section">
        {/* Header bar */}
        <div className="admin-section-header">
          <div className="admin-section-header-left">
            <span className="admin-count">{activeCount} active</span>
            {inactiveCount > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowInactive(!showInactive)}
                style={{ marginLeft: 8 }}
              >
                {showInactive ? 'Hide' : 'Show'} {inactiveCount} inactive
              </button>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => { setEditingEmployee(null); setShowModal(true); }}>
            + Add Employee
          </button>
        </div>

        {error && (
          <div className="admin-error">
            {error}
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {inviteMsg && (
          <div className={`admin-${inviteMsg.type === 'success' ? 'success' : 'error'}-banner`}>
            {inviteMsg.text}
            <button className="btn btn-ghost btn-sm" onClick={() => setInviteMsg(null)}>✕</button>
          </div>
        )}

        {loading ? (
          <div className="admin-loading">Loading employees…</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Phone</th>
                    <th className="admin-th-num">Hourly</th>
                    <th className="admin-th-num">OT Rate</th>
                    <th>Status</th>
                    <th className="admin-th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(emp => (
                    <tr key={emp.id} className={emp.is_active === false ? 'admin-row-inactive' : ''}>
                      <td>
                        <div className="admin-emp-name">
                          <span className="admin-avatar">{(emp.full_name || '?')[0].toUpperCase()}</span>
                          <div>
                            <div style={{ fontWeight: 600 }}>{emp.full_name}</div>
                            {emp.display_name && emp.display_name !== emp.full_name?.split(' ')[0] && (
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                                "{emp.display_name}"
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{emp.email || '—'}</td>
                      <td><span className={`admin-role-badge role-${emp.role}`}>{roleLabel(emp.role)}</span></td>
                      <td>{emp.phone || '—'}</td>
                      <td className="admin-td-num">{emp.hourly_rate ? `$${Number(emp.hourly_rate).toFixed(2)}` : '—'}</td>
                      <td className="admin-td-num">{emp.overtime_rate ? `$${Number(emp.overtime_rate).toFixed(2)}` : '—'}</td>
                      <td>
                        <span className={`admin-status-pill ${emp.is_active === false ? 'inactive' : 'active'}`}>
                          {emp.is_active === false ? 'Inactive' : 'Active'}
                        </span>
                      </td>
                      <td className="admin-td-actions">
                        <button
                          className="admin-action-btn"
                          onClick={() => { setEditingEmployee(emp); setShowModal(true); }}
                          title="Edit employee"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          Edit
                        </button>
                        {emp.is_active !== false && emp.email && (
                          <button
                            className="admin-action-btn"
                            onClick={() => handleSendInvite(emp)}
                            disabled={actionLoading === `invite-${emp.id}`}
                            title="Send welcome / password reset email"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                            {actionLoading === `invite-${emp.id}` ? 'Sending…' : 'Invite'}
                          </button>
                        )}
                        <button
                          className={`admin-action-btn${emp.is_active === false ? ' admin-action-btn-success' : ' admin-action-btn-warning'}`}
                          onClick={() => handleToggleActive(emp)}
                          disabled={actionLoading === emp.id}
                          title={emp.is_active === false ? 'Reactivate employee' : 'Deactivate employee'}
                        >
                          {actionLoading === emp.id ? '…' : emp.is_active === false ? (
                            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Reactivate</>
                          ) : (
                            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Deactivate</>
                          )}
                        </button>
                        {emp.is_active === false && (
                          <button
                            className="admin-action-btn admin-action-btn-danger"
                            onClick={() => setConfirmDelete(emp)}
                            title="Permanently delete"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 'var(--space-6)' }}>No employees found</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="admin-cards-mobile">
              {filtered.map(emp => (
                <div key={emp.id} className={`admin-emp-card${emp.is_active === false ? ' inactive' : ''}`}>
                  <div className="admin-emp-card-header">
                    <div className="admin-emp-name">
                      <span className="admin-avatar">{(emp.full_name || '?')[0].toUpperCase()}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{emp.full_name}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{emp.email}</div>
                      </div>
                    </div>
                    <span className={`admin-role-badge role-${emp.role}`}>{roleLabel(emp.role)}</span>
                  </div>
                  <div className="admin-emp-card-details">
                    {emp.phone && <span>📞 {emp.phone}</span>}
                    {emp.hourly_rate && <span>💰 ${Number(emp.hourly_rate).toFixed(2)}/hr</span>}
                    <span className={`admin-status-pill ${emp.is_active === false ? 'inactive' : 'active'}`}>
                      {emp.is_active === false ? 'Inactive' : 'Active'}
                    </span>
                  </div>
                  <div className="admin-emp-card-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditingEmployee(emp); setShowModal(true); }}>
                      Edit
                    </button>
                    {emp.is_active !== false && emp.email && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleSendInvite(emp)}
                        disabled={actionLoading === `invite-${emp.id}`}
                      >
                        {actionLoading === `invite-${emp.id}` ? 'Sending…' : 'Send Invite'}
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleToggleActive(emp)}
                      disabled={actionLoading === emp.id}
                    >
                      {emp.is_active === false ? 'Reactivate' : 'Deactivate'}
                    </button>
                    {emp.is_active === false && (
                      <button className="btn btn-ghost btn-sm admin-btn-danger" onClick={() => setConfirmDelete(emp)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Auth status note */}
        {employees.some(e => !e.auth_user_id) && (
          <div className="admin-info-banner">
            ⚠️ {employees.filter(e => !e.auth_user_id).length} employee(s) have no linked auth account.
            Edit them to set a password and create their login.
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <EmployeeModal
          employee={editingEmployee}
          onClose={() => { setShowModal(false); setEditingEmployee(null); }}
          onSaved={() => { setShowModal(false); setEditingEmployee(null); loadEmployees(); }}
        />
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="admin-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="admin-modal admin-modal-sm" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Permanently Delete Employee</h3>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: 'var(--space-3)' }}>
                This will <strong>permanently delete</strong> <strong>{confirmDelete.full_name}</strong> and their
                Supabase Auth account. This cannot be undone.
              </p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                Any jobs, time entries, or messages linked to this employee will lose their association.
              </p>
            </div>
            <div className="admin-modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                className="btn admin-btn-danger-fill"
                onClick={() => handleHardDelete(confirmDelete)}
                disabled={actionLoading === confirmDelete.id}
              >
                {actionLoading === confirmDelete.id ? 'Deleting…' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PullToRefresh>
  );
}

// ══════════════════════════════════════════════════════════════
// EMPLOYEE ADD/EDIT MODAL
// ══════════════════════════════════════════════════════════════
function EmployeeModal({ employee, onClose, onSaved }) {
  const isEdit = !!employee;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [sendInvite, setSendInvite] = useState(!isEdit); // Default: invite for new

  const [form, setForm] = useState({
    full_name: employee?.full_name || '',
    display_name: employee?.display_name || '',
    email: employee?.email || '',
    phone: employee?.phone || '',
    role: employee?.role || 'field_tech',
    hourly_rate: employee?.hourly_rate ?? '',
    overtime_rate: employee?.overtime_rate ?? '',
    is_external: employee?.is_external ?? false,
    password: '',
  });

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      if (isEdit) {
        // PATCH — update existing (worker handles auth creation for unlinked employees)
        const payload = { employee_id: employee.id };

        // Only include changed fields
        if (form.full_name !== employee.full_name) payload.full_name = form.full_name;
        if (form.display_name !== (employee.display_name || '')) payload.display_name = form.display_name;
        if (form.email !== employee.email) payload.email = form.email;
        if (form.phone !== (employee.phone || '')) payload.phone = form.phone;
        if (form.role !== employee.role) payload.role = form.role;
        if (form.hourly_rate !== (employee.hourly_rate ?? '')) payload.hourly_rate = form.hourly_rate;
        if (form.overtime_rate !== (employee.overtime_rate ?? '')) payload.overtime_rate = form.overtime_rate;
        if (form.is_external !== (employee.is_external ?? false)) payload.is_external = form.is_external;
        if (form.password) payload.password = form.password;

        const res = await fetch('/api/admin-users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update employee');
      } else {
        // POST — create new
        const password = sendInvite ? crypto.randomUUID() : form.password;

        const res = await fetch('/api/admin-users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...await getAuthHeader() },
          body: JSON.stringify({
            email: form.email,
            password,
            full_name: form.full_name,
            display_name: form.display_name,
            role: form.role,
            phone: form.phone,
            hourly_rate: form.hourly_rate,
            overtime_rate: form.overtime_rate,
            is_external: form.is_external,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create employee');

        // If invite mode, send the welcome/recovery email
        if (sendInvite) {
          const { error: resetErr } = await realtimeClient.auth.resetPasswordForEmail(
            form.email.trim(),
            { redirectTo: 'https://utahpros.app/set-password' }
          );
          if (resetErr) throw resetErr;
        }
      }

      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3>{isEdit ? 'Edit Employee' : 'Add Employee'}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="admin-modal-body">
          {error && <div className="admin-error" style={{ marginBottom: 'var(--space-3)' }}>{error}</div>}

          {isEdit && !employee.auth_user_id && (
            <div className="admin-info-banner" style={{ marginBottom: 'var(--space-4)' }}>
              ⚠️ No auth account linked. Set a password below to create login access.
            </div>
          )}

          <div className="admin-form-grid">
            <div className="admin-field">
              <label className="label">Full Name *</label>
              <input
                className="input"
                value={form.full_name}
                onChange={e => set('full_name', e.target.value)}
                placeholder="John Smith"
              />
            </div>
            <div className="admin-field">
              <label className="label">Display Name</label>
              <input
                className="input"
                value={form.display_name}
                onChange={e => set('display_name', e.target.value)}
                placeholder="John"
              />
              <span className="admin-field-hint">Short name for UI. Defaults to first name.</span>
            </div>
            <div className="admin-field">
              <label className="label">Email *</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="john@utahpros.com"
              />
            </div>
            <div className="admin-field">
              <label className="label">Phone</label>
              <input
                className="input"
                type="tel"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="(801) 555-1234"
              />
            </div>
            <div className="admin-field">
              <label className="label">Role *</label>
              <select
                className="input"
                value={form.role}
                onChange={e => set('role', e.target.value)}
              >
                {ROLES.map(r => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-checkbox-row">
                <input
                  type="checkbox"
                  checked={form.is_external}
                  onChange={e => set('is_external', e.target.checked)}
                />
                External account (vendor/agency — not internal staff)
              </label>
              <span className="admin-field-hint">Reporting/audit marker only — a CRM Partner's actual access is scoped entirely by their Role above.</span>
            </div>
            <div className="admin-field">
              {isEdit ? (
                <>
                  <label className="label">
                    Password {employee.auth_user_id ? '(leave blank to keep current)' : '*'}
                  </label>
                  <div className="admin-password-wrap">
                    <input
                      className="input admin-password-input"
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={e => set('password', e.target.value)}
                      placeholder={employee.auth_user_id ? '••••••••' : 'Min 6 characters'}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="admin-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="label">Login Access</label>
                  <div className="admin-invite-toggle">
                    <label className="admin-checkbox-row">
                      <input
                        type="checkbox"
                        checked={sendInvite}
                        onChange={e => setSendInvite(e.target.checked)}
                      />
                      <span>Send welcome email</span>
                    </label>
                    <span className="admin-field-hint">
                      {sendInvite
                        ? 'Employee will receive an email to set their own password.'
                        : 'Set the password manually below.'}
                    </span>
                  </div>
                  {!sendInvite && (
                    <div className="admin-password-wrap" style={{ marginTop: 'var(--space-2)' }}>
                      <input
                        className="input admin-password-input"
                        type={showPassword ? 'text' : 'password'}
                        value={form.password}
                        onChange={e => set('password', e.target.value)}
                        placeholder="Min 6 characters"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="admin-password-toggle"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="admin-field">
              <label className="label">Hourly Rate</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={form.hourly_rate}
                onChange={e => set('hourly_rate', e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="admin-field">
              <label className="label">Overtime Rate</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={form.overtime_rate}
                onChange={e => set('overtime_rate', e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        <div className="admin-modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={saving || !form.full_name.trim() || !form.email.trim() || !form.role.trim() || (!isEdit && !sendInvite && !form.password)}
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : sendInvite ? 'Create & Send Invite' : 'Create Employee'}
          </button>
        </div>
      </div>
    </div>
  );
}
