import { describe, it, expect, afterEach } from 'vitest';
import i18n from '@/i18n';
import { relativeTime, relativeDate, currentLocaleTag, formatLossDate } from './techDateUtils.js';

// Build a local YYYY-MM-DD (avoids UTC-vs-local day drift near midnight).
function localDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

afterEach(async () => { await i18n.changeLanguage('en'); });

describe('currentLocaleTag', () => {
  it('maps the active language to a BCP-47 tag', async () => {
    expect(currentLocaleTag()).toBe('en-US');
    await i18n.changeLanguage('pt'); expect(currentLocaleTag()).toBe('pt-BR');
    await i18n.changeLanguage('es'); expect(currentLocaleTag()).toBe('es');
  });
});

describe('relativeTime', () => {
  it('localizes the "ago" phrasing with interpolated count', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(relativeTime(fiveMinAgo)).toBe('5m ago');
    await i18n.changeLanguage('pt');
    expect(relativeTime(fiveMinAgo)).toBe('há 5 min');
    await i18n.changeLanguage('es');
    expect(relativeTime(fiveMinAgo)).toBe('hace 5 min');
  });

  it('returns just-now under a minute and empty for falsy', () => {
    expect(relativeTime(new Date().toISOString())).toBe('just now');
    expect(relativeTime('')).toBe('');
  });
});

describe('relativeDate', () => {
  it('localizes Today / Tomorrow / Yesterday', async () => {
    expect(relativeDate(localDay(0))).toBe('Today');
    expect(relativeDate(localDay(1))).toBe('Tomorrow');
    expect(relativeDate(localDay(-1))).toBe('Yesterday');
    await i18n.changeLanguage('pt');
    expect(relativeDate(localDay(0))).toBe('Hoje');
    await i18n.changeLanguage('es');
    expect(relativeDate(localDay(0))).toBe('Hoy');
  });
});

describe('formatLossDate', () => {
  it('formats an absolute date and is empty for falsy', () => {
    expect(formatLossDate('')).toBe('');
    expect(formatLossDate('2026-01-15')).toMatch(/\d/); // locale-formatted, non-empty
  });
});
