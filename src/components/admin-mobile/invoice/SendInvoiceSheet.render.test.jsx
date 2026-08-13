/**
 * ════════════════════════════════════════════════
 * FILE: SendInvoiceSheet.render.test.jsx
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS (plain language):
 *   The invoice-email confirmation remains a shared accessible dialog and uses
 *   the platform button primitives instead of a local button implementation.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SendInvoiceSheet from './SendInvoiceSheet';

describe('SendInvoiceSheet render contract', () => {
  it('renders the shared dialog with platform footer buttons', () => {
    const output = renderToStaticMarkup(
      <SendInvoiceSheet
        open
        onClose={() => {}}
        onSend={() => {}}
        invoiceNumber="INV-1042"
        recipient="billing@example.com"
      />,
    );

    expect(output).toContain('role="dialog"');
    expect(output).toContain('aria-modal="true"');
    expect(output).toContain('QuickBooks will email INV-1042 to billing@example.com.');
    expect(output).toContain('class="btn btn-secondary"');
    expect(output).toContain('class="btn btn-primary"');
    expect(output).not.toContain('am-button');
  });
});
