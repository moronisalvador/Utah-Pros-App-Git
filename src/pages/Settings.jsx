import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Settings() {
  const { db, employee } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.select('message_templates', 'order=title.asc&select=id,title,body,category,is_active')
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [db]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Account preferences and configuration</p>
      </div>

      {/* Profile */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title">Your Profile</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label className="label">Name</label>
              <input className="input" value={employee?.full_name || ''} readOnly />
            </div>
            <div className="form-group">
              <label className="label">Email</label>
              <input className="input" value={employee?.email || ''} readOnly />
            </div>
            <div className="form-group">
              <label className="label">Role</label>
              <input className="input" value={employee?.role || ''} readOnly />
            </div>
            <div className="form-group">
              <label className="label">Phone</label>
              <input className="input" value={employee?.phone || ''} readOnly />
            </div>
          </div>
        </div>
      </div>

      {/* Message Templates */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Message Templates ({templates.length})</span>
          <button className="btn btn-secondary btn-sm">+ New Template</button>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {templates.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No templates yet</p>
              <p className="empty-state-text">Create reusable message templates for common replies.</p>
            </div>
          ) : (
            <table>
              <thead><tr><th>Name</th><th>Category</th><th>Preview</th><th>Active</th></tr></thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.title}</td>
                    <td>{t.category || '—'}</td>
                    <td style={{ color: 'var(--text-tertiary)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body}</td>
                    <td>{t.is_active ? 'Yes' : 'No'}</td>
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
