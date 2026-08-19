/**
 * Theme scope colour-resolution source contract
 *
 * THE INVARIANT: every scope that re-points `--text-primary` must ALSO declare
 * `color: var(--text-primary)` inside that same block.
 *
 * Why this is a rule and not a one-off fix. `body` (src/index.css) declares
 * `color: var(--text-primary)`, but `body` sits OUTSIDE every themed scope, so
 * that var() resolves against the `:root` LIGHT value and the resulting COMPUTED
 * colour — not the variable — inherits down. A scope that re-points the token
 * without also resolving `color` therefore changes what its descendants' OWN
 * `color: var(--text-primary)` rules produce, while leaving every element that
 * declares no colour rendering the colour from outside the scope.
 *
 * Measured before this was fixed, in the dark tech shell: `.conv-compose-input`
 * 1.04:1, `.tv2-msgs-thread .message-bubble` 1.02:1, `.tech-settings-row`
 * 1.04:1, and `.crm-roadmap-page.dark` body text 1.10:1 on the PUBLIC /status
 * page — near-black on near-black, invisible. 2,077 element probes improved when
 * the four scopes were brought into line.
 *
 * The test parses the stylesheet rather than listing today's scopes, so a NEW
 * themed scope added later is held to the same rule automatically — that is the
 * whole point. `:root` is the one exemption: `body` resolves it, by definition.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

/** Top-level `selector { ...decls... }` blocks, comments stripped, depth-aware. */
function topLevelBlocks(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let depth = 0;
  let selStart = 0;
  let bodyStart = -1;
  let selector = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) {
        selector = src.slice(selStart, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // skip at-rule wrappers (@media/@supports) — recurse into them instead
        if (selector.startsWith('@')) {
          blocks.push(...topLevelBlocks(src.slice(bodyStart, i)));
        } else {
          blocks.push({ selector, body: src.slice(bodyStart, i) });
        }
        selStart = i + 1;
      }
    }
  }
  return blocks;
}

const REPOINTS = topLevelBlocks(css).filter((b) => /(^|[;{\s])--text-primary\s*:/.test(b.body));

describe('theme scope colour resolution', () => {
  it('finds the themed scopes at all (guards against the parser silently matching nothing)', () => {
    expect(REPOINTS.length).toBeGreaterThanOrEqual(4);
    const selectors = REPOINTS.map((b) => b.selector).join(' | ');
    expect(selectors).toContain(':root');
    expect(selectors).toContain('.tech-layout');
    expect(selectors).toContain('.am-page');
    expect(selectors).toContain('.crm-roadmap-page.dark');
  });

  it('every scope re-pointing --text-primary also resolves `color` in the same block', () => {
    const offenders = REPOINTS
      // `:root` is resolved by `body { color: var(--text-primary) }` — that is the base case.
      .filter((b) => b.selector.trim() !== ':root')
      .filter((b) => !/(^|[;{\s])color\s*:\s*var\(\s*--text-primary\s*\)/.test(b.body))
      .map((b) => b.selector);

    expect(
      offenders,
      `These scopes re-point --text-primary without resolving \`color\`, so their descendants\n`
      + `inherit the COMPUTED colour from body — outside the scope — and text renders in the\n`
      + `wrong palette (measured as low as 1.02:1). Add \`color: var(--text-primary);\` to each:\n`
      + offenders.map((s) => `  ${s}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps the dark tech shell and the light admin-mobile island pointing opposite ways', () => {
    // Both resolve `color`, but to deliberately different palettes. If these ever
    // agree, one of the two boundaries has been flattened by mistake.
    const shell = REPOINTS.find((b) => b.selector.includes('.tech-layout'));
    const island = REPOINTS.find((b) => b.selector.includes('.am-page'));
    expect(shell.body).toMatch(/--text-primary:\s*#f1f3f6/);
    expect(island.body).toMatch(/--text-primary:\s*var\(--am-light-text-primary\)/);
  });

  it('re-tones the note-mode compose input instead of leaving a light island in the dark bar', () => {
    // PR #657 deliberately left this cream because the shell had no explicit
    // colour and darkening it then measured 1.04:1. The shell now resolves
    // `color`, so the input joins the bar/chip rgba(180, 83, 9, …) family.
    expect(css).toMatch(
      /\[data-theme="dark"\]\s*\.tech-layout\s*\.conv-compose\.note-mode\s*\.conv-compose-input\s*\{[\s\S]*?background:\s*rgba\(180,\s*83,\s*9,\s*0?\.22\)/,
    );
    // The light-mode cream bar is untouched — desktop /conversations never goes dark.
    expect(css).toContain('.conv-compose.note-mode .conv-compose-input { border-color: #fbbf24; background: #fffef5; }');
  });
});
