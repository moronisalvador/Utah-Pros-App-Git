import { useState, useEffect, useMemo } from 'react';
import DatePicker from '@/components/DatePicker';

const errToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'error' } }));
const okToast = (msg) => window.dispatchEvent(new CustomEvent('upr:toast', { detail: { message: msg, type: 'success' } }));

const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 6; h <= 20; h++) for (let m = 0; m < 60; m += 30) {
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const hr = h % 12 || 12;
    opts.push({ val, label: `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` });
  }
  return opts;
})();

function getInitials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : p[0][0].toUpperCase();
}

// Unified create + edit modal for non-job calendar events.
// Props:
//   - event: existing event object (edit mode) OR null (create mode)
//   - dateKey, prefillTimeStart, prefillTimeEnd: prefill for create mode
//   - db, employees: standard
//   - onClose(): close with no changes
//   - onSaved(dateKey): close after save; parent reloads
//   - onDeleted(): edit-mode only; close after delete
function EventModal({ event, dateKey, prefillTimeStart, prefillTimeEnd, db, employees, onClose, onSaved, onDeleted }) {
  const isEdit = !!event?.id;

  const [title, setTitle] = useState(event?.title || '');
  const [date, setDate] = useState(event?.date || dateKey || '');
  const [timeStart, setTimeStart] = useState(event?.time_start ? event.time_start.slice(0, 5) : (prefillTimeStart || '09:00'));
  const [timeEnd, setTimeEnd] = useState(event?.time_end ? event.time_end.slice(0, 5) : (prefillTimeEnd || '10:00'));
  const [notes, setNotes] = useState(event?.notes || '');
  const [selectedCrew, setSelectedCrew] = useState(() =>
    (event?.crew || []).map(c => ({ employee_id: c.employee_id, role: c.role }))
  );
  const [crewSearch, setCrewSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toggleCrew = (empId) => {
    setSelectedCrew(prev => {
      const exists = prev.find(c => c.employee_id === empId);
      if (exists) return prev.filter(c => c.employee_id !== empId);
      return [...prev, { employee_id: empId, role: prev.length === 0 ? 'lead' : 'tech' }];
    });
  };

  const dateLabel = useMemo(() => {
    if (!date) return '';
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }, [date]);

  const timeInvalid = timeStart && timeEnd && timeEnd <= timeStart;
  const canSave = title.trim() && date && !timeInvalid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      let eventId;

      if (isEdit) {
        // Update core fields via existing update_appointment RPC
        await db.rpc('update_appointment', {
          p_appointment_id: event.id,
          p_date: date,
          p_time_start: timeStart || null,
          p_time_end: timeEnd || null,
          p_title: title.trim(),
          p_type: null,
          p_status: null,
          p_notes: notes.trim() || null,
        });
        eventId = event.id;

        // Reconcile crew: remove all existing, insert current selection.
        // Simple and correct — the crew set is small.
        await db.delete('appointment_crew', `appointment_id=eq.${eventId}`);
      } else {
        // Create new event (kind='event', no job_id)
        const result = await db.insert('appointments', {
          kind: 'event',
          title: title.trim(),
          date,
          time_start: timeStart || null,
          time_end: timeEnd || null,
          type: 'other',
          status: 'scheduled',
          notes: notes.trim() || null,
        });
        eventId = result?.[0]?.id;
        if (!eventId) throw new Error('Failed to create event');
      }

      for (const c of selectedCrew) {
        await db.insert('appointment_crew', {
          appointment_id: eventId,
          employee_id: c.employee_id,
          role: c.role,
        });
      }

      okToast(isEdit ? 'Event updated' : 'Event created');
      onSaved(date);
    } catch (e) {
      console.error('Save event:', e);
      errToast('Failed to save: ' + (e.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setSaving(true);
    try {
      await db.rpc('delete_appointment', { p_appointment_id: event.id });
      okToast('Event deleted');
      onDeleted?.();
    } catch (e) {
      console.error('Delete event:', e);
      errToast('Failed to delete: ' + (e.message || 'unknown error'));
      setSaving(false);
    }
  };

  // Visible crew: selected + search-matching
  const visibleEmployees = employees.filter(emp => {
    if (selectedCrew.find(c => c.employee_id === emp.id)) return true;
    if (!crewSearch.trim()) return true;
    const q = crewSearch.toLowerCase();
    return (emp.display_name || '').toLowerCase().includes(q) ||
           (emp.full_name || '').toLowerCase().includes(q);
  });

  return (
    <div style={M.overlay} onClick={onClose}>
      <div style={M.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={M.header}>
          <div>
            <div style={M.headerTitle}>
              <span style={{ marginRight: 6 }} aria-hidden>📅</span>
              {isEdit ? 'Edit event' : 'New event'}
            </div>
            {date && <div style={M.headerSub}>{dateLabel}</div>}
          </div>
          <button style={M.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={M.body}>
          {/* Title */}
          <div style={M.field}>
            <label style={M.label}>Title</label>
            <input
              style={M.input}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. BNI Meeting, Team training, Caelum leaves at 2pm"
              autoFocus
            />
          </div>

          {/* Date */}
          <div style={M.field}>
            <label style={M.label}>Date</label>
            <DatePicker value={date} onChange={v => setDate(v)} />
          </div>

          {/* Start + End */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>Start</label>
              <select style={M.input} value={timeStart} onChange={e => setTimeStart(e.target.value)}>
                {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ ...M.field, flex: 1 }}>
              <label style={M.label}>End</label>
              <select style={M.input} value={timeEnd} onChange={e => setTimeEnd(e.target.value)}>
                {TIME_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {timeInvalid && (
            <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 500, marginTop: -4, marginBottom: 4 }}>
              End time must be after start time
            </div>
          )}

          {/* Notes */}
          <div style={M.field}>
            <label style={M.label}>Notes <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
            <textarea
              style={{ ...M.input, minHeight: 48, resize: 'vertical' }}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Additional details..."
            />
          </div>

          {/* Crew — optional, can be empty */}
          <div style={M.section}>
            <div style={M.sectionTitle}>
              Assigned to
              {selectedCrew.length > 0
                ? <span style={M.sectionBadge}>{selectedCrew.length}</span>
                : <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— leave empty for company-wide</span>}
            </div>
            <input
              style={{ ...M.input, marginBottom: 8, padding: '6px 10px', fontSize: 12 }}
              placeholder="Search employees..."
              value={crewSearch}
              onChange={e => setCrewSearch(e.target.value)}
            />
            <div style={M.crewGrid}>
              {visibleEmployees.map(emp => {
                const sel = selectedCrew.find(c => c.employee_id === emp.id);
                const initials = getInitials(emp.display_name || emp.full_name);
                return (
                  <button
                    key={emp.id}
                    onClick={() => toggleCrew(emp.id)}
                    style={{
                      ...M.crewChip,
                      background: sel ? 'var(--accent-light)' : 'var(--bg-primary)',
                      borderColor: sel ? 'var(--accent)' : 'var(--border-color)',
                      color: sel ? 'var(--accent)' : 'var(--text-secondary)',
                    }}
                  >
                    <span style={{
                      width: 26, height: 26, borderRadius: 13, flexShrink: 0,
                      background: sel ? (emp.color || 'var(--accent)') : 'var(--bg-tertiary)',
                      color: sel ? '#fff' : 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                    }}>{initials}</span>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>
                      {emp.display_name || emp.full_name}
                    </span>
                    {sel && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 3,
                        background: sel.role === 'lead' ? '#fffbeb' : 'transparent',
                        color: sel.role === 'lead' ? '#92400e' : 'var(--text-tertiary)',
                      }}>{sel.role === 'lead' ? 'LEAD' : 'TECH'}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={M.footer}>
          {isEdit ? (
            <button
              style={{
                ...M.cancelBtn,
                background: deleteConfirm ? '#fef2f2' : 'var(--bg-tertiary)',
                color: deleteConfirm ? '#dc2626' : 'var(--text-secondary)',
                border: `1px solid ${deleteConfirm ? '#fecaca' : 'transparent'}`,
                marginRight: 'auto',
              }}
              onClick={handleDelete}
              onBlur={() => setDeleteConfirm(false)}
              disabled={saving}
            >
              {deleteConfirm ? 'Confirm Delete' : 'Delete'}
            </button>
          ) : null}
          <button style={M.cancelBtn} onClick={onClose} disabled={saving}>Cancel</button>
          <button
            style={{ ...M.saveBtn, opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  );
}

const M = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    zIndex: 1000, paddingTop: 40, overflow: 'auto',
  },
  modal: {
    background: 'var(--bg-primary)', borderRadius: 'var(--radius-xl)',
    width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 80px)',
    display: 'flex', flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '16px 20px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  headerTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' },
  headerSub: { fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 },
  closeBtn: {
    fontSize: 16, color: 'var(--text-tertiary)', background: 'none',
    border: 'none', cursor: 'pointer', padding: 4,
  },
  body: { padding: '16px 20px', overflowY: 'auto', flex: 1 },
  field: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' },
  input: {
    width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--font-sans)',
    color: 'var(--text-primary)', outline: 'none', background: 'var(--bg-primary)',
  },
  section: { marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-light)' },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    color: 'var(--text-tertiary)', marginBottom: 10,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  sectionBadge: {
    fontSize: 11, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
    background: 'var(--accent-light)', color: 'var(--accent)', textTransform: 'none', letterSpacing: 0,
  },
  crewGrid: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  crewChip: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
    borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
    cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'all 100ms ease',
    background: 'var(--bg-primary)',
  },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 8,
    padding: '12px 20px', borderTop: '1px solid var(--border-color)', flexShrink: 0,
  },
  cancelBtn: {
    fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 16px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
  saveBtn: {
    fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--accent)',
    border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 20px', cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
  },
};

export default EventModal;
