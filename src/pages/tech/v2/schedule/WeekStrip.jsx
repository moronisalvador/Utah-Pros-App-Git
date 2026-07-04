/**
 * ════════════════════════════════════════════════
 * FILE: WeekStrip.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The row of dates across the top of the schedule that you swipe left/right a
 *   week at a time. It snaps cleanly to each week (with a little haptic tick, like
 *   Apple Calendar), you can reach any week by swiping, and tapping a day just
 *   selects it — it never reloads anything. Today gets a ring, the selected day
 *   gets a filled circle, and days that have appointments show a dot.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (header control)
 *   Rendered by:  TechScheduleV2 (inside the sticky header)
 *
 * DEPENDS ON:
 *   Packages:  react
 *   Internal:  @/lib/nativeHaptics (selection tick), ./scheduleSelectors
 *              (startOfWeekStr, weekDaysStr, addDaysStr), ./scheduleFormat
 *   Data:      none (parent supplies selectedDay + the set of dates with appts)
 *
 * NOTES / GOTCHAS:
 *   - "Infinite" is a large windowed list that GROWS at whichever edge you swipe
 *     toward; prepends compensate scrollLeft in a layout effect so the strip never
 *     jumps under your thumb.
 *   - Week paging fires a haptic tick and reports the newly centered month up so
 *     the data layer can prefetch it — but it NEVER changes the selected day
 *     (browsing weeks is not selecting), so it never triggers a fetch on its own.
 * ════════════════════════════════════════════════
 */
import React, { useRef, useState, useLayoutEffect, useCallback, useEffect } from 'react';
import { selection as hapticSelection } from '@/lib/nativeHaptics';
import { startOfWeekStr, weekDaysStr, addDaysStr, monthKeyOf, parseLocal } from './scheduleSelectors.js';
import { currentLocaleTag } from '@/lib/techDateUtils';

const INITIAL_RADIUS = 12; // weeks each side at mount
const EXTEND = 12; // weeks added when nearing an edge
const EDGE = 3; // extend when within this many weeks of an end

// Build `count` week-start strings stepping `dir` (+7 / -7 days) from a start.
function buildWeeks(fromWeekStart, count, dir) {
  const out = [];
  let cur = fromWeekStart;
  for (let i = 0; i < count; i++) {
    cur = addDaysStr(cur, dir * 7);
    out.push(cur);
  }
  return dir < 0 ? out.reverse() : out;
}

/**
 * @param {{
 *   selectedDay: string, today: string, apptDates: Set<string>,
 *   onSelectDay: (d: string) => void, onWeekChange?: (monthKey: string) => void,
 *   active?: boolean,
 * }} props
 */
export default function WeekStrip({ selectedDay, today, apptDates, onSelectDay, onWeekChange, active = true }) {
  const scrollerRef = useRef(null);
  const centerIndexRef = useRef(-1);
  const prependRef = useRef(0); // # of weeks just prepended (compensate scrollLeft)
  const rafRef = useRef(0);

  const [weeks, setWeeks] = useState(() => {
    const base = startOfWeekStr(today, 0);
    return [...buildWeeks(base, INITIAL_RADIUS, -1), base, ...buildWeeks(base, INITIAL_RADIUS, 1)];
  });

  // Position at the selected day's week on first paint (instant, no animation).
  // Deferred until the pane is active AND has a measurable width — a pane that
  // first mounts hidden (display:none) reports clientWidth 0, which would otherwise
  // park the strip on the far-past week instead of today's.
  const didInit = useRef(false);
  useLayoutEffect(() => {
    if (didInit.current || !active) return;
    const el = scrollerRef.current;
    if (!el || !el.clientWidth) return;
    const idx = weeks.indexOf(startOfWeekStr(selectedDay, 0));
    if (idx >= 0) {
      el.scrollLeft = idx * el.clientWidth;
      centerIndexRef.current = idx;
    }
    didInit.current = true;
  }, [weeks, selectedDay, active]);

  // Compensate scrollLeft after a prepend so the visible week stays put.
  useLayoutEffect(() => {
    if (prependRef.current > 0 && scrollerRef.current) {
      scrollerRef.current.scrollLeft += prependRef.current * scrollerRef.current.clientWidth;
      centerIndexRef.current += prependRef.current;
      prependRef.current = 0;
    }
  }, [weeks]);

  const settle = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !el.clientWidth) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== centerIndexRef.current) {
      centerIndexRef.current = idx;
      hapticSelection();
      const wk = weeks[idx];
      if (wk && onWeekChange) onWeekChange(monthKeyOf(wk));
    }
    // Grow toward whichever edge we're near.
    if (idx <= EDGE) {
      const first = weeks[0];
      const added = buildWeeks(first, EXTEND, -1); // oldest-first, all before `first`
      prependRef.current = added.length;
      setWeeks((prev) => [...added, ...prev]);
    } else if (idx >= weeks.length - 1 - EDGE) {
      const last = weeks[weeks.length - 1];
      setWeeks((prev) => [...prev, ...buildWeeks(last, EXTEND, 1)]);
    }
  }, [weeks, onWeekChange]);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      settle();
    });
  }, [settle]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // Follow EXTERNAL selected-day changes (Today pill, agenda-driven): glide to that
  // day's week. Keyed on selectedDay only, so paging weeks never yanks it back.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !didInit.current) return;
    const idx = weeks.indexOf(startOfWeekStr(selectedDay, 0));
    if (idx >= 0 && idx !== centerIndexRef.current) {
      centerIndexRef.current = idx;
      el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  return (
    <div ref={scrollerRef} className="tv2-weekstrip" onScroll={onScroll}>
      {weeks.map((weekStart) => (
        <div key={weekStart} className="tv2-weekstrip__page">
          {weekDaysStr(weekStart).map((d) => {
            const pd = parseLocal(d);
            const isSel = d === selectedDay;
            const isToday = d === today;
            const dayNum = Number(d.slice(8, 10));
            return (
              <button
                key={d}
                type="button"
                className={`tv2-weekstrip__day${isSel ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                onClick={() => onSelectDay(d)}
              >
                <span className="tv2-weekstrip__dow">{pd.toLocaleDateString(currentLocaleTag(), { weekday: 'narrow' })}</span>
                <span className="tv2-weekstrip__num">{dayNum}</span>
                <span className={`tv2-weekstrip__dot${apptDates.has(d) ? ' has-appt' : ''}`} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
