/**
 * ════════════════════════════════════════════════
 * FILE: CreatePicker.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   The little sheet that slides up from the bottom when a tech taps "+" on the
 *   schedule, letting them choose between starting a job appointment or a personal
 *   event. Picking one takes them to the existing create screen for that day — this
 *   sheet only routes; it doesn't create anything itself.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (bottom sheet)
 *   Rendered by:  TechScheduleV2
 *
 * DEPENDS ON:
 *   Packages:  react, react-router-dom
 *   Internal:  none
 *   Data:      none — navigates to /tech/new-appointment and /tech/new-event
 *
 * NOTES / GOTCHAS:
 *   - The create flows themselves are unchanged (owned elsewhere); we only pass the
 *     selected date through as `?date=`.
 * ════════════════════════════════════════════════
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function CreatePicker({ selectedDay, onClose }) {
  const navigate = useNavigate();
  const dateLabel = new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

  return (
    <div className="tv2-sheet-backdrop" onClick={onClose}>
      <div className="tv2-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tv2-sheet__head">
          <div className="tv2-sheet__title">Create new</div>
          <div className="tv2-sheet__sub">{dateLabel}</div>
        </div>
        <button
          type="button"
          className="tv2-sheet__row"
          onClick={() => { onClose(); navigate(`/tech/new-appointment?date=${selectedDay}`); }}
        >
          <span className="tv2-sheet__icon tv2-sheet__icon--job">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
          </span>
          <span className="tv2-sheet__text">
            <span className="tv2-sheet__label">Job appointment</span>
            <span className="tv2-sheet__desc">Linked to a job, with tasks &amp; crew</span>
          </span>
          <span className="tv2-sheet__chev">›</span>
        </button>
        <button
          type="button"
          className="tv2-sheet__row"
          onClick={() => { onClose(); navigate(`/tech/new-event?date=${selectedDay}`); }}
        >
          <span className="tv2-sheet__icon tv2-sheet__icon--event">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
          </span>
          <span className="tv2-sheet__text">
            <span className="tv2-sheet__label">Event</span>
            <span className="tv2-sheet__desc">Meeting, PTO, training — no job needed</span>
          </span>
          <span className="tv2-sheet__chev">›</span>
        </button>
      </div>
    </div>
  );
}
