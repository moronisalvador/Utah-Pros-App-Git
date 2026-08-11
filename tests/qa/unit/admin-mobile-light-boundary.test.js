/**
 * Admin Mobile — light token boundary source contract
 *
 * The /tech/admin composition is intentionally light even inside a dark tech
 * shell. This static test guards the boundary rather than pretending a unit
 * DOM can compute the complete stylesheet cascade.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

describe('Admin Mobile light token boundary', () => {
  it('remaps shared colors to named light values at the page and portaled sheet boundary', () => {
    expect(css).toMatch(/--am-light-bg-primary:\s*#ffffff;/);
    expect(css).toMatch(/--am-light-text-primary:\s*#111318;/);
    expect(css).toMatch(/\.am-page,\s*\.am-send-sheet\s*\{[\s\S]*?--bg-primary:\s*var\(--am-light-bg-primary\);/);
    expect(css).toMatch(/\.am-page,\s*\.am-send-sheet\s*\{[\s\S]*?--text-primary:\s*var\(--am-light-text-primary\);/);
    expect(css).toMatch(/\.am-page,\s*\.am-send-sheet\s*\{[\s\S]*?--danger-bg:\s*var\(--am-light-danger-bg\);/);
  });

  it('keeps page content and its fixed money dock on the inherited token boundary', () => {
    expect(css).toContain('.am-page { display: flex; flex-direction: column; min-height: 100%; background: var(--bg-secondary); }');
    expect(css).toMatch(/\.am-dock\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--bg-primary\) 94%, transparent\);/);
  });

  it('keeps the claim route touch-safe with instant visible press feedback', () => {
    expect(css).toMatch(/\.am-invoice-claim-link\s*\{[\s\S]*?touch-action:\s*manipulation;[\s\S]*?-webkit-tap-highlight-color:\s*transparent;/);
    expect(css).toMatch(/\.am-invoice-claim-link:active\s*\{\s*scale:\s*0\.97;\s*background:\s*var\(--accent-light\);\s*\}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.am-invoice-claim-link\s*\{\s*transition:\s*none;[\s\S]*?\.am-invoice-claim-link:active\s*\{\s*scale:\s*1;/);
  });
});
