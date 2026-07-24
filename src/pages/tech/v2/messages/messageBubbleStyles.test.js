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
