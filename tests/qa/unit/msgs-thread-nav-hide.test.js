/**
 * COMPOSER-01 — the tab bar must vanish while a message thread is open.
 *
 * Owner-reported from a screenshot: the composer floating above dead space with
 * the tab bar still showing. The gap is a consequence — with the nav visible the
 * composer's own safe-area padding becomes redundant spacing.
 *
 * The cause was that the nav-hide existed ONLY as a :has() on the layout root
 * reacting to a class set several levels below it. Measured on the simulator
 * 2026-07-28 against ONE build: the identical deep link laid out correctly three
 * times and left the tab bar visible once. A style-invalidation race, not a code
 * path — which is why it survived two earlier "verified working" screenshots.
 *
 * After deriving the class in React from the URL: 12 consecutive clean runs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const layout = read('src/components/TechLayout.jsx');
const css = read('src/index.css');

describe('COMPOSER-01 — the nav-hide no longer depends on :has() alone', () => {
  it('sets a class directly on the element the rule matches', () => {
    // React writing the class onto .tech-layout is what removes the race: there
    // is no descendant mutation for the engine to fail to propagate upward.
    expect(layout).toContain('tech-layout--msgs-thread');
    expect(layout).toContain('className={`tech-layout${msgsThreadOpen');
  });

  it('derives it from the URL, so it is available on the same render', () => {
    expect(layout).toContain('const msgsThreadOpen = msgsActive');
    expect(layout).toContain('location.search');
  });

  it('requires the messages pane to be the active tab', () => {
    // Without this a thread "open" in a backgrounded pane would strand the tab
    // bar for the whole app — the exact hazard the original :has() guarded with
    // its :not([hidden]) term.
    expect(layout).toMatch(/const msgsThreadOpen = msgsActive\s*\n?\s*&&/);
  });

  it('matches both the open-thread and new-conversation query forms', () => {
    // TechMessagesV2 computes threadOpen as `newConversationOpen || !!activeId
    // && ...`, so the class has to cover ?c= and ?new=1 or the picker screen
    // keeps the tab bar.
    const at = layout.indexOf('const msgsThreadOpen');
    const expr = layout.slice(at, layout.indexOf(';', at));
    expect(expr).toContain('c=');
    expect(expr).toContain('new=1');
  });

  it('does not match a bare ?c= with no value', () => {
    // `c=` alone is not a conversation; hiding the nav for it would strand the
    // user on a thread layer with nothing in it and no way back to the tabs.
    const at = layout.indexOf('const msgsThreadOpen');
    const expr = layout.slice(at, layout.indexOf(';', at));
    const pattern = /\[?\?&\]?\(c=\[\^&\]/;
    expect(pattern.test(expr) || expr.includes('c=[^&]')).toBe(true);
  });
});

describe('COMPOSER-01 — the CSS', () => {
  it('hides the nav from the deterministic class', () => {
    expect(css).toContain('.tech-layout--msgs-thread > .tech-nav');
  });

  it('keeps the :has() rule as a fallback', () => {
    // Retained deliberately: it still covers any path that opens a thread
    // without changing the query string. Removing it would narrow coverage
    // while fixing the race.
    expect(css).toContain('.tech-layout:has(.tv2-msgs-pane:not([hidden]) .tv2-msgs-thread-open) > .tech-nav');
  });
});

describe('COMPOSER-01 — the composer padding this interacts with', () => {
  it('still drops the home-indicator inset only when the keyboard is up', () => {
    // With the nav correctly hidden, this padding IS the right bottom spacing.
    // It only read as a bug because the tab bar was also present.
    expect(css).toContain('.tv2-msgs-pane.tv2-msgs-kb-open .tv2-msgs-composer { padding-bottom: 0; }');
  });
});
