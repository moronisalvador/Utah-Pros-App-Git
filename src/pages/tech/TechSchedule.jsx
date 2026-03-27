import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import PullToRefresh from '@/components/PullToRefresh';

const toast = (message, type = 'success') =>
  window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message, type } }));

const STATUS_COLORS = {
  scheduled:   { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  confirmed:   { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  en_route:    { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  in_progress: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  paused:      { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  completed:   { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  cancelled:   { bg: '#f1f3f5', color: '#6b7280', border: '#e2e5e9' },
};

const DIV_COLORS = {
  water: { bg: '#dbeafe', color: '#1e40af' },
  mold: { bg: '#fce7f3', color: '#9d174d' },
  reconstruction: { bg: '#fef3c7', color: '#92400e' },
  fire: { bg: '#fee2e2', color: '#b91c1c' },
  contents: { bg: '#d1fae5', color: '#065f46' },
};

export default function TechSchedule() {
  const { employee, db } = useAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date().toISOString().split('T')[0];
      const end = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const result = await db.rpc('get_appointments_range', {
        p_start_date: start,
        p_end_date: end,
      });
      // Filter to only this employee's appointments
      const mine = (result || []).filter(a =>
        a.appointment_crew?.some(c => c.employee_id === employee.id)
      );
      setAppointments(mine);
    } catch (e) {
      toast('Failed to load schedule', 'error');
    }
    setLoading(false);
  }, [db, employee.id]);

  useEffect(() => { load(); }, [load]);

  // Group by date
  const grouped = {};
  appointments.forEach(a => {
    const d = a.date;
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(a);
  });
  const sortedDates = Object.keys(grouped).sort();

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const formatDateHeader = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    const day = d.getDate();
    if (dateStr === today) return `Today — ${weekday} ${month} ${day}`;
    if (dateStr === tomorrow) return `Tomorrow — ${weekday} ${month} ${day}`;
    return `${weekday} ${month} ${day}`;
  };

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  if (loading) {
    return <div className="tech-page"><div className="loading-page"><div className="spinner" /></div></div>;
  }

  return (
    <div className="tech-page" style={{ padding: 0 }}>
      <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
        <div className="tech-page-header">
          <div className="tech-page-title">Schedule</div>
          <div className="tech-page-subtitle">Next 14 days</div>
        </div>
      </div>

      <PullToRefresh onRefresh={load} style={{ flex: 1 }}>
        {sortedDates.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div className="empty-state-text">No upcoming appointments</div>
          </div>
        ) : (
          sortedDates.map(dateStr => (
            <div key={dateStr}>
              {/* Sticky date header */}
              <div style={{
                position: 'sticky', top: 0, zIndex: 5,
                padding: '8px var(--space-4)',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-light)',
                fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
                letterSpacing: '0.02em',
              }}>
                {formatDateHeader(dateStr)}
              </div>

              {grouped[dateStr].map(appt => {
                const job = appt.jobs;
                const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
                const sc = STATUS_COLORS[appt.status] || STATUS_COLORS.scheduled;
                const dc = job?.division ? DIV_COLORS[job.division] : null;
                const isToday = dateStr === today;

                return (
                  <div
                    key={appt.id}
                    onClick={() => navigate(`/tech/appointment/${appt.id}`)}
                    style={{
                      padding: '12px var(--space-4)',
                      borderBottom: '1px solid var(--border-light)',
                      background: 'var(--bg-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {formatTime(appt.time_start)}
                        {appt.time_end ? ` – ${formatTime(appt.time_end)}` : ''}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '1px 6px',
                        borderRadius: 'var(--radius-full)',
                        background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                      }}>
                        {(appt.status || 'scheduled').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                      {appt.title || 'Appointment'}
                    </div>
                    {address && (
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>{address}</div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      {dc && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px',
                          borderRadius: 'var(--radius-full)', background: dc.bg, color: dc.color,
                        }}>
                          {job.division}
                        </span>
                      )}
                      {job?.job_number && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          {job.job_number}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </PullToRefresh>
    </div>
  );
}
