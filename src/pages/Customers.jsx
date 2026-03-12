import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export default function Customers() {
  const { db } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db.select('contacts', 'role=neq.lead&order=name.asc.nullslast&select=id,name,phone,email,role,created_at')
      .then(setContacts)
      .catch(err => console.error('Customers load error:', err))
      .finally(() => setLoading(false));
  }, [db]);

  if (loading) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{contacts.length} contacts</p>
        </div>
        <button className="btn btn-primary">+ Add Contact</button>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {contacts.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state-title">No customers yet</p>
              <p className="empty-state-text">Contacts are auto-created from inbound messages, or add them manually.</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr><th>Name</th><th>Phone</th><th>Email</th><th>Role</th><th>Added</th></tr>
              </thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.name || 'Unknown'}</td>
                    <td>{c.phone || '—'}</td>
                    <td>{c.email || '—'}</td>
                    <td><span className="status-badge status-active">{c.role}</span></td>
                    <td style={{ color: 'var(--text-tertiary)' }}>{new Date(c.created_at).toLocaleDateString()}</td>
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
