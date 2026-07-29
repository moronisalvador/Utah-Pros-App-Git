/**
 * PICK-03 — appointment time-range validation.
 *
 * TechNewEvent validated this correctly while both appointment forms did not:
 * TechNewAppointment gated submit on `job && date` and TechEditAppointment on
 * `!date || saving`, so an appointment with time_start 14:00 and time_end
 * 09:00 inserted cleanly through update_appointment / the create path.
 *
 * The rule now lives in one module all three forms import, and this tests it
 * directly rather than through a render.
 */
import { describe, it, expect } from 'vitest';
import {
  TIME_OPTIONS,
  LAST_SELECTABLE_START,
  isTimeRangeInvalid,
} from './techFormConstants.js';

describe('isTimeRangeInvalid', () => {
  it('rejects an end before the start', () => {
    expect(isTimeRangeInvalid('14:00', '09:00')).toBe(true);
  });

  it('rejects an end equal to the start', () => {
    // A zero-length appointment is indistinguishable from a mis-tap.
    expect(isTimeRangeInvalid('10:00', '10:00')).toBe(true);
  });

  it('accepts a normal forward range', () => {
    expect(isTimeRangeInvalid('07:00', '15:30')).toBe(false);
    expect(isTimeRangeInvalid('06:00', '06:30')).toBe(false);
  });

  it('does not call a half-filled form invalid', () => {
    // A form is not wrong for being incomplete; required-ness is a separate gate.
    expect(isTimeRangeInvalid('', '10:00')).toBe(false);
    expect(isTimeRangeInvalid('10:00', '')).toBe(false);
    expect(isTimeRangeInvalid(undefined, undefined)).toBe(false);
    expect(isTimeRangeInvalid(null, null)).toBe(false);
  });

  it('compares correctly across the noon boundary', () => {
    // String comparison is only safe because the values are zero-padded and
    // same-length; '9:00' would break it, which is why TIME_OPTIONS pads.
    expect(isTimeRangeInvalid('09:30', '13:00')).toBe(false);
    expect(isTimeRangeInvalid('13:00', '09:30')).toBe(true);
  });

  it('treats every adjacent TIME_OPTIONS pair as valid in order', () => {
    for (let i = 0; i < TIME_OPTIONS.length - 1; i += 1) {
      const a = TIME_OPTIONS[i].val;
      const b = TIME_OPTIONS[i + 1].val;
      expect(isTimeRangeInvalid(a, b), `${a} -> ${b}`).toBe(false);
      expect(isTimeRangeInvalid(b, a), `${b} -> ${a}`).toBe(true);
    }
  });
});

describe('TIME_OPTIONS', () => {
  it('spans 06:00 to 22:30 in 30-minute steps', () => {
    // Pinned so a future range change is deliberate rather than incidental.
    expect(TIME_OPTIONS[0].val).toBe('06:00');
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1].val).toBe('22:30');
    expect(TIME_OPTIONS).toHaveLength(34);   // 17 hours x 2
  });

  it('zero-pads every value, which the string comparison depends on', () => {
    for (const { val } of TIME_OPTIONS) {
      expect(val).toMatch(/^\d{2}:(00|30)$/);
    }
  });

  it('names the last start that still leaves a valid end', () => {
    // Picking the final option as a start is a dead end — there is no later
    // end to choose. The validator surfaces it; this exposes the boundary.
    expect(LAST_SELECTABLE_START).toBe('22:00');
    expect(isTimeRangeInvalid('22:30', '22:30')).toBe(true);
    expect(isTimeRangeInvalid(LAST_SELECTABLE_START, '22:30')).toBe(false);
  });
});
