import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

const TYPE_BADGE = {
  bug:     { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'Bug' },
  feature: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', label: 'Feature' },
};

const STATUS_BADGE = {
  new:       { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: 'New' },
  reviewed:  { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', label: 'Reviewed' },
  resolved:  { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0', label: 'Resolved' },
  dismissed: { bg: '#f8f9fb', color: '#8b929e', border: '#e2e5e9', label: 'Dismissed' },
};

const STATUSES = ['new', 'reviewed', 'resolved', 'dismissed'];

function Badge({ map, value }) {
  const s = map[value] || map.new;
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '2px 8px',
      borderRadius: 'var(--radius-full)',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

function timeAgo(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
const okToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

export default function AdminFeedback() {
  const { db, employee } = useAuth();
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');       // 'all' | 'bug' | 'feature'
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | status value
  const [expanded, setExpanded] = useState(null);     // expanded row id
  const [updating, setUpdating] = useState(null);     // id being updated
  const [noteText, setNoteText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await db.rpc('get_tech_feedback');
      setFeedbacks(rows || []);
    } catch (e) {
      errToast('Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { load(); }, [load]);

  const handleStatusChange = async (id, newStatus) => {
    setUpdating(id);
    try {
      await db.rpc('update_tech_feedback', {
        p_id: id,
        p_status: newStatus,
        p_admin_notes: noteText.trim() || null,
      });
      okToast(`Marked as ${STATUS_BADGE[newStatus].label}`);
      setNoteText('');
      load();
    } catch (e) {
      errToast('Failed to update: ' + e.message);
    } finally {
      setUpdating(null);
    }
  };

  const filtered = feedbacks.filter(f => {
    if (filter !== 'all' && f.type !== filter) return false;
    if (statusFilter !== 'all' && f.status !== statusFilter) return false;
    return true;
  });

  const counts = {
    all: feedbacks.length,
    bug: feedbacks.filter(f => f.type === 'bug').length,
    feature: feedbacks.filter(f => f.type === 'feature').length,
    new: feedbacks.filter(f => f.status === 'new').length,
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '64px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
        Loading feedback...
      </div>
    );
  }

  return (
    <div className="admin-page" style={{ padding: 'var(--space-6)' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Tech Feedback
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
          Bug reports and feature requests from field technicians
        </p>
      </div>

      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--space-4)',
        alignItems: 'center',
      }}>
        {/* Type filters */}
        {[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'bug', label: 'Bugs', count: counts.bug },
          { key: 'feature', label: 'Features', count: counts.feature },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              height: 32, padding: '0 12px', borderRadius: 'var(--radius-full)',
              border: `1px solid ${filter === f.key ? 'var(--accent)' : 'var(--border-color)'}`,
              background: filter === f.key ? 'var(--accent-light)' : 'var(--bg-primary)',
              color: filter === f.key ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {f.label}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-full)',
              background: filter === f.key ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: filter === f.key ? '#fff' : 'var(--text-tertiary)',
            }}>
              {f.count}
            </span>
          </button>
        ))}

        <div style={{ width: 1, height: 20, background: 'var(--border-color)', margin: '0 4px' }} />

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            height: 32, padding: '0 28px 0 10px', borderRadius: 'var(--radius-full)',
            border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
            color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
            fontFamily: 'var(--font-sans)', cursor: 'pointer',
            appearance: 'none',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%235f6672' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          <option value="all">All statuses</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_BADGE[s].label}</option>
          ))}
        </select>

        {counts.new > 0 && (
          <span style={{
            fontSize: 12, fontWeight: 700, color: '#d97706', marginLeft: 'auto',
          }}>
            {counts.new} new
          </span>
        )}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '48px 16px', color: 'var(--text-tertiary)',
          fontSize: 13, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
        }}>
          No feedback items match the current filters.
        </div>
      ) : (
        <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          {/* Desktop table header */}
          <div className="admin-feedback-header" style={{
            display: 'grid', gridTemplateColumns: '100px 1fr 120px 90px 100px',
            padding: '8px 16px', background: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            <span>Type</span>
            <span>Title</span>
            <span>Submitted By</span>
            <span>Status</span>
            <span>When</span>
          </div>

          {/* Rows */}
          {filtered.map((item, idx) => {
            const isExpanded = expanded === item.id;
            const screenshots = Array.isArray(item.screenshots) ? item.screenshots : [];
            return (
              <div key={item.id}>
                {/* Row */}
                <div
                  className="fb-row"
                  onClick={() => setExpanded(isExpanded ? null : item.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: '100px 1fr 120px 90px 100px',
                    alignItems: 'center', padding: '12px 16px',
                    borderBottom: (idx < filtered.length - 1 || isExpanded) ? '1px solid var(--border-light)' : 'none',
                    background: isExpanded ? 'var(--bg-secondary)' : 'var(--bg-primary)',
                    cursor: 'pointer', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-primary)'; }}
                >
                  <span><Badge map={TYPE_BADGE} value={item.type} /></span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 12 }}>
                    {item.title}
                  </span>
                  <span className="fb-hide-mobile" style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.employee_name}
                  </span>
                  <span><Badge map={STATUS_BADGE} value={item.status} /></span>
                  <span className="fb-hide-mobile" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {timeAgo(item.created_at)}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{
                    padding: '16px 20px 20px',
                    background: 'var(--bg-secondary)',
                    borderBottom: idx < filtered.length - 1 ? '1px solid var(--border-color)' : 'none',
                  }}>
                    <div className="fb-detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24 }}>
                      {/* Left: details */}
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                          Description
                        </div>
                        <div style={{
                          fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6,
                          padding: '10px 14px', background: 'var(--bg-primary)',
                          borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                          minHeight: 48, whiteSpace: 'pre-wrap',
                        }}>
                          {item.description || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No description provided</span>}
                        </div>

                        {/* Screenshots */}
                        {screenshots.length > 0 && (
                          <div style={{ marginTop: 16 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                              Screenshots ({screenshots.length})
                            </div>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              {screenshots.map((path, i) => (
                                <a
                                  key={i}
                                  href={`${db.baseUrl}/storage/v1/object/public/${path}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    width: 120, height: 120, borderRadius: 'var(--radius-md)',
                                    overflow: 'hidden', border: '1px solid var(--border-color)',
                                    display: 'block', flexShrink: 0,
                                  }}
                                >
                                  <img
                                    src={`${db.baseUrl}/storage/v1/object/public/${path}`}
                                    alt={`Screenshot ${i + 1}`}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 12 }}>
                          Submitted {formatDate(item.created_at)} by {item.employee_name}
                        </div>
                      </div>

                      {/* Right: admin actions */}
                      <div style={{
                        padding: '14px 16px', background: 'var(--bg-primary)',
                        borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                        alignSelf: 'start',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                          Update Status
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                          {STATUSES.map(s => (
                            <button
                              key={s}
                              disabled={updating === item.id}
                              onClick={(e) => { e.stopPropagation(); handleStatusChange(item.id, s); }}
                              style={{
                                height: 30, padding: '0 12px', borderRadius: 'var(--radius-full)',
                                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                fontFamily: 'var(--font-sans)',
                                border: `1px solid ${item.status === s ? STATUS_BADGE[s].border : 'var(--border-color)'}`,
                                background: item.status === s ? STATUS_BADGE[s].bg : 'var(--bg-primary)',
                                color: item.status === s ? STATUS_BADGE[s].color : 'var(--text-secondary)',
                                opacity: updating === item.id ? 0.5 : 1,
                              }}
                            >
                              {STATUS_BADGE[s].label}
                            </button>
                          ))}
                        </div>

                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                          Admin Notes
                        </div>
                        <textarea
                          value={item.admin_notes || noteText}
                          onChange={e => {
                            setNoteText(e.target.value);
                            // Also update local state for display
                            setFeedbacks(prev => prev.map(f =>
                              f.id === item.id ? { ...f, admin_notes: e.target.value } : f
                            ));
                          }}
                          onClick={e => e.stopPropagation()}
                          placeholder="Add a note..."
                          rows={3}
                          style={{
                            width: '100%', padding: '8px 10px', fontSize: 12,
                            borderRadius: 'var(--radius-md)', resize: 'vertical',
                            border: '1px solid var(--border-color)', background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)', fontFamily: 'var(--font-sans)',
                            outline: 'none', boxSizing: 'border-box', lineHeight: 1.5,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .admin-feedback-header { display: none !important; }
          .fb-row { grid-template-columns: auto 1fr auto !important; gap: 8px; }
          .fb-hide-mobile { display: none !important; }
          .fb-detail-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
