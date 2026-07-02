/**
 * ════════════════════════════════════════════════
 * FILE: weekly-crm-digest.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Checks the pure logic behind the weekly CRM digest before it can email
 *   anyone: how it decides which recipients to send to, which ad-spend swings
 *   count as "anomalies" (and that it never divides by zero on a fresh week),
 *   which leads are "stale" enough to chase, and that the built-in fallback
 *   summary reads correctly when the AI is unavailable.
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  ./weekly-crm-digest.js (pure exported helpers only — no network)
 *
 * NOTES / GOTCHAS:
 *   - Only the pure helpers are exercised here; the send path (sendGatedEmail)
 *     and Claude call are integration concerns, covered by the consent-path
 *     auditor + manual run, not this unit test.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  parseRecipients, spendAnomalies, isStaleLead, buildFallbackDigest,
} from './weekly-crm-digest.js';

describe('parseRecipients', () => {
  it('splits a comma list and trims blanks', () => {
    expect(parseRecipients({ CRM_DIGEST_RECIPIENTS: 'a@x.com, b@y.com ,, c@z.com' }))
      .toEqual(['a@x.com', 'b@y.com', 'c@z.com']);
  });
  it('falls back to OWNER_EMAIL when no explicit list', () => {
    expect(parseRecipients({ OWNER_EMAIL: 'owner@x.com' })).toEqual(['owner@x.com']);
  });
  it('returns an empty list when neither is set (worker still runs, sends nothing)', () => {
    expect(parseRecipients({})).toEqual([]);
  });
});

describe('spendAnomalies — week-over-week', () => {
  it('flags a jump and a drop past the ±40% threshold', () => {
    const out = spendAnomalies({
      google: { this: 1500, prior: 1000 }, // +50% → up
      meta:   { this: 500,  prior: 1000 }, // -50% → down
    });
    const google = out.find(a => a.platform === 'google');
    const meta = out.find(a => a.platform === 'meta');
    expect(google.direction).toBe('up');
    expect(google.change_pct).toBeCloseTo(0.5, 10);
    expect(meta.direction).toBe('down');
    expect(meta.change_pct).toBeCloseTo(-0.5, 10);
  });
  it('ignores a change within the threshold band', () => {
    expect(spendAnomalies({ google: { this: 1100, prior: 1000 } })).toEqual([]);
  });
  it('treats a zero prior week with new spend as "new" (no divide-by-zero)', () => {
    const [a] = spendAnomalies({ google: { this: 800, prior: 0 } });
    expect(a.direction).toBe('new');
    expect(a.change_pct).toBeNull();
  });
  it('does not flag a platform that spent nothing either week', () => {
    expect(spendAnomalies({ google: { this: 0, prior: 0 } })).toEqual([]);
  });
});

describe('isStaleLead', () => {
  const now = new Date('2026-07-02T12:00:00Z');
  const daysAgo = (d) => new Date(now.getTime() - d * 86400000).toISOString();

  it('flags an untouched open lead past the stale threshold', () => {
    expect(isStaleLead({ contact_id: 'c', lead_status: 'new', updated_at: daysAgo(7) }, now)).toBe(true);
  });
  it('ignores a freshly-touched lead', () => {
    expect(isStaleLead({ contact_id: 'c', lead_status: 'new', updated_at: daysAgo(1) }, now)).toBe(false);
  });
  it('ignores a lead older than the max chase age', () => {
    expect(isStaleLead({ contact_id: 'c', lead_status: 'new', updated_at: daysAgo(60) }, now)).toBe(false);
  });
  it('ignores non-open, spam, or contactless leads', () => {
    expect(isStaleLead({ contact_id: 'c', lead_status: 'won', updated_at: daysAgo(7) }, now)).toBe(false);
    expect(isStaleLead({ contact_id: 'c', lead_status: 'new', spam_flag: true, updated_at: daysAgo(7) }, now)).toBe(false);
    expect(isStaleLead({ contact_id: null, lead_status: 'new', updated_at: daysAgo(7) }, now)).toBe(false);
  });
});

describe('buildFallbackDigest', () => {
  it('produces a subject + HTML covering all three sections', () => {
    const { subject, html } = buildFallbackDigest({
      weekLabel: '2026-06-25 to 2026-07-02',
      movement: [{ stage_name: 'Qualified', moved_in: 3, moved_out: 1, net: 2 }],
      staleCount: 2,
      staleSample: ['Jane D', 'Acme Corp'],
      anomalies: [{ platform: 'google', this_spend: 1500, prior_spend: 1000, change_pct: 0.5, direction: 'up' }],
    });
    expect(subject).toContain('2026-06-25 to 2026-07-02');
    expect(html).toContain('Pipeline movement');
    expect(html).toContain('Qualified');
    expect(html).toContain('Stale leads');
    expect(html).toContain('Jane D');
    expect(html).toContain('Ad-spend anomalies');
    expect(html).toContain('google');
  });
  it('reads cleanly with empty data (no movement, no stale, no anomalies)', () => {
    const { html } = buildFallbackDigest({ weekLabel: 'w', movement: [], staleCount: 0, anomalies: [] });
    expect(html).toContain('No pipeline movement');
    expect(html).toContain('No stale leads');
    expect(html).toContain('steady week-over-week');
  });
});
