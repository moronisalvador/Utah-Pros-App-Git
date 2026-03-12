import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Admin() {
  const { db } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [automationRules, setAutomationRules] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      db.select('employees', 'order=full_name.asc&select=id,full_name,email,role,phone,is_active'),
      db.select('automation_rules', 'order=priority.asc&select=id,name,trigger_type,action_type,is_active,priority').catch(() => []),
    ])
      .then(([emps, rules]) => {
        setEmployees(emps);
        setAutomationRules(rules);
      })
      .catch(err => console.error('Admin load error:', err))
      .finally(() => setLoading(false));
  }, [db]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">Team management, automation, and system settings</p>
      </div>

      {/* Employees */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Team ({employees.length})</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Active</th></tr></thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id}>
                  <td style={{ fontWeight: 600 }}>{emp.full_name}</td>
                  <td>{emp.email || '—'}</td>
                  <td><span className="status-badge status-active">{emp.role}</span></td>
                  <td>{emp.phone || '—'}</td>
                  <td>{emp.is_active ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Automation Rules */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Automation Rules ({automationRules.length})</span>
          <button className="btn btn-secondary btn-sm">+ Add Rule</button>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {automationRules.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No automation rules</p>
              <p className="empty-state-text">Set up keyword triggers, after-hours auto-replies, and assignment rules.</p>
            </div>
          ) : (
            <table>
              <thead><tr><th>Priority</th><th>Name</th><th>Trigger</th><th>Action</th><th>Active</th></tr></thead>
              <tbody>
                {automationRules.map(rule => (
                  <tr key={rule.id}>
                    <td>{rule.priority}</td>
                    <td style={{ fontWeight: 600 }}>{rule.name}</td>
                    <td>{rule.trigger_type}</td>
                    <td>{rule.action_type}</td>
                    <td>{rule.is_active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
