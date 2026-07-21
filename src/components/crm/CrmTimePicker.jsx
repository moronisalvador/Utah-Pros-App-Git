/**
 * ════════════════════════════════════════════════
 * FILE: CrmTimePicker.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A dropdown list of times (every 15 minutes, all day) styled to match the
 *   CRM, instead of the ugly browser-native time picker `<input type="time">`
 *   shows. Click the trigger, scroll to a time, click it. There's no custom
 *   time picker anywhere else in the app yet — this is the first one.
 *
 * WHERE IT LIVES:
 *   Shared component — no route. Rendered by src/pages/crm/CrmTasks.jsx
 *   (paired with CrmDatePicker to replace a `datetime-local` field).
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  none
 *
 * NOTES / GOTCHAS:
 *   - Value/onChange use 'HH:mm' (24-hour), the exact time portion
 *     `<input type="time">` already used — a drop-in replacement.
 *   - On open, auto-scrolls the list to the selected time (or to 9:00 AM if
 *     nothing's picked yet) so the user isn't dropped at midnight.
 * ════════════════════════════════════════════════
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { IconButton } from '@/components/ui';

// Every 15 minutes, 12:00 AM through 11:45 PM.
const TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

function displayTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function IconClockSm() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

// Popover's own footprint — kept in sync with .crm-timepicker-pop's CSS
// width/max-height so the overflow check doesn't need a post-paint measure.
const POP_WIDTH = 160;
const POP_HEIGHT = 260;

export default function CrmTimePicker({ value, onChange, placeholder = 'Select time', compact, className, 'aria-label': ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const selectedRef = useRef(null);

  // Flip left/up if the popover would render off-screen — measured on the
  // open action itself, not a value-sync effect.
  const toggleOpen = useCallback(() => {
    setOpen((prevOpen) => {
      const wantOpen = !prevOpen;
      if (wantOpen) {
        const rect = wrapRef.current?.getBoundingClientRect();
        if (rect) {
          setFlipX(rect.left + POP_WIDTH > window.innerWidth);
          setFlipY(rect.bottom + POP_HEIGHT > window.innerHeight);
        }
      }
      return wantOpen;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Scroll the selected (or a sensible default) time into view without an
    // animated jump — this is a fresh open, not a user-driven scroll.
    const el = selectedRef.current;
    if (el && listRef.current) listRef.current.scrollTop = el.offsetTop - listRef.current.offsetTop - 40;
  }, [open]);

  const select = useCallback((t) => { onChange(t); setOpen(false); }, [onChange]);
  const closest = value || '09:00';

  return (
    <div ref={wrapRef} className={`crm-datepicker-wrap${className ? ` ${className}` : ''}`}>
      {compact ? (
        <IconButton
          label={ariaLabel || (value ? `${displayTime(value)} — click to change` : placeholder)}
          size="sm"
          className={`crm-task-date-toggle${value ? ' active' : ''}`}
          onClick={toggleOpen}
        >
          <IconClockSm />
        </IconButton>
      ) : (
        <button type="button" className="crm-input crm-datepicker-trigger" aria-label={ariaLabel} onClick={toggleOpen}>
          <IconClockSm />
          <span className={value ? '' : 'crm-datepicker-placeholder'}>{value ? displayTime(value) : placeholder}</span>
        </button>
      )}

      {open && (
        <>
          <div className="crm-leads-popover-backdrop" onClick={() => setOpen(false)} />
          <div className={`crm-leads-popover crm-timepicker-pop${flipX ? ' flip-x' : ''}${flipY ? ' flip-y' : ''}`}>
            <div ref={listRef} className="crm-timepicker-list">
              {TIMES.map(t => (
                <button
                  type="button"
                  key={t}
                  ref={t === closest ? selectedRef : null}
                  className={`crm-timepicker-option${t === value ? ' selected' : ''}`}
                  onClick={() => select(t)}
                >
                  {displayTime(t)}
                </button>
              ))}
            </div>
            {value && (
              <div className="crm-datepicker-footer">
                <button type="button" className="crm-transcript-toggle" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
