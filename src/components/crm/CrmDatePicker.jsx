/**
 * ════════════════════════════════════════════════
 * FILE: CrmDatePicker.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A calendar date-picker styled to match the CRM (Public Sans, --crm-*
 *   tokens, the same popover look as the filter bar) instead of the ugly
 *   browser-native date picker that `<input type="date">` shows. Click the
 *   trigger, a small calendar drops down, click a day to pick it.
 *
 * WHERE IT LIVES:
 *   Shared component — no route. Rendered by src/pages/crm/CrmLeads.jsx and
 *   src/pages/crm/CrmTasks.jsx wherever a plain `<input type="date">` used
 *   to sit.
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *
 * NOTES / GOTCHAS:
 *   - Value/onChange use the exact same 'YYYY-MM-DD' string `<input
 *     type="date">` already used — a drop-in replacement, no caller-side
 *     format changes needed.
 *   - `compact` renders an icon-only trigger (for a tight inline row, e.g. a
 *     quick-add composer); the default renders a full pill (icon + text)
 *     matching `.crm-input`'s height, for a labeled form field.
 *   - Reuses the existing `.crm-leads-popover`/`.crm-leads-popover-backdrop`
 *     dropdown classes (already shipped for the filter bar) rather than a
 *     new visual pattern — one popover language across the CRM.
 * ════════════════════════════════════════════════
 */
import { useState, useRef, useCallback } from 'react';
import { IconButton } from '@/components/ui';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function parseDate(str) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isSameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function displayDate(str) {
  const d = parseDate(str);
  if (!d) return str || '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function IconCalendarSm() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export default function CrmDatePicker({ value, onChange, min, max, placeholder = 'Select date', compact, className, autoFocus, 'aria-label': ariaLabel }) {
  const [open, setOpenRaw] = useState(Boolean(autoFocus));
  const [viewDate, setViewDate] = useState(() => parseDate(value) || new Date());
  const wrapRef = useRef(null);

  // Jump the calendar to whatever month `value` is in each time it opens —
  // this is a response to the open action, not a value sync effect (a
  // setState-in-effect anti-pattern the base DatePicker.jsx has; fixed here).
  const setOpen = useCallback((next) => {
    setOpenRaw((prevOpen) => {
      const wantOpen = typeof next === 'function' ? next(prevOpen) : next;
      if (wantOpen && !prevOpen) setViewDate(parseDate(value) || new Date());
      return wantOpen;
    });
  }, [value]);

  const handleSelect = useCallback((day) => {
    const selected = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
    const str = fmt(selected);
    if (min && str < min) return;
    if (max && str > max) return;
    onChange(str);
    setOpen(false);
  }, [viewDate, onChange, min, max, setOpen]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const selectedDate = parseDate(value);

  const weeks = [];
  let week = new Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }

  return (
    <div ref={wrapRef} className={`crm-datepicker-wrap${className ? ` ${className}` : ''}`}>
      {compact ? (
        <IconButton
          label={ariaLabel || (value ? `${displayDate(value)} — click to change` : placeholder)}
          size="sm"
          className={`crm-task-date-toggle${value ? ' active' : ''}`}
          onClick={() => setOpen(v => !v)}
        >
          <IconCalendarSm />
        </IconButton>
      ) : (
        <button type="button" className="crm-input crm-datepicker-trigger" aria-label={ariaLabel} onClick={() => setOpen(v => !v)}>
          <IconCalendarSm />
          <span className={value ? '' : 'crm-datepicker-placeholder'}>{value ? displayDate(value) : placeholder}</span>
        </button>
      )}

      {open && (
        <>
          <div className="crm-leads-popover-backdrop" onClick={() => setOpen(false)} />
          <div className="crm-leads-popover crm-datepicker-cal">
            <div className="crm-datepicker-cal-header">
              <button type="button" className="crm-datepicker-nav" onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
              <span>{MONTHS[month]} {year}</span>
              <button type="button" className="crm-datepicker-nav" onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
            </div>
            <div className="crm-datepicker-dow">
              {DAYS.map(d => <span key={d}>{d}</span>)}
            </div>
            {weeks.map((w, wi) => (
              <div className="crm-datepicker-week" key={wi}>
                {w.map((day, di) => {
                  if (!day) return <span key={di} />;
                  const thisDate = new Date(year, month, day);
                  const dateStr = fmt(thisDate);
                  const disabled = (min && dateStr < min) || (max && dateStr > max);
                  return (
                    <button
                      type="button"
                      key={di}
                      disabled={disabled}
                      className={`crm-datepicker-day${isSameDay(thisDate, selectedDate) ? ' selected' : ''}${isSameDay(thisDate, today) ? ' today' : ''}`}
                      onClick={() => handleSelect(day)}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="crm-datepicker-footer">
              <button type="button" className="crm-transcript-toggle" onClick={() => { setViewDate(new Date()); handleSelect(new Date().getDate()); }}>Today</button>
              {value && <button type="button" className="crm-transcript-toggle" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
