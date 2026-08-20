// @vitest-environment happy-dom
/**
 * ════════════════════════════════════════════════
 * FILE: SearchSelect.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   A temporarily unavailable option catalog does not erase a saved QBO item or
 *   class name from the closed selector.
 * ════════════════════════════════════════════════
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SearchSelect from './SearchSelect';

describe('SearchSelect stored-name fallback', () => {
  it('shows the saved name while an empty catalog keeps the selector disabled', () => {
    const html = renderToStaticMarkup(
      <SearchSelect
        value="42"
        fallbackName="Water mitigation"
        options={[]}
        disabled
        ariaLabel="Item for line 1"
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Water mitigation');
    expect(html).not.toContain('>—<');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Item for line 1: Water mitigation"');
  });

  it('prefers the current catalog label over a stale stored name', () => {
    const html = renderToStaticMarkup(
      <SearchSelect
        value="42"
        fallbackName="Old name"
        options={[{ id: '42', name: 'Current name' }]}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Current name');
    expect(html).not.toContain('Old name');
  });
});
