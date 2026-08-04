/**
 * The invoice page must make the billed customer reachable and must state when
 * no email is on file, because "Send to customer" silently depends on it.
 *
 * The internal warning must never leak into the customer-facing print document.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const source = readFileSync(join(ROOT, 'src/pages/InvoiceEditor.jsx'), 'utf8');

const MISSING_EMAIL_NOTICE = 'No email on file';

describe('InvoiceEditor customer identity', () => {
  it('selects the contact id so the Bill-to name has a link target', () => {
    // Without `id` the profile link cannot be built, and the customer page is
    // the only place a missing email can actually be fixed.
    expect(source).toContain('select=id,name,email');
  });

  it('links the Bill-to name to the customer profile', () => {
    expect(source).toContain('navigate(`/customers/${contact.id}`)');
  });

  it('states when no email is on file instead of rendering nothing', () => {
    expect(source).toContain(MISSING_EMAIL_NOTICE);
  });

  it('keeps the internal missing-email warning out of the print document', () => {
    // Anchor on the print JSX, not the string 'inv-print-doc' — that also
    // matches the CSS selector in the inline <style> block, which appears
    // EARLIER in the file and would make this guard vacuously pass.
    const printStart = source.indexOf('className="inv-print-doc"');
    expect(printStart).toBeGreaterThan(-1);

    // The print block is what the customer receives; an internal operational
    // warning appearing there would be a data leak, not a cosmetic bug.
    expect(source.slice(printStart)).not.toContain(MISSING_EMAIL_NOTICE);
  });

  it('describes the missing-email fix consistently wherever it is surfaced', () => {
    // The notice and the Send button tooltip describe the same condition on the
    // same screen; they must not disagree about where the fix lives.
    expect(source).not.toContain('add one to the contact first');
    expect(source).toContain('add one on the customer');
  });
});
