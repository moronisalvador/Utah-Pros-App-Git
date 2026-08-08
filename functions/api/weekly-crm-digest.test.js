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
 *   Internal:  ./weekly-crm-digest.js (pure exported helpers + a fake db/rpc —
 *              no network)
 *
 * NOTES / GOTCHAS:
 *   - Only the pure helpers and the recipient-resolution logic (against a fake
 *     db) are exercised here; the send path (sendGatedEmail) and Claude call
 *     are integration concerns, covered by the consent-path auditor + manual
 *     run, not this unit test.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
  parseRecipients, resolveRecipients, resolvePreferenceRecipients,
  spendAnomalies, isStaleLead, buildFallbackDigest,
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

// A fake db exposing just what resolvePreferenceRecipients/resolveRecipients touch:
// employees (admin roster), get_effective_notification_prefs (per-admin RPC), and
// integration_config (legacy fallback row).
function fakeDb({
  admins = [], prefsByEmployee = {}, integrationConfigValue = null,
  throwOnAdmins = false, throwOnPrefs = false, throwOnIntegrationConfig = false,
} = {}) {
  return {
    select: async (table) => {
      if (table === 'employees') {
        if (throwOnAdmins) throw new Error('down');
        return admins;
      }
      if (table === 'integration_config') {
        if (throwOnIntegrationConfig) throw new Error('down');
        return integrationConfigValue == null ? [] : [{ value: integrationConfigValue }];
      }
      return [];
    },
    rpc: async (name, { p_employee_id } = {}) => {
      if (name !== 'get_effective_notification_prefs') return [];
      if (throwOnPrefs) throw new Error('down');
      return prefsByEmployee[p_employee_id] || [];
    },
  };
}

const digestPref = (enabled) => ({ type_key: 'crm_weekly_digest', channel: 'email', enabled });

describe('resolvePreferenceRecipients — opted-in admins only', () => {
  it('includes an admin whose effective email preference for the digest is on', async () => {
    const db = fakeDb({
      admins: [{ id: 'a1', email: 'admin1@x.com' }],
      prefsByEmployee: { a1: [digestPref(true)] },
    });
    expect(await resolvePreferenceRecipients(db)).toEqual(['admin1@x.com']);
  });

  it('excludes an admin whose effective email preference is off', async () => {
    const db = fakeDb({
      admins: [{ id: 'a1', email: 'admin1@x.com' }],
      prefsByEmployee: { a1: [digestPref(false)] },
    });
    expect(await resolvePreferenceRecipients(db)).toEqual([]);
  });

  it('ignores an unrelated enabled pref for a different type/channel', async () => {
    const db = fakeDb({
      admins: [{ id: 'a1', email: 'admin1@x.com' }],
      prefsByEmployee: {
        a1: [
          { type_key: 'crm_weekly_digest', channel: 'bell', enabled: true },
          { type_key: 'payment.received', channel: 'email', enabled: true },
        ],
      },
    });
    expect(await resolvePreferenceRecipients(db)).toEqual([]);
  });

  it('resolves multiple opted-in admins and skips one without an email', async () => {
    const db = fakeDb({
      admins: [
        { id: 'a1', email: 'admin1@x.com' },
        { id: 'a2', email: '' },
        { id: 'a3', email: 'admin3@x.com' },
      ],
      prefsByEmployee: {
        a1: [digestPref(true)],
        a2: [digestPref(true)],
        a3: [digestPref(true)],
      },
    });
    expect(await resolvePreferenceRecipients(db)).toEqual(['admin1@x.com', 'admin3@x.com']);
  });

  it('never throws if the admin roster read fails', async () => {
    expect(await resolvePreferenceRecipients(fakeDb({ throwOnAdmins: true }))).toEqual([]);
  });

  it('skips (not throws) an admin whose prefs lookup fails, without dropping the rest', async () => {
    const admins = [{ id: 'a1', email: 'admin1@x.com' }, { id: 'a2', email: 'admin2@x.com' }];
    let calls = 0;
    const db = {
      select: async () => admins,
      rpc: async (name, { p_employee_id }) => {
        calls++;
        if (p_employee_id === 'a1') throw new Error('down');
        return [digestPref(true)];
      },
    };
    expect(await resolvePreferenceRecipients(db)).toEqual(['admin2@x.com']);
    expect(calls).toBe(2);
  });
});

describe('resolveRecipients — preference system first, legacy static list as a floor', () => {
  it('prefers opted-in admins over the legacy env list', async () => {
    const db = fakeDb({
      admins: [{ id: 'a1', email: 'admin1@x.com' }],
      prefsByEmployee: { a1: [digestPref(true)] },
    });
    const out = await resolveRecipients(db, { CRM_DIGEST_RECIPIENTS: 'legacy@x.com' });
    expect(out).toEqual(['admin1@x.com']);
  });

  it('falls back to the env list when no admin has opted in', async () => {
    const db = fakeDb({
      admins: [{ id: 'a1', email: 'admin1@x.com' }],
      prefsByEmployee: { a1: [digestPref(false)] },
    });
    const out = await resolveRecipients(db, { CRM_DIGEST_RECIPIENTS: 'legacy@x.com' });
    expect(out).toEqual(['legacy@x.com']);
  });

  it('falls back to the crm_digest_recipients row when no env and no opt-ins', async () => {
    const db = fakeDb({ admins: [], integrationConfigValue: 'ops@x.com, boss@y.com' });
    expect(await resolveRecipients(db, {})).toEqual(['ops@x.com', 'boss@y.com']);
  });

  it('returns empty (worker still runs, sends nothing) when nothing resolves anywhere', async () => {
    expect(await resolveRecipients(fakeDb({}), {})).toEqual([]);
  });

  it('falls all the way to the legacy list when the admin roster read fails', async () => {
    const db = fakeDb({ throwOnAdmins: true });
    expect(await resolveRecipients(db, { OWNER_EMAIL: 'owner@x.com' })).toEqual(['owner@x.com']);
  });

  it('falls back to the legacy list when a lone admin exists but the prefs read fails', async () => {
    const db = fakeDb({
      admins: [{ id: 'a1', email: 'admin1@x.com' }],
      throwOnPrefs: true,
    });
    expect(await resolveRecipients(db, { OWNER_EMAIL: 'owner@x.com' })).toEqual(['owner@x.com']);
  });

  it('never throws if the integration_config read fails', async () => {
    const db = fakeDb({ admins: [], throwOnIntegrationConfig: true });
    expect(await resolveRecipients(db, {})).toEqual([]);
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
