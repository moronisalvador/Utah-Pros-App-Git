/**
 * PICK-03 — all three scheduling forms enforce the same time rule.
 *
 * The defect was divergence, not absence: TechNewEvent validated correctly
 * while the two appointment forms had no time comparison at all, so
 * time_start 14:00 with time_end 09:00 saved cleanly. A shared validator only
 * helps if every form actually calls it, which is what this asserts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const FORMS = [
  'src/pages/tech/TechNewAppointment.jsx',
  'src/pages/tech/TechEditAppointment.jsx',
  'src/pages/tech/TechNewEvent.jsx',
];

describe('PICK-03 — shared appointment time validation', () => {
  it.each(FORMS)('%s uses the shared validator, not a local copy', (file) => {
    const source = read(file);
    expect(source).toContain('isTimeRangeInvalid');
    expect(source).toMatch(/const timeInvalid = isTimeRangeInvalid\(timeStart, timeEnd\)/);
    // An inlined comparison is how the three drifted apart originally.
    expect(source).not.toMatch(/timeEnd\s*<=\s*timeStart/);
  });

  it.each(FORMS)('%s blocks submission while the range is invalid', (file) => {
    const source = read(file);
    expect(source).toMatch(/(!timeInvalid|\|\| timeInvalid)/);
  });

  it.each(FORMS)('%s shows an inline error rather than failing silently', (file) => {
    const source = read(file);
    expect(source).toMatch(/\{timeInvalid && \(/);
    expect(source).toContain("t('timeError')");
  });

  it.each(FORMS)('%s labels both time selects for screen readers', (file) => {
    const source = read(file);
    // The group heading is a styled div, not a <label>, so without these the
    // two selects announce as identical unlabeled comboboxes.
    expect(source).toContain("aria-label={t('startTimeAria')}");
    expect(source).toContain("aria-label={t('endTimeAria')}");
  });

  it('has every new key in all three locales of both namespaces', () => {
    for (const ns of ['apptForm', 'newEvent']) {
      const keySets = ['en', 'es', 'pt'].map((l) => {
        const json = JSON.parse(read(`src/i18n/locales/${l}/${ns}.json`));
        return { l, json };
      });
      for (const { l, json } of keySets) {
        expect(json.startTimeAria, `${ns}/${l} startTimeAria`).toBeTruthy();
        expect(json.endTimeAria, `${ns}/${l} endTimeAria`).toBeTruthy();
        expect(json.timeError, `${ns}/${l} timeError`).toBeTruthy();
        // Real translations, not English placeholders copied across.
        if (l !== 'en') {
          const en = JSON.parse(read(`src/i18n/locales/en/${ns}.json`));
          expect(json.timeError, `${ns}/${l} timeError untranslated`).not.toBe(en.timeError);
        }
      }
    }
  });
});
