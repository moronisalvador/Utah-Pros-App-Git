import { useState, useRef, useEffect, useCallback } from 'react';
import { currentLocaleTag } from '@/lib/techDateUtils';

// PICK-01. These were hardcoded English arrays and a hardcoded 'en-US' display
// format, so the calendar stayed English for Spanish- and Portuguese-speaking
// technicians even with the rest of the app translated. Derived from the active
// locale instead — Intl already knows every name, so there is nothing to
// translate by hand and nothing to keep in sync across three locale files.
//
// A fixed reference week/year is used purely as a vehicle for the names; only
// the weekday and month labels are read off it, never a date.
function weekdayLabels(locale) {
  // timeZone:'UTC' is REQUIRED, not decorative. Intl formats in the device's
  // zone by default, so a UTC-constructed Sunday renders as the previous
  // Saturday anywhere west of Greenwich — shifting every column heading by one,
  // which is worse than leaving them in English.
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  // 2026-02-01 is a Sunday, matching this calendar's Sunday-first grid.
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2026, 1, 1 + i))).replace(/\.$/, ''));
}

/**
 * PICK-05: a bare "14" tells a screen-reader user nothing about which month or
 * year they are in. Intl gives the full date in the active language for free.
 */
function dayAriaLabel(date, locale) {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(date);
  } catch {
    return String(date.getDate());
  }
}

/** PICK-05: names the destination month, so the control says where it goes. */
function monthNavLabel(viewDate, delta, locale) {
  try {
    const target = new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1);
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(target);
  } catch {
    return delta < 0 ? 'Previous month' : 'Next month';
  }
}

function monthLabels(locale) {
  // Same reason, plus day 15 keeps any offset far from a month boundary.
  const fmt = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2026, i, 15))));
}

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
  return d.toLocaleDateString(currentLocaleTag(), { month: 'short', day: 'numeric', year: 'numeric' });
}

// ═══════════════════════════════════════════════════════════════

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Select date',
  style,
  triggerStyle,
  className,
  autoFocus,
  ariaLabel = 'Choose date',
  // Optional id of a visible text node naming this control. When the host
  // renders visible label text (which a <label> cannot associate with a
  // composite widget), passing its id here keeps that text the accessible
  // name's single source of truth instead of a separately-typed string.
  ariaLabelledBy,
  disabled = false,
}) {
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
  // PICK-02. Today must commit the REAL today, never route through
  // handleSelect. `setViewDate` only queues state, so handleSelect ran against
  // the stale closure and browsing to March then tapping Today committed March.
  // Two further failures came free with that path: a stale short month rolled
  // over (viewDate February + day 30 -> `new Date(y,1,30)` = March 2), and a
  // min/max violation made Today a silent no-op while the view still jumped.
  const goToday = () => {
    const now = new Date();
    const str = fmt(now);
    setViewDate(now);
    // Respect the same bounds handleSelect does — but decide on the real date.
    if (min && str < min) return;
    if (max && str > max) return;
    onChange(str);
    setOpen(false);
  };

  // Build calendar grid
  // Read the locale at render, not at module load: the language can change
  // without a reload (LanguageContext), and module-level arrays would freeze
  // whichever locale happened to be active when the chunk first evaluated.
  const locale = currentLocaleTag();
  const DAYS = weekdayLabels(locale);
  const MONTHS = monthLabels(locale);

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
      <button
        type="button"
        className="upr-date-picker-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)',
          cursor: disabled ? 'default' : 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)',
          color: value ? 'var(--text-primary)' : 'var(--text-tertiary)',
          width: '100%', textAlign: 'left', boxSizing: 'border-box',
          // PICK-05: 36 -> 48, the tech-mobile-ux.md primary floor. This is the
          // control a technician taps first, with gloves on.
          minHeight: 48,
          opacity: disabled ? 0.55 : 1,
          // Host surfaces may opt into their documented control size while the
          // shared default remains the 48px technician-primary floor.
          ...triggerStyle,
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
      </button>

      {/* Calendar dropdown */}
      {open && (
        <div ref={calRef} role="dialog" aria-label={`${ariaLabel} calendar`} style={{
          position: 'absolute', left: 0, zIndex: 50,
          ...(flipUp ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }),
          // PICK-05: widened from 280 so seven day cells can each carry a 44px
          // hit area (7x44 = 308, plus 8px padding a side). At 280 the columns
          // were ~38px, below the tech-mobile-ux.md floor for gloved hands.
          width: 328, background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
        }}>
          {/* Header: month/year nav */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderBottom: '1px solid var(--border-light)',
          }}>
            {/* PICK-05: the glyphs are decorative; without labels these
                announce as "button" twice. */}
            <button type="button" onClick={prevMonth} style={S.navBtn}
              aria-label={monthNavLabel(viewDate, -1, locale)}>
              <span aria-hidden="true">‹</span>
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
                {MONTHS[month]} {year}
              </span>
            </div>
            <button type="button" onClick={nextMonth} style={S.navBtn}
              aria-label={monthNavLabel(viewDate, 1, locale)}>
              <span aria-hidden="true">›</span>
            </button>
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
                    // PICK-05: a real <button>, not a click-div. The 44px hit
                    // area is the button; the 34px circle stays the visual, so
                    // the calendar looks the same but is reachable with gloves.
                    // tech-mobile-ux.md bans hit areas under 24px regardless of
                    // visual size — these were 34.
                    <button
                      key={di}
                      type="button"
                      disabled={isDisabled}
                      aria-label={dayAriaLabel(thisDate, locale)}
                      aria-current={isToday ? 'date' : undefined}
                      aria-pressed={isSelected}
                      onClick={() => !isDisabled && handleSelect(day)}
                      style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 44, height: 44, margin: '0 auto', padding: 0,
                        border: 'none', background: 'transparent',
                        borderRadius: 'var(--radius-full)', cursor: isDisabled ? 'default' : 'pointer',
                        fontSize: 12, fontWeight: isSelected ? 700 : isToday ? 600 : 400,
                        fontFamily: 'var(--font-sans)',
                        color: isDisabled ? 'var(--text-tertiary)' : isSelected ? '#fff' : isToday ? 'var(--accent)' : 'var(--text-primary)',
                        opacity: isDisabled ? 0.4 : 1,
                        WebkitTapHighlightColor: 'transparent',
                      }}
                    >
                      {/* The visual circle, sized independently of the target. */}
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute', width: 34, height: 34,
                          borderRadius: 'var(--radius-full)',
                          // No transition: an inline style cannot carry the
                          // mandatory prefers-reduced-motion fallback
                          // (motion-standard.md §5), and day selection during
                          // keyboard navigation is high-frequency — instant is
                          // the correct tier anyway.
                          background: isSelected ? 'var(--accent)' : 'transparent',
                        }}
                      />
                      <span style={{ position: 'relative' }}>{day}</span>
                      {/* Today dot */}
                      {isToday && !isSelected && (
                        <span aria-hidden="true" style={{
                          position: 'absolute', bottom: 6, width: 3, height: 3,
                          borderRadius: 2, background: 'var(--accent)',
                        }} />
                      )}
                    </button>
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
            <button type="button" onClick={goToday}
              style={{ ...S.footBtn, color: 'var(--accent)', fontWeight: 600 }}>
              Today
            </button>
            {value && (
              <button type="button" onClick={() => { onChange(''); setOpen(false); }}
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
    // PICK-05: 28 -> 44. Month nav is a documented-secondary control.
    width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
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
