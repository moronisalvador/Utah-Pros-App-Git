/**
 * ════════════════════════════════════════════════
 * FILE: tech-core-route-continuity.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Prevents a stale, missing, or deliberately disabled rollout flag from
 *   turning the field app's Dashboard, Schedule, or native Messages tabs into
 *   blank screens after their legacy implementations were removed/excluded.
 *
 * DEPENDS ON:
 *   Packages:  vitest, Node.js built-ins
 *   Internal:  App.jsx, components/TechLayout.jsx
 *   Data:      reads repository source only
 * ════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

describe('field core-route continuity', () => {
  const app = read('src/App.jsx');
  const layout = read('src/components/TechLayout.jsx');

  it('tells the shared field shell when the build excludes desktop fallbacks', () => {
    expect(app).toContain('<TechLayout nativeBuild={IS_NATIVE} />');
  });

  it('always mounts the only live Dashboard and Schedule implementations', () => {
    expect(layout).not.toContain(
      "isFeatureEnabled('page:tech_dash_v2')",
    );
    expect(layout).not.toContain(
      "isFeatureEnabled('page:tech_sched_v2')",
    );
    expect(layout).toContain('<TechPane active={dashActive}>');
    expect(layout).toContain('<TechPane active={schedActive}>');
    expect(layout).not.toContain('{dashV2 && (');
    expect(layout).not.toContain('{schedV2 && (');
  });

  it('keeps the web Messages rollback but never blanks native Messages', () => {
    expect(layout.replace(/\s+/g, ' ')).toContain(
      "const msgsV2 = nativeBuild || isFeatureEnabled('page:tech_msgs_v2');",
    );
  });
});
