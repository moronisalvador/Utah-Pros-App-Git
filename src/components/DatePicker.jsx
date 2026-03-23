import { useState, useRef, useEffect, useCallback } from 'react';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function displayDate(str) {
  if (!str) return '';
  const d = parseDate(str);
  if (!d || isNaN(d)) return str;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ═══════════════════════════════════════════════════════════════

export default function DatePicker({ value, onChange, min, max, placeholder = 'Select date', style, className, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    const d = parseDate(value);
    return d && !isNaN(d) ? d : new Date();
  });
  const wrapRef = useRef(null);
  const calRef = useRef(null);

  // Auto-open on mount if autoFocus
  useEffect(() => {
    if (autoFocus) setOpen(true);
  }, [autoFocus]);

  // Sync viewDate when value changes externally
  useEffect(() => {
    const d = parseDate(value);
    if (d && !isNaN(d)) setViewDate(d);
  }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Position calendar dropdown — flip up if near bottom
  const [flipUp, setFlipUp] = useState(false);
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setFlipUp(spaceBelow < 320);
  }, [open]);

  const handleSelect = useCallback((day) => {
    const selected = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const str = fmt(selected);
    // Respect min/max
    if (min && str < min) return;
    if (max && str > max) return;
    onChange(str);
    setOpen(false);
  }, [viewDate, onChange, min, max]);

  const prevMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => { setViewDate(new Date()); };

  // Build calendar grid
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const selectedDate = parseDate(value);
  const minDate = parseDate(min);
  const maxDate = parseDate(max);

  const weeks = [];
  let week = new Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }} className={className}>
      {/* Trigger input */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
          cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)',
          color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
          minHeight: 36, transition: 'border-color 120ms ease',
          ...(open ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px rgba(37,99,235,0.1)' } : {}),
        }}
      >
        {/* Calendar icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span>{value ? displayDate(value) : placeholder}</span>
      </div>

      {/* Calendar dropdown */}
      {open && (
        <div ref={calRef} style={{
          position: 'absolute', left: 0, zIndex: 50,
          ...(flipUp ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }),
          width: 280, background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}>
          {/* Header: month/year nav */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--border-light)',
          }}>
            <button onClick={prevMonth} style={S.navBtn}>‹</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
                {MONTHS[month]} {year}
              </span>
            </div>
            <button onClick={nextMonth} style={S.navBtn}>›</button>
          </div>

          {/* Weekday headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '6px 8px 2px' }}>
            {DAYS.map(d => (
              <div key={d} style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
                textAlign: 'center', padding: '2px 0', letterSpacing: '0.02em',
              }}>{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div style={{ padding: '2px 8px 8px' }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {week.map((day, di) => {
                  if (!day) return <div key={di} />;

                  const thisDate = new Date(year, month, day);
                  const dateStr = fmt(thisDate);
                  const isToday = isSameDay(thisDate, today);
                  const isSelected = isSameDay(thisDate, selectedDate);
                  const isDisabled = (minDate && dateStr < min) || (maxDate && dateStr > max);

                  return (
                    <div
                      key={di}
                      onClick={() => !isDisabled && handleSelect(day)}
                      style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 34, height: 34, margin: '0 auto',
                        borderRadius: 'var(--radius-full)', cursor: isDisabled ? 'default' : 'pointer',
                        fontSize: 12, fontWeight: isSelected ? 700 : isToday ? 600 : 400,
                        fontFamily: 'var(--font-sans)',
                        color: isDisabled ? 'var(--text-tertiary)' : isSelected ? '#fff' : isToday ? 'var(--accent)' : 'var(--text-primary)',
                        background: isSelected ? 'var(--accent)' : 'transparent',
                        opacity: isDisabled ? 0.4 : 1,
                        transition: 'all 100ms ease',
                      }}
                      onMouseEnter={e => {
                        if (!isDisabled && !isSelected) e.currentTarget.style.background = 'var(--bg-tertiary)';
                      }}
                      onMouseLeave={e => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {day}
                      {/* Today dot */}
                      {isToday && !isSelected && (
                        <span style={{
                          position: 'absolute', bottom: 3, width: 3, height: 3,
                          borderRadius: 2, background: 'var(--accent)',
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Footer: Today + Clear */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 12px', borderTop: '1px solid var(--border-light)',
          }}>
            <button onClick={() => { goToday(); handleSelect(today.getDate()); }}
              style={{ ...S.footBtn, color: 'var(--accent)', fontWeight: 600 }}>
              Today
            </button>
            {value && (
              <button onClick={() => { onChange(''); setOpen(false); }}
                style={{ ...S.footBtn, color: 'var(--text-tertiary)' }}>
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  navBtn: {
    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-primary)', cursor: 'pointer', fontSize: 16,
    color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)',
  },
  footBtn: {
    fontSize: 12, fontWeight: 500, background: 'none', border: 'none',
    cursor: 'pointer', padding: '4px 8px', borderRadius: 'var(--radius-md)',
    fontFamily: 'var(--font-sans)',
  },
};
