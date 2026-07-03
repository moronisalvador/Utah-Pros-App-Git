/**
 * ════════════════════════════════════════════════
 * FILE: techQuery.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Guards the frozen tech-app cache registry. Proves the query keys are shaped
 *   the way every v2 screen expects, that every mutation maps to the caches it
 *   should refresh, and that asking to refresh an unknown mutation fails loudly
 *   instead of silently doing nothing. Pure unit test — no database, runs in the
 *   normal `npm test` pass.
 *
 * WHERE IT LIVES:
 *   Route:        n/a (test file)
 *   Rendered by:  n/a — run via `npm test` (vitest)
 *
 * DEPENDS ON:
 *   Packages:  vitest
 *   Internal:  src/lib/techQuery.js
 *   Data:      none
 *
 * NOTES / GOTCHAS:
 *   - Uses a fake QueryClient (records invalidateQueries calls) so we assert the
 *     exact ['tech', kind] prefixes without spinning up react-query.
 * ════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { techKeys, TECH_QUERY_KINDS, MUTATION_INVALIDATIONS, invalidateTech } from './techQuery.js';

describe('techQuery — frozen key registry', () => {
  it('every key is rooted at "tech" and carries its kind + id', () => {
    expect(techKeys.dash('e1')).toEqual(['tech', 'dash', 'e1']);
    expect(techKeys.schedMonth('2026-07')).toEqual(['tech', 'sched-month', '2026-07']);
    expect(techKeys.activeClock('e1')).toEqual(['tech', 'active-clock', 'e1']);
    expect(techKeys.tasks('e1')).toEqual(['tech', 'tasks', 'e1']);
    expect(techKeys.rooms('j1')).toEqual(['tech', 'rooms', 'j1']);
    expect(techKeys.docs('a1')).toEqual(['tech', 'docs', 'a1']);
  });

  it('exposes exactly the six documented kinds', () => {
    expect(Object.values(TECH_QUERY_KINDS).sort()).toEqual(
      ['active-clock', 'dash', 'docs', 'rooms', 'sched-month', 'tasks'],
    );
  });

  it('the key registry is frozen (wave sessions cannot add keys)', () => {
    expect(Object.isFrozen(techKeys)).toBe(true);
    expect(Object.isFrozen(MUTATION_INVALIDATIONS)).toBe(true);
    expect(Object.isFrozen(TECH_QUERY_KINDS)).toBe(true);
  });

  it('every mutation maps only to real kinds', () => {
    const validKinds = new Set(Object.values(TECH_QUERY_KINDS));
    for (const [mutation, kinds] of Object.entries(MUTATION_INVALIDATIONS)) {
      expect(kinds.length, `${mutation} invalidates nothing`).toBeGreaterThan(0);
      for (const kind of kinds) expect(validKinds.has(kind), `${mutation} → ${kind}`).toBe(true);
    }
  });
});

describe('invalidateTech', () => {
  const fakeClient = () => {
    const calls = [];
    return { calls, invalidateQueries: (arg) => { calls.push(arg.queryKey); return Promise.resolve(); } };
  };

  it('clock refreshes dash, active-clock and the schedule window', async () => {
    const c = fakeClient();
    await invalidateTech(c, 'clock');
    expect(c.calls).toEqual([['tech', 'dash'], ['tech', 'active-clock'], ['tech', 'sched-month']]);
  });

  it('task refreshes dash, tasks and the schedule window', async () => {
    const c = fakeClient();
    await invalidateTech(c, 'task');
    expect(c.calls).toEqual([['tech', 'dash'], ['tech', 'tasks'], ['tech', 'sched-month']]);
  });

  it('photo refreshes dash and docs', async () => {
    const c = fakeClient();
    await invalidateTech(c, 'photo');
    expect(c.calls).toEqual([['tech', 'dash'], ['tech', 'docs']]);
  });

  it('targets each kind by its two-element prefix (all ids of that kind)', async () => {
    const c = fakeClient();
    await invalidateTech(c, 'room');
    expect(c.calls).toEqual([['tech', 'rooms']]);
    expect(c.calls[0]).toHaveLength(2); // no id → whole kind invalidated
  });

  it('throws on an unknown mutation instead of silently no-op', async () => {
    const c = fakeClient();
    await expect(() => invalidateTech(c, 'nope')).toThrow(/Unknown tech mutation/);
  });
});
