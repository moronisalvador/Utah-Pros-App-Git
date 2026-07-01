import { describe, it, expect } from 'vitest';
import { wrapEmailBody as clientWrap, renderVariables } from './emailTemplate.js';
import { wrapEmailBody as serverWrap } from '../../functions/lib/email-template.js';

describe('wrapEmailBody — client/server template stay in sync', () => {
  it('produces byte-identical output for the same input (with an unsubscribe link)', () => {
    const input = { bodyHtml: '<p>Hi Jane, thanks for choosing us.</p>', unsubscribeUrl: 'https://utahpros.app/api/email-unsubscribe?rid=abc123' };
    expect(clientWrap(input)).toBe(serverWrap(input));
  });

  it('produces byte-identical output with no unsubscribe link', () => {
    const input = { bodyHtml: '<p>Hello</p>' };
    expect(clientWrap(input)).toBe(serverWrap(input));
  });

  it('includes the brand header and the body content', () => {
    const html = clientWrap({ bodyHtml: '<p>Special offer</p>' });
    expect(html).toContain('Utah Pros Restoration');
    expect(html).toContain('<p>Special offer</p>');
  });

  it('omits the unsubscribe link entirely when none is given', () => {
    const html = clientWrap({ bodyHtml: '<p>Hi</p>' });
    expect(html).not.toContain('Unsubscribe');
  });
});

describe('renderVariables', () => {
  it('substitutes a known token', () => {
    expect(renderVariables('Hi {{name}}', { name: 'Jane' })).toBe('Hi Jane');
  });

  it('replaces an unknown token with an empty string rather than leaving it raw', () => {
    expect(renderVariables('Hi {{missing}}', {})).toBe('Hi ');
  });

  it('leaves plain text with no tokens unchanged', () => {
    expect(renderVariables('Hi there', { name: 'Jane' })).toBe('Hi there');
  });
});
