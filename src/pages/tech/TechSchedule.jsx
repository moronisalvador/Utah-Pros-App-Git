import { useState, useEffect, useCallback, useRef } from 'react';
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

const DIV_BORDER_COLORS = {
  water: '#3b82f6',
  mold: '#ec4899',
  reconstruction: '#f59e0b',
  fire: '#ef4444',
  contents: '#10b981',
};

const TYPE_CONFIG = {
  monitoring:       { label: 'Monitoring',   color: '#3b82f6', bg: '#eff6ff',  icon: '\u{1F4E1}' },
  mitigation:       { label: 'Mitigation',   color: '#0ea5e9', bg: '#f0f9ff',  icon: '\u{1F4A7}' },
  inspection:       { label: 'Inspection',   color: '#8b5cf6', bg: '#f5f3ff',  icon: '\u{1F50D}' },
  reconstruction:   { label: 'Recon',        color: '#f59e0b', bg: '#fffbeb',  icon: '\u{1F528}' },
  estimate:         { label: 'Estimate',     color: '#10b981', bg: '#ecfdf5',  icon: '\u{1F4CB}' },
  mold_remediation: { label: 'Mold Remed.',  color: '#059669', bg: '#ecfdf5',  icon: '\u{1F33F}' },
  other:            { label: 'Other',        color: '#6b7280', bg: '#f3f4f6',  icon: '\u{1F4CC}' },
};

export default function TechSchedule() {
  const { employee, db } = useAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showJumpBtn, setShowJumpBtn] = useState(false);
  const todayRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date().toISOString().split('T')[0];
      const end = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
      const result = await db.rpc('get_appointments_range', {
        p_start_date: start,
        p_end_date: end,
      });
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

  const handleScroll = useCallback(() => {
    if (!todayRef.current) return;
    const rect = todayRef.current.getBoundingClientRect();
    setShowJumpBtn(rect.bottom < 0);
  }, []);

  const scrollToToday = () => {
    todayRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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
    if (dateStr === today) return `Today \u2014 ${weekday} ${month} ${day}`;
    if (dateStr === tomorrow) return `Tomorrow \u2014 ${weekday} ${month} ${day}`;
    return `${weekday} ${month} ${day}`;
  };

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const formatDuration = (start, end) => {
    if (!start || !end) return '';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) return '';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const rm = mins % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
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

      <PullToRefresh onRefresh={load} style={{ flex: 1 }} onScroll={handleScroll}>
        {sortedDates.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 60 }}>
            <div className="empty-state-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
                <polyline points="9 16 11 18 15 14" strokeWidth="2"/>
              </svg>
            </div>
            <div className="empty-state-text">You're all clear for the next 2 weeks</div>
            <div className="empty-state-sub" style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
              No upcoming appointments scheduled
            </div>
          </div>
        ) : (
          sortedDates.map(dateStr => {
            const isToday = dateStr === today;
            const isTomorrow = dateStr === tomorrow;

            return (
              <div key={dateStr} ref={isToday ? todayRef : undefined}>
                {/* Date header */}
                <div style={{
                  position: 'sticky', top: 0, zIndex: 5,
                  padding: '8px var(--space-4)',
                  background: isToday ? 'var(--accent-light)' : 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--border-light)',
                  fontSize: isToday ? 14 : 14,
                  fontWeight: 700,
                  color: isToday ? 'var(--accent)' : (isTomorrow ? 'var(--text-primary)' : 'var(--text-secondary)'),
                  letterSpacing: '0.02em',
                }}>
                  {formatDateHeader(dateStr)}
                </div>

                {grouped[dateStr].map(appt => {
                  const job = appt.jobs;
                  const address = job ? [job.address, job.city].filter(Boolean).join(', ') : '';
                  const sc = STATUS_COLORS[appt.status] || STATUS_COLORS.scheduled;
                  const tc = TYPE_CONFIG[appt.type] || TYPE_CONFIG.other;
                  const divBorder = job?.division ? DIV_BORDER_COLORS[job.division] || 'var(--border-color)' : 'var(--border-color)';
                  const duration = formatDuration(appt.time_start, appt.time_end);

                  return (
                    <div
                      key={appt.id}
                      className="tech-schedule-row"
                      data-division={job?.division || ''}
                      onClick={() => navigate(`/tech/appointment/${appt.id}`)}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        padding: '14px var(--space-4)',
                        borderBottom: '1px solid var(--border-light)',
                        background: 'var(--bg-primary)',
                        cursor: 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                        borderLeft: `4px solid ${divBorder}`,
                        minHeight: 72,
                      }}
                    >
                      {/* Time column */}
                      <div style={{ width: 70, flexShrink: 0, paddingRight: 12 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {formatTime(appt.time_start)}
                        </div>
                        {duration && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            {duration}
                          </div>
                        )}
                      </div>

                      {/* Divider line */}
                      <div style={{
                        width: 2, alignSelf: 'stretch', flexShrink: 0, marginRight: 12,
                        background: divBorder, borderRadius: 1, opacity: 0.4,
                      }} />

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {job?.insured_name ? (
                          <>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {job.insured_name}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 2,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {appt.title || 'Appointment'}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                            {appt.title || 'Appointment'}
                          </div>
                        )}
                        {address && (
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {address}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {appt.type && (
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '2px 8px',
                              borderRadius: 'var(--radius-full)',
                              background: tc.bg, color: tc.color,
                            }}>
                              {tc.icon} {tc.label}
                            </span>
                          )}
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '2px 8px',
                            borderRadius: 'var(--radius-full)',
                            background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                          }}>
                            {(appt.status || 'scheduled').replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </PullToRefresh>

      {/* Jump-to-today FAB */}
      {showJumpBtn && (
        <button className="tech-jump-today-fab" onClick={scrollToToday}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginRight: 6 }}>
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
          Today
        </button>
      )}
    </div>
  );
}
