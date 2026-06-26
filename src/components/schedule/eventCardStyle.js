/**
 * ════════════════════════════════════════════════
 * FILE: eventCardStyle.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Decides what colors a calendar event card should use on the redesigned
 *   Schedule. Restoration jobs are tinted by their division (water/fire/contents =
 *   teal "Mitigation", reconstruction = purple, remodeling = coral, mold = pink);
 *   plain calendar appointments are blue, checklist/tasks green, not‑yet‑confirmed
 *   ("tentative") jobs get a dashed teal outline, and finished work goes gray.
 *   It returns the soft "tint background + colored left bar + colored title" look
 *   from the design handoff. Who is assigned is still shown by the avatar circles
 *   on the card, so color is free to mean "division".
 *
 * WHERE IT LIVES:
 *   Route:        n/a (pure helper)
 *   Rendered by:  src/components/CalendarView.jsx (event blocks)
 *
 * DEPENDS ON:
 *   Packages:  none · Internal: none · Data: none
 *
 * NOTES / GOTCHAS:
 *   - Page‑scoped UPR design palette (same hexes as the dashboard / Collections),
 *     kept local so the Schedule stays self‑contained.
 *   - Branch order matters: completed → tentative → event → job‑by‑division. A
 *     job with an unrecognized division falls back to the neutral appointment blue.
 *   - Division bucketing mirrors the dashboard: water/fire/contents all read as
 *     "Mitigation" teal.
 * ════════════════════════════════════════════════
 */

// Card color sets: { bg, border, accent (left bar), title }. `dashed` => 1.5px dashed border.
const DIVISION_CARD = {
  mitigation:     { bg: '#e6f4f2', border: '#cbe7e2', accent: '#0e9384', title: '#0b6b60' },
  reconstruction: { bg: '#f1ecfd', border: '#e2d6fb', accent: '#8a5cf6', title: '#6a3fd0' },
  remodeling:     { bg: '#fdece8', border: '#f8d6cd', accent: '#f2664a', title: '#c0432a' },
  mold:           { bg: '#fce8f2', border: '#f8d2e6', accent: '#ec4899', title: '#c12d77' },
};
const APPOINTMENT_CARD = { bg: '#eef2fb', border: '#d8e4fb', accent: '#2f6bf2', title: '#2456c9' };
const TASK_CARD        = { bg: '#e9f7ef', border: '#cdeeda', accent: '#1f9d55', title: '#1f7a44' };
const TENTATIVE_CARD   = { bg: '#eef4f3', border: '#9fcfc8', accent: '#0e9384', title: '#5f7e7a', dashed: true };
const DONE_CARD        = { bg: '#e5e7eb', border: '#9ca3af', accent: '#9ca3af', title: '#6b7280' };

function divisionBucket(division) {
  const d = String(division || '').toLowerCase();
  if (['water', 'fire', 'contents', 'mitigation', 'mit'].includes(d)) return 'mitigation';
  if (['reconstruction', 'recon'].includes(d)) return 'reconstruction';
  if (['remodeling', 'remodel'].includes(d)) return 'remodeling';
  if (d === 'mold') return 'mold';
  return null;
}

// appt → { bg, border, accent, title, dashed? }
export function eventCardStyle(appt) {
  if (!appt) return APPOINTMENT_CARD;
  if (appt.status === 'completed') return DONE_CARD;
  if (appt.status === 'tentative') return TENTATIVE_CARD;
  const isEvent = appt.kind === 'event' || !appt._jobId;
  if (isEvent) return appt.type === 'task' ? TASK_CARD : APPOINTMENT_CARD;
  return DIVISION_CARD[divisionBucket(appt._division)] || APPOINTMENT_CARD;
}

// Short human labels for the division pill. The app-wide DIV_COLORS constant
// uses a different hue scheme (blue water / amber recon), so the Schedule keeps
// its own pill here to stay consistent with the division-colored cards above.
const DIVISION_LABEL = {
  water: 'Water', fire: 'Fire', contents: 'Contents', mitigation: 'Mitigation', mit: 'Mitigation',
  reconstruction: 'Recon', recon: 'Recon', remodeling: 'Remodel', remodel: 'Remodel', mold: 'Mold',
};

// division string → { bg, border, text, label } pill in the new palette.
export function divisionPill(division) {
  const card = DIVISION_CARD[divisionBucket(division)] || APPOINTMENT_CARD;
  const d = String(division || '').toLowerCase();
  const label = DIVISION_LABEL[d] || (d ? d.charAt(0).toUpperCase() + d.slice(1) : '');
  return { bg: card.bg, border: card.border, text: card.title, label };
}
