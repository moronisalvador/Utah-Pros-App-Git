/**
 * ════════════════════════════════════════════════
 * FILE: techFormConstants.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   A small shared kit for the field-tech forms (like the new/edit
 *   appointment form). It holds the standard styling for text inputs and
 *   field labels, a pre-built list of time choices in 30-minute steps from
 *   6 AM to 10 PM, the shortened list of appointment types that show on
 *   mobile, and a tiny helper that turns a person's name into initials.
 *
 * DEPENDS ON:
 *   Packages:  none
 *   Internal:  @/lib/scheduleUtils (APPT_TYPES — the master appointment-type
 *              list this filters down for mobile)
 *   Data:      none (static constants + one pure helper)
 *
 * EXPORTS:
 *   inputStyle, labelStyle, TIME_OPTIONS, MOBILE_TYPES, getInitials(name)
 *
 * NOTES / GOTCHAS:
 *   - TIME_OPTIONS is built once at module load (an IIFE), not on every render.
 *   - inputStyle uses 16px font on purpose — iOS Safari zooms the page when a
 *     focused input's font is under 16px, so this prevents that zoom.
 *   - MOBILE_TYPES is APPT_TYPES narrowed to the six types techs pick on
 *     mobile; if a type's value changes in scheduleUtils, update the filter here.
 * ════════════════════════════════════════════════
 */
import { APPT_TYPES } from '@/lib/scheduleUtils';

// ─── SECTION: Constants ──────────────
export const inputStyle = {
  width: '100%', height: 48, padding: '0 14px',
  fontSize: 16, borderRadius: 'var(--tech-radius-button)',
  border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
};

export const labelStyle = {
  fontSize: 'var(--tech-text-label)', fontWeight: 600, color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6,
};

export const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 6; h <= 22; h++) for (let m = 0; m < 60; m += 30) {
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const hr = h % 12 || 12;
    opts.push({ val, label: `${hr}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` });
  }
  return opts;
})();

/**
 * PICK-03 — is this start/end pair invalid?
 *
 * TechNewEvent already validated this correctly while both appointment forms
 * did not: TechNewAppointment gated submit on `job && date` and
 * TechEditAppointment on `!date || saving`, so an appointment with
 * time_start 14:00 and time_end 09:00 inserted cleanly. Lifted here — the one
 * module all three forms already import — so the rule cannot drift between them.
 *
 * Values are 'HH:MM' 24-hour strings from TIME_OPTIONS, which compare correctly
 * as strings because they are zero-padded and same-length.
 *
 * Equal times count as invalid: a zero-length appointment is not a thing a
 * technician means to create, and it is indistinguishable from a mis-tap.
 * Partial input is NOT invalid — a form is not wrong for being half-filled.
 */
export function isTimeRangeInvalid(start, end) {
  if (!start || !end) return false;
  return end <= start;
}

/**
 * The last start time that still leaves a valid end time available.
 *
 * Selecting the final option as a start is a dead end — there is no later end
 * to pick. The validator surfaces that rather than hiding it, but callers that
 * want to prevent it up front can bound their start list with this.
 */
export const LAST_SELECTABLE_START = TIME_OPTIONS[TIME_OPTIONS.length - 2]?.val ?? null;

export const MOBILE_TYPES = APPT_TYPES.filter(t =>
  ['reconstruction', 'inspection', 'monitoring', 'mitigation', 'estimate', 'other'].includes(t.value)
);

// ─── SECTION: Helpers ──────────────
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0][0].toUpperCase();
}
