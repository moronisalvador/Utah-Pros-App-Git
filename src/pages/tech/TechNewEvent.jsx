import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toast';
import DatePicker from '@/components/DatePicker';
import { inputStyle, labelStyle, TIME_OPTIONS, getInitials } from './techFormConstants';

// Mobile full-page "New Event" — the tech-side counterpart to the desktop
// EventModal. Creates an appointments row with kind='event' and no job_id.
// Keep this form intentionally thin: title, date, start/end, notes, and
// one-or-more crew. No job picker, no tasks, no division. Leaving crew
// empty makes it a company-wide block (visible to all on the board).
export default function TechNewEvent() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { db, employee } = useAuth();

  const initialDate = searchParams.get('date') || new Date().toISOString().split('T')[0];

  const canTogglePrivate = ['admin', 'project_manager'].includes(employee?.role);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [timeStart, setTimeStart] = useState('09:00');
  const [timeEnd, setTimeEnd] = useState('10:00');
  const [notes, setNotes] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState(() =>
    employee?.id ? [{ employee_id: employee.id, role: 'lead' }] : []
  );
  const [employees, setEmployees] = useState([]);
  const [crewSearch, setCrewSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    db.select('employees', 'is_active=eq.true&order=full_name.asc&select=id,full_name,display_name,role,color')
      .then(e => setEmployees(e || []))
      .catch(() => {});
  }, [db]);

  const toggleCrew = (empId) => {
    setSelectedCrew(prev => {
      const exists = prev.find(c => c.employee_id === empId);
      if (exists) return prev.filter(c => c.employee_id !== empId);
      return [...prev, { employee_id: empId, role: prev.length === 0 ? 'lead' : 'tech' }];
    });
  };

  const timeInvalid = timeStart && timeEnd && timeEnd <= timeStart;
  const canSubmit = title.trim() && date && !timeInvalid;

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      const result = await db.insert('appointments', {
        kind: 'event',
        title: title.trim(),
        date,
        time_start: timeStart || null,
        time_end: timeEnd || null,
        type: 'other',
        status: 'scheduled',
        notes: notes.trim() || null,
        ...(canTogglePrivate && isPrivate ? { is_private: true } : {}),
      });
      const eventId = result?.[0]?.id;
      if (!eventId) throw new Error('Failed to create event');

      for (const c of selectedCrew) {
        await db.insert('appointment_crew', {
          appointment_id: eventId,
          employee_id: c.employee_id,
          role: c.role,
        });
      }

      toast('Event created');
      navigate(-1);
    } catch (err) {
      toast('Failed to create event: ' + (err.message || ''), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Visible crew = selected (always) + search matches
  const visibleEmployees = useMemo(() => employees.filter(emp => {
    if (selectedCrew.find(c => c.employee_id === emp.id)) return true;
    if (!crewSearch.trim()) return true;
    const q = crewSearch.toLowerCase();
    return (emp.display_name || '').toLowerCase().includes(q) ||
           (emp.full_name || '').toLowerCase().includes(q);
  }), [employees, selectedCrew, crewSearch]);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-primary)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            width: 48, height: 48, borderRadius: 'var(--tech-radius-button)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-tertiary)', border: 'none', cursor: 'pointer',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{ fontSize: 'var(--tech-text-heading)', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden>📅</span> New Event
        </span>
      </div>

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 100 }}>

        {/* Title */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Title <span style={{ color: '#ef4444' }}>*</span></div>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="BNI Meeting, PTO, Team training..."
            autoFocus
            style={inputStyle}
          />
        </div>

        {/* Date */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Date <span style={{ color: '#ef4444' }}>*</span></div>
          <DatePicker value={date} onChange={setDate} />
        </div>

        {/* Time */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>Time</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              value={timeStart}
              onChange={e => setTimeStart(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            >
              {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
            <select
              value={timeEnd}
              onChange={e => setTimeEnd(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            >
              {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
            </select>
          </div>
          {timeInvalid && (
            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6, fontWeight: 500 }}>
              End time must be after start time
            </div>
          )}
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 20 }}>
          <div style={labelStyle}>
            Notes <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span>
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Additional details..."
            style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
          />
        </div>

        {/* Private — admin/PM only */}
        {canTogglePrivate && (
          <div style={{ marginBottom: 20, padding: '12px 14px', background: isPrivate ? '#fef3c7' : 'var(--bg-secondary)', border: `1px solid ${isPrivate ? '#fde68a' : 'var(--border-light)'}`, borderRadius: 'var(--tech-radius-button)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 'var(--tech-min-tap)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
              <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)}
                style={{ marginTop: 4, width: 20, height: 20, cursor: 'pointer', accentColor: '#d97706', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Private
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.4 }}>
                  Only admins, project managers, and assigned crew will see this event.
                </div>
              </span>
            </label>
          </div>
        )}

        {/* Crew */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              Assigned to
              {selectedCrew.length > 0 && (
                <span style={{
                  marginLeft: 8, fontSize: 12, fontWeight: 600, padding: '1px 7px',
                  borderRadius: 99, background: 'var(--accent-light)', color: 'var(--accent)',
                }}>{selectedCrew.length}</span>
              )}
            </span>
            {selectedCrew.length === 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400 }}>
                leave empty for company-wide
              </span>
            )}
          </div>
          <input
            type="text"
            value={crewSearch}
            onChange={e => setCrewSearch(e.target.value)}
            placeholder="Search employees..."
            style={{ ...inputStyle, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {visibleEmployees.map(emp => {
              const sel = selectedCrew.find(c => c.employee_id === emp.id);
              const initials = getInitials(emp.display_name || emp.full_name);
              return (
                <button
                  key={emp.id}
                  onClick={() => toggleCrew(emp.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 14px', minHeight: 'var(--tech-min-tap)',
                    borderRadius: 'var(--tech-radius-button)',
                    border: sel ? `2px solid ${emp.color || 'var(--accent)'}` : '1px solid var(--border-color)',
                    background: sel ? 'var(--accent-light)' : 'var(--bg-primary)',
                    color: sel ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer', fontFamily: 'var(--font-sans)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{
                    width: 28, height: 28, borderRadius: 14, flexShrink: 0,
                    background: sel ? (emp.color || 'var(--accent)') : 'var(--bg-tertiary)',
                    color: sel ? '#fff' : 'var(--text-secondary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>{initials}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {emp.display_name || emp.full_name}
                  </span>
                  {sel?.role === 'lead' && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '0 5px', borderRadius: 3,
                      background: '#fffbeb', color: '#92400e',
                    }}>LEAD</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sticky save button */}
      <div style={{
        position: 'sticky', bottom: 0,
        padding: `16px 16px calc(16px + env(safe-area-inset-bottom, 0px))`,
        borderTop: '1px solid var(--border-light)',
        background: 'var(--bg-primary)',
      }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || saving}
          style={{
            width: '100%', height: 52, borderRadius: 'var(--tech-radius-button)',
            background: 'var(--accent)', color: '#fff', border: 'none',
            fontSize: 16, fontWeight: 700, cursor: canSubmit && !saving ? 'pointer' : 'not-allowed',
            opacity: canSubmit && !saving ? 1 : 0.5, fontFamily: 'var(--font-sans)',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {saving ? 'Creating...' : 'Create event'}
        </button>
      </div>
    </div>
  );
}
