import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../../../index.css', import.meta.url)), 'utf8');

function declarationsFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

describe('Tech Messages v2 bubble contrast', () => {
  it('keeps received bubbles distinct from the thread canvas', () => {
    const canvas = declarationsFor('.tv2-msgs-thread');
    const inbound = declarationsFor('.tv2-msgs-thread .message.inbound .message-bubble');

    expect(canvas).toContain('background: var(--bg-secondary)');
    expect(inbound).toContain('background: var(--bg-tertiary)');
    expect(inbound).toContain('border: 1px solid var(--border-color)');
  });

  it('does not replace the shared outbound or internal-note treatments', () => {
    expect(declarationsFor('.message.outbound .message-bubble'))
      .toContain('background: var(--accent)');
    expect(declarationsFor('.message.internal-note .message-bubble'))
      .toContain('background: #fef9c3');
  });
});

describe('Mobile conversation action targets', () => {
  it('keeps message actions glove-sized on tech while preserving the compact remove icon', () => {
    expect(css).toMatch(
      /\.conv-retry-btn\s*\{[^}]*min-height:\s*44px;/,
    );
    expect(css).toContain('a.conv-media-file { min-height: 44px; }');
    expect(css).toContain(
      '.tech-layout :is(.conv-retry-btn, a.conv-media-file) { min-height: var(--tech-min-tap); }',
    );
    expect(css).toContain(
      '.tech-layout .conv-attach-remove { width: var(--tech-min-tap); height: var(--tech-min-tap); }',
    );
    expect(css).toMatch(
      /\.conv-attach-remove::before\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/,
    );
  });

  it('keeps the shared thread error retry at the tech tap floor', () => {
    expect(css).toContain(
      '.tech-layout .tv2-msgs-thread__error .btn { min-height: var(--tech-min-tap);',
    );
  });
});
