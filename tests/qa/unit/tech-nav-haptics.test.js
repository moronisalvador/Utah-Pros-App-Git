/**
 * Field-polish: tech nav bar haptics + press feedback (punchlist 2026-07-29).
 *
 * Owner TestFlight finding: tab presses had no haptic while the notification
 * bell and the dashboard header trio "feel great". Those references fire
 * impact('light') synchronously in the tap handler (IconButton.jsx,
 * DashHeader.jsx) — this contract pins the nav tabs to that exact pattern.
 *
 * The haptic hangs off the Link's onClick, so it fires ONLY on a real tap —
 * never on scroll, programmatic navigation, or a background route change
 * (motion-standard.md §4). Reduced-motion suppression lives inside
 * nativeHaptics itself and must stay there.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const layout = read('src/components/TechLayout.jsx');
const css = read('src/index.css');
const haptics = read('src/lib/nativeHaptics.js');

describe('tech nav tab haptic matches the dashboard header reference', () => {
  it('imports the sanctioned wrapper, not @capacitor/haptics directly', () => {
    expect(layout).toContain("import { impact } from '@/lib/nativeHaptics'");
    expect(layout).not.toContain('@capacitor/haptics');
  });

  it("fires impact('light') from the tab Link's onClick (tap-only path)", () => {
    expect(layout).toContain("onClick={() => impact('light')}");
    // The haptic must not be wired to route/location effects, where it would
    // also fire on programmatic navigation.
    expect(layout).not.toMatch(/useEffect\([^)]*impact/s);
  });

  it('nativeHaptics keeps the reduced-motion gate the tabs rely on', () => {
    expect(haptics).toMatch(/export function impact[\s\S]*?\{\s*if \(reducedMotion\(\)\) return;/);
  });
});

describe('tech nav tab press feedback (motion-standard.md §3/§5)', () => {
  it('has the standard :active scale press', () => {
    expect(css).toMatch(/\.tech-nav-tab:active \{ opacity: 0\.6; transform: scale\(0\.97\); \}/);
  });

  it('transitions transform on the motion tokens', () => {
    expect(css).toMatch(
      /\.tech-nav-tab \{[^}]*transition: color 0\.12s, transform var\(--motion-duration-fast\) var\(--motion-ease-standard\);/s,
    );
  });

  it('collapses the scale under prefers-reduced-motion', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.tech-nav-tab \{ transition: color 0\.12s; \}\s*\.tech-nav-tab:active \{ transform: none; \}\s*\}/,
    );
  });
});
