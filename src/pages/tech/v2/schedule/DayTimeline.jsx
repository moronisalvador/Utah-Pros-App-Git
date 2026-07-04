/**
 * ════════════════════════════════════════════════
 * FILE: DayTimeline.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The one-day "hour grid" view, like the day view in Apple Calendar. Hours run
 *   down the left, each appointment sits as a colored block at its real time and
 *   height for its length, overlapping visits sit side by side, and — when you're
 *   looking at today — a red line marks the current moment and ticks down every
 *   minute. The block's color is its status, so a tech can see at a glance what's
 *   scheduled, working, or done.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (schedule sub-view)
 *   Rendered by:  TechScheduleV2 (day mode)
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  @/components/tech/v2 (apptHref), ./scheduleFormat
 *   Data:      none (parent supplies the day's appointments)
 *
 * NOTES / GOTCHAS:
 *   - The now-line interval is cleared whenever the pane is not `active` (the
 *     `active` prop contract) so a hidden pane isn't ticking a timer.
 *   - Untimed rows (all-day / events with no start) render in a strip above the
 *     grid rather than being dropped.
 * ════════════════════════════════════════════════
 */
import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apptHref } from '@/components/tech/v2';
import { minutesOfDay, fmtTime, fmtTimeRange, statusVar, isEvent, divisionMeta } from './scheduleFormat.js';
import { currentLocaleTag } from '@/lib/techDateUtils';
import CrewAvatars from './CrewAvatars.jsx';

const HOUR_PX = 80; // taller rows so a 30-min block fits its slot without spilling
const MIN_BLOCK_PX = 34;
const NOW_ABOVE_MIN = 150; // on open, show ~2.5h above the now-line so it sits lower
                           // on screen and in-progress appointments stay visible

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// Our own scroll container (the pane host), or the nearest scrollable ancestor.
function getScroller(el) {
  const pane = el.closest('.tv2-pane-scroll');
  if (pane) return pane;
  let node = el.parentElement;
  while (node) {
    const oy = window.getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll') return node;
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

// Greedy lane packing: overlapping blocks get side-by-side columns.
function packLanes(timed) {
  const items = timed.map((a) => ({
    appt: a,
    start: minutesOfDay(a.time_start),
    end: Math.max(minutesOfDay(a.time_start) + 30, minutesOfDay(a.time_end) || minutesOfDay(a.time_start) + 60),
  }));
  items.sort((x, y) => x.start - y.start || x.end - y.end);
  const clusters = [];
  let cur = [];
  let curEnd = -1;
  for (const it of items) {
    if (cur.length && it.start >= curEnd) {
      clusters.push(cur);
      cur = [];
      curEnd = -1;
    }
    cur.push(it);
    curEnd = Math.max(curEnd, it.end);
  }
  if (cur.length) clusters.push(cur);

  const placed = [];
  for (const cluster of clusters) {
    const lanes = []; // lane → last end
    for (const it of cluster) {
      let lane = lanes.findIndex((endAt) => it.start >= endAt);
      if (lane === -1) { lane = lanes.length; lanes.push(it.end); }
      else lanes[lane] = it.end;
      it.lane = lane;
    }
    const laneCount = lanes.length;
    for (const it of cluster) placed.push({ ...it, laneCount });
  }
  return placed;
}

/**
 * @param {{ appts: object[], selectedDay: string, today: string, active: boolean }} props
 */
export default function DayTimeline({ appts, selectedDay, today, active }) {
  const { t } = useTranslation(['schedule', 'tech']);
  const navigate = useNavigate();
  const [now, setNow] = useState(nowMinutes);
  const isToday = selectedDay === today;
  const rootRef = useRef(null);
  const gridRef = useRef(null);

  // Tick the now-line each minute — only while the pane is active.
  useEffect(() => {
    if (!active || !isToday) return undefined;
    // Resync immediately on (re)activation via rAF (not a synchronous setState in
    // the effect body), then tick each minute.
    const raf = requestAnimationFrame(() => setNow(nowMinutes()));
    const id = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, [active, isToday, selectedDay]);

  const { timed, untimed } = useMemo(() => {
    const tm = [];
    const um = [];
    for (const a of appts) (a.time_start ? tm : um).push(a);
    return { timed: tm, untimed: um };
  }, [appts]);

  const placed = useMemo(() => packLanes(timed), [timed]);

  // Hour range: 6–20 by default, widened to fit the day's blocks (and now-line).
  const { startHour, endHour } = useMemo(() => {
    let lo = 6;
    let hi = 20;
    for (const p of placed) {
      lo = Math.min(lo, Math.floor(p.start / 60));
      hi = Math.max(hi, Math.ceil(p.end / 60));
    }
    if (isToday) { lo = Math.min(lo, Math.floor(now / 60)); hi = Math.max(hi, Math.ceil(now / 60) + 1); }
    return { startHour: Math.max(0, lo), endHour: Math.min(24, Math.max(hi, lo + 1)) };
  }, [placed, isToday, now]);

  const rangeStart = startHour * 60;
  const gridHeight = (endHour - startHour) * HOUR_PX;
  const hours = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);

  const nowTop = ((now - rangeStart) / 60) * HOUR_PX;
  const showNow = isToday && now >= rangeStart && now <= endHour * 60;

  // Open the day parked at a sensible spot instead of wherever the shared pane
  // scroll last was: for today, ~2.5h above the now-line; else the first
  // appointment; else the top. We anchor ONCE per selected day (not on the minute
  // tick, and not on every tab-return — so a scroll you left is respected when you
  // come back). A queued microtask re-asserts the position so it wins over the
  // pane host's scroll-restore on activation (which otherwise snaps back to 0 →
  // the "showing all the way to 6 AM" bug).
  const anchoredDayRef = useRef(null);
  useLayoutEffect(() => {
    if (!active || anchoredDayRef.current === selectedDay) return;
    const root = rootRef.current;
    const grid = gridRef.current;
    if (!root || !grid) return;
    const scroller = getScroller(root);
    if (!scroller) return;
    const apply = () => {
      // Scoped to our own pane (not a global querySelector) — measures the sticky
      // header so the anchor lands just below it, not hidden underneath.
      const header = scroller.querySelector('.tv2-sched-header');
      const headerH = header ? header.offsetHeight : 0;
      const scRect = scroller.getBoundingClientRect();
      const gridDocTop = scroller.scrollTop + (grid.getBoundingClientRect().top - scRect.top);
      const anchorMin = isToday
        ? Math.max(rangeStart, nowMinutes() - NOW_ABOVE_MIN)
        : (placed.length ? placed[0].start : rangeStart);
      const px = ((anchorMin - rangeStart) / 60) * HOUR_PX;
      scroller.scrollTop = Math.max(0, gridDocTop + Math.max(0, px) - headerH - 12);
    };
    apply();
    queueMicrotask(apply);
    anchoredDayRef.current = selectedDay;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, active]);

  return (
    <div className="tv2-timeline" ref={rootRef}>
      {untimed.length > 0 && (
        <div className="tv2-timeline__allday">
          <span className="tv2-timeline__allday-label">{t('allDay')}</span>
          <div className="tv2-timeline__allday-items">
            {untimed.map((a) => (
              <button
                key={a.id}
                type="button"
                className="tv2-timeline__allday-chip"
                style={{ borderLeftColor: a.color || statusVar(a.status, 'color') }}
                onClick={() => navigate(apptHref(a.id, a.job_id))}
              >
                {a.jobs?.insured_name || a.title || (isEvent(a) ? t('event') : t('tech:misc.appointment'))}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tv2-timeline__grid" style={{ height: gridHeight }} ref={gridRef}>
        {hours.map((h) => (
          <div key={h} className="tv2-timeline__hour" style={{ top: (h - startHour) * HOUR_PX }}>
            <span className="tv2-timeline__hour-label">
              {h === 24 ? '' : new Date(2000, 0, 1, h).toLocaleTimeString(currentLocaleTag(), { hour: 'numeric' })}
            </span>
            <span className="tv2-timeline__hour-line" />
          </div>
        ))}

        {placed.map(({ appt, start, end, lane, laneCount }) => {
          const top = ((start - rangeStart) / 60) * HOUR_PX;
          const height = Math.max(MIN_BLOCK_PX, ((end - start) / 60) * HOUR_PX - 4);
          const widthPct = 100 / laneCount;
          const div = appt.jobs?.division ? divisionMeta(appt.jobs.division) : null;
          const crew = appt.appointment_crew || [];
          const city = appt.jobs?.city;
          const meta = [
            fmtTimeRange(appt.time_start, appt.time_end),
            div && t(`tech:division.${appt.jobs.division}`, { defaultValue: div.label }),
            city,
          ].filter(Boolean).join(' · ');
          return (
            <button
              key={appt.id}
              type="button"
              className="tv2-timeline__block"
              style={{
                top,
                height,
                left: `calc(var(--tv2-tl-gutter) + (100% - var(--tv2-tl-gutter)) * ${lane * widthPct} / 100)`,
                width: `calc((100% - var(--tv2-tl-gutter)) * ${widthPct} / 100 - 4px)`,
                background: statusVar(appt.status, 'bg'),
                borderLeftColor: appt.color || statusVar(appt.status, 'color'),
                color: statusVar(appt.status, 'color'),
              }}
              onClick={() => navigate(apptHref(appt.id, appt.job_id))}
            >
              <span className="tv2-timeline__block-title">
                {appt.is_milestone && '◆ '}
                {appt.jobs?.insured_name || appt.title || (isEvent(appt) ? t('event') : t('tech:misc.appointment'))}
              </span>
              {crew.length > 0 && <CrewAvatars crew={crew} size={18} />}
              <span className="tv2-timeline__block-time">{meta}</span>
            </button>
          );
        })}

        {showNow && (
          <div className="tv2-timeline__now" style={{ top: nowTop }} aria-label={t('nowAria', { time: fmtTime(`${Math.floor(now / 60)}:${now % 60}`) })}>
            <span className="tv2-timeline__now-label">{fmtTime(`${Math.floor(now / 60)}:${String(now % 60).padStart(2, '0')}`)}</span>
            <span className="tv2-timeline__now-dot" />
            <span className="tv2-timeline__now-line" />
          </div>
        )}
      </div>
    </div>
  );
}
