/**
 * PICK-01 (partial) — the calendar speaks the user's language.
 *
 * DatePicker hardcoded English weekday/month arrays and a hardcoded 'en-US'
 * display format, so on a trilingual app the calendar stayed English for
 * Spanish- and Portuguese-speaking technicians even with everything around it
 * translated.
 *
 * The label helpers are exercised through Intl directly — the same calls the
 * component makes — because this lane is DOM-free and cannot render.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(import.meta.dirname, 'DatePicker.jsx'), 'utf8');

// Mirrors the component's derivation exactly; if these diverge, the test is
// worthless, which is why the assertions below check real localized output
// rather than a snapshot of whatever the helper happens to produce.
const weekdays = (locale) => {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(Date.UTC(2026, 1, 1 + i))).replace(/\.$/, ''));
};
const months = (locale) => {
  const fmt = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2026, i, 15))));
};

describe('PICK-01 — localized calendar labels', () => {
  it('starts the week on Sunday, matching the grid', () => {
    // The reference date must actually be a Sunday or every label shifts.
    expect(new Date(Date.UTC(2026, 1, 1)).getUTCDay()).toBe(0);
    expect(weekdays('en-US')[0]).toMatch(/^Sun/);
  });

  it('produces seven weekdays and twelve months for each supported locale', () => {
    for (const locale of ['en-US', 'es-US', 'pt-BR']) {
      expect(weekdays(locale)).toHaveLength(7);
      expect(months(locale)).toHaveLength(12);
      expect(weekdays(locale).every(Boolean)).toBe(true);
      expect(months(locale).every(Boolean)).toBe(true);
    }
  });

  it('actually differs by language rather than falling back to English', () => {
    expect(months('es-US')[0]).toBe('enero');
    expect(months('pt-BR')[0]).toBe('janeiro');
    expect(months('en-US')[0]).toBe('January');
    expect(months('es-US')).not.toEqual(months('en-US'));
    expect(weekdays('pt-BR')).not.toEqual(weekdays('en-US'));
  });

  it('gives the months in calendar order', () => {
    const en = months('en-US');
    expect(en[0]).toBe('January');
    expect(en[11]).toBe('December');
  });

  it('trims the trailing period some locales append to short weekdays', () => {
    for (const locale of ['en-US', 'es-US', 'pt-BR']) {
      for (const label of weekdays(locale)) {
        expect(label.endsWith('.'), `${locale}: ${label}`).toBe(false);
      }
    }
  });
});

describe('PICK-01 — source contract', () => {
  it('no longer hardcodes English names or an en-US format', () => {
    expect(source).not.toMatch(/const MONTHS = \['January'/);
    expect(source).not.toMatch(/const DAYS = \['Su'/);
    expect(source).not.toContain("toLocaleDateString('en-US'");
    expect(source).toContain('currentLocaleTag()');
    // Derived at render, not module load: the language can change without a
    // reload, and module-level arrays would freeze the first locale seen.
    expect(source).toMatch(/const locale = currentLocaleTag\(\);/);
  });

  it('pins the reference-date formatters to UTC, and only those', () => {
    // The rule is narrower than "always UTC". A formatter fed a synthetic
    // Date.UTC(...) reference MUST be pinned, or the device zone shifts it and
    // every column heading moves by one (that is the bug the Sunday assertion
    // caught). A formatter fed a REAL calendar date must NOT be pinned, or the
    // spoken label drifts a day for users east of Greenwich.
    for (const helper of ['weekdayLabels', 'monthLabels']) {
      const at = source.indexOf(`function ${helper}`);
      expect(at, `${helper} not found`).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf('\n}', at));
      expect(body, helper).toContain('Date.UTC(');
      expect(body, helper).toContain("timeZone: 'UTC'");
    }
    for (const helper of ['dayAriaLabel', 'monthNavLabel']) {
      const at = source.indexOf(`function ${helper}`);
      expect(at, `${helper} not found`).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf('\n}', at));
      expect(body, `${helper} formats a real date and must not be UTC-pinned`)
        .not.toContain("timeZone: 'UTC'");
    }
  });
});
