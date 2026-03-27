import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { realtimeClient } from '@/lib/realtime';
import PullToRefresh from '@/components/PullToRefresh';

// ── Nav keys for permissions matrix (must match Sidebar.jsx) ──
const NAV_KEYS = [
  { key: 'dashboard', label: 'Dashboard', section: 'Main' },
  { key: 'conversations', label: 'Conversations', section: 'Main' },
  { key: 'jobs', label: 'Jobs', section: 'Main' },
  { key: 'leads', label: 'Leads', section: 'Main' },
  { key: 'customers', label: 'Customers', section: 'Main' },
  { key: 'production', label: 'Production', section: 'Operations' },
  { key: 'schedule', label: 'Schedule', section: 'Operations' },
  { key: 'time_tracking', label: 'Time Tracking', section: 'Operations' },
  { key: 'marketing', label: 'Marketing', section: 'Growth' },
  { key: 'admin_panel', label: 'Admin', section: 'System' },
  { key: 'settings', label: 'Settings', section: 'System' },
];

const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'office', label: 'Office' },
  { key: 'project_manager', label: 'Project Manager' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'field_tech', label: 'Field Tech' },
];

const ROLE_MAP = Object.fromEntries(ROLES.map(r => [r.key, r.label]));

function roleLabel(role) {
  return ROLE_MAP[role] || role;
}

// ══════════════════════════════════════════════════════════════
// MAIN ADMIN PAGE
// ══════════════════════════════════════════════════════════════
export default function Admin() {
  const { employee: currentUser, db } = useAuth();
  const [activeTab, setActiveTab] = useState('employees');

  // Block non-admin access
  if (currentUser && currentUser.role !== 'admin') {
    return (
      <div className="admin-page">
        <div className="page-header">
          <h1 className="page-title">Admin</h1>
        </div>
        <div style={{ padding: 'var(--space-6)', color: 'var(--text-secondary)' }}>
          You don't have permission to access this page.
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="page-header">
        <h1 className="page-title">Admin</h1>
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab${activeTab === 'employees' ? ' active' : ''}`}
          onClick={() => setActiveTab('employees')}
        >
          Employees
        </button>
        <button
          className={`admin-tab${activeTab === 'permissions' ? ' active' : ''}`}
          onClick={() => setActiveTab('permissions')}
        >
          Roles & Permissions
        </button>
        <button
          className={`admin-tab${activeTab === 'page_access' ? ' active' : ''}`}
          onClick={() => setActiveTab('page_access')}
        >
          Page Access
        </button>
      </div>

      {activeTab === 'employees' && <EmployeesTab />}
      {activeTab === 'permissions' && <PermissionsTab />}
      {activeTab === 'page_access' && <PageAccessTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// EMPLOYEES TAB
// ══════════════════════════════════════════════════════════════
// Helper: get current session token for admin-users worker calls
async function getAuthHeader() {
  const { data: { session } } = await realtimeClient.auth.getSession();
  const token = session?.access_token;
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function EmployeesTab() {
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
      } catch (err2) {
        setError('Failed to load employees');
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
        redirectTo: window.location.origin + '/set-password',
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
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create employee');

        // If invite mode, send the welcome/recovery email
        if (sendInvite) {
          const { error: resetErr } = await realtimeClient.auth.resetPasswordForEmail(
            form.email.trim(),
            { redirectTo: window.location.origin + '/set-password' }
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

// ══════════════════════════════════════════════════════════════
// PERMISSIONS TAB — Role × Nav Key matrix
// ══════════════════════════════════════════════════════════════
function PermissionsTab() {
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
    } catch (err) {
      setError('Failed to load permissions');
    } finally {
      setLoading(false);
    }
  }, []);

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
    } catch (err) {
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

// ══════════════════════════════════════════════════════════════
// PAGE ACCESS TAB — per-employee page overrides
// ══════════════════════════════════════════════════════════════

const PAGE_ACCESS_KEYS = [
  { key: 'dashboard',          label: 'Dashboard',          section: 'Main' },
  { key: 'conversations',      label: 'Conversations',      section: 'Main' },
  { key: 'claims',             label: 'Claims',             section: 'Main' },
  { key: 'jobs',               label: 'Jobs',               section: 'Main' },
  { key: 'production',         label: 'Production',         section: 'Main' },
  { key: 'customers',          label: 'Customers',          section: 'Main' },
  { key: 'schedule',           label: 'Schedule',           section: 'Operations' },
  { key: 'schedule_templates', label: 'Schedule Templates', section: 'Operations' },
  { key: 'time_tracking',      label: 'Time Tracking',      section: 'Operations' },
  { key: 'collections',        label: 'Collections',        section: 'Operations' },
  { key: 'leads',              label: 'Leads',              section: 'Operations' },
  { key: 'marketing',          label: 'Marketing',          section: 'Growth' },
];

function PageAccessTab() {
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
    } catch (e) {
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
    } catch (e) {
      window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: 'Failed to load access data', type: 'error' } }));
    } finally {
      setLoadingAccess(false);
    }
  }, [db, employees]);

  useEffect(() => { loadAccess(selectedEmployeeId); }, [selectedEmployeeId, loadAccess]);

  const selectedEmployee = employees.find(e => e.id === selectedEmployeeId);

  const handleToggle = async (navKey) => {
    const currentOverride = overrides.hasOwnProperty(navKey) ? overrides[navKey] : undefined;
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) {
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
                const hasOverride = overrides.hasOwnProperty(page.key);
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

