/**
 * MOTION-01 (scroll restoration half) — Back returns you to where you were.
 *
 * .tech-content is the tech shell's scroller (index.css, overflow-y:auto) and it
 * is keyed by location.pathname, so every navigation remounts it at scrollTop 0.
 * Going Back therefore dropped a tech at the top of a long claims or documents
 * list they had scrolled halfway down — every single time.
 *
 * page-lifecycle.md §5 states the contract: "New route = top, back = restored",
 * owned by ONE primitive keyed on location.key, never hand-rolled per page.
 *
 * Source-contract assertions — vitest runs `node` here with no jsdom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const layout = read('src/components/TechLayout.jsx');

describe('MOTION-01 — the registry', () => {
  it('keys on location.key, not pathname', () => {
    // Two history entries can share a pathname. Keying on the path would hand a
    // fresh visit the offset from an older one.
    expect(layout).toContain('scrollPositions.current.set(key, el.scrollTop)');
    expect(layout).toContain('const key = location.key;');
    expect(layout).toContain('scrollPositions.current.get(location.key)');
  });

  it('lives in the shell, not in a page', () => {
    // §5: owned by one primitive; pages must not hand-roll it.
    expect(layout).toContain('const scrollPositions = useRef(new Map());');
    expect(layout).toContain('const contentRef = useRef(null);');
    expect(layout).toContain('ref={contentRef}');
  });

  it('is bounded', () => {
    // A Map that only grows is a leak in an app meant to stay open all shift.
    expect(layout).toContain('const MAX_KEYS = 50;');
    expect(layout).toContain('scrollPositions.current.delete(oldest);');
  });
});

describe('MOTION-01 — when it saves', () => {
  it('tracks continuously with a passive listener', () => {
    expect(layout).toContain("el.addEventListener('scroll', onScroll, { passive: true });");
  });

  it('does NOT save on unmount', () => {
    // WebKit reports scrollTop 0 for an element being removed or hidden, so a
    // save-on-unmount always records 0 and "restores" to the top. TechMsgsPane
    // documents the same trap for its own layers.
    const effect = layout.slice(layout.indexOf('const onScroll = () =>'), layout.indexOf('}, [location.key, paneCovering]);'));
    expect(effect).toContain("removeEventListener('scroll', onScroll)");
    expect(effect).not.toMatch(/return \(\) => \{[^}]*scrollPositions\.current\.set/);
  });
});

describe('MOTION-01 — when it restores', () => {
  it('restores before paint', () => {
    // useEffect would restore AFTER the browser has painted the top of the list,
    // producing a visible jump — which is worse than not restoring at all.
    const at = layout.indexOf('useLayoutEffect(() => {');
    expect(at).toBeGreaterThan(-1);
    const block = layout.slice(at, layout.indexOf('}, [location.key, navType, paneCovering]);'));
    expect(block).toContain('el.scrollTop =');
  });

  it('restores only on POP', () => {
    expect(layout).toContain("if (navType === 'POP') {");
  });

  it('sends a new route to the top', () => {
    // The other half of §5's sentence. Landing a fresh screen mid-list would be
    // its own bug.
    const at = layout.indexOf("if (navType === 'POP') {");
    const block = layout.slice(at, layout.indexOf('const MAX_KEYS', at));
    expect(block).toContain('} else {');
    expect(block).toContain('el.scrollTop = 0;');
  });

  it('falls back to the top when a key has nothing recorded', () => {
    expect(layout).toContain("el.scrollTop = typeof saved === 'number' ? saved : 0;");
  });
});

describe('MOTION-01 — what is deliberately NOT done', () => {
  it('leaves the competing route-motion systems in place', () => {
    // The finding also asks to retire the page-local `entering` animation and the
    // pathname-keyed fade "WHEN the single route-motion owner is qualified".
    // Nothing has qualified one yet, so removing either now would leave routes
    // with no transition at all. The keyed fade stays until then.
    expect(layout).toContain("className={`tech-content tech-content--${navType === 'POP' ? 'back' : 'fwd'}`}");
    expect(read('src/index.css')).toContain('.tech-content--back { animation: tech-page-fade 0.2s ease-out; }');
  });
});
