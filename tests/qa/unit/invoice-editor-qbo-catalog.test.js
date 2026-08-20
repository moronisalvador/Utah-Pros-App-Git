/**
 * ════════════════════════════════════════════════
 * FILE: invoice-editor-qbo-catalog.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS TESTS:
 *   The invoice editor wires its resilient read-only QBO catalog loader, exposes
 *   a human retry after failure, and preserves the separate human Save boundary.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const source = readFileSync(join(ROOT, 'src/pages/InvoiceEditor.jsx'), 'utf8');

describe('InvoiceEditor QBO catalog recovery', () => {
  it('loads and retries only through the read-only query endpoint', () => {
    const catalogStart = source.indexOf('const loadCatalog = useCallback');
    const catalogEnd = source.indexOf('// Payment modal:', catalogStart);
    const catalogSource = source.slice(catalogStart, catalogEnd);

    expect(catalogSource).toContain("fetch('/api/qbo-query'");
    expect(catalogSource).toContain('loadQboCatalog(run, { signal })');
    expect(source).toContain("loadCatalog({ focusAfterLoad: true })");
    expect(source).toContain("catalogLoading ? 'Retrying…' : 'Retry catalog'");
    expect(source).toContain('style={{ minHeight: 44 }}');
    expect(catalogSource).not.toContain('/api/qbo-invoice');
    expect(catalogSource).not.toContain('callQboInvoiceWorker');
    expect(catalogSource).not.toContain('saveInvoice(');
    expect(catalogSource).not.toContain('flushAndPush(');
  });

  it('passes stored item and class names to the selectors as display fallbacks', () => {
    expect(source).toMatch(/options=\{qboItems\} fallbackName=\{l\.qbo_item_name \|\| ''\}/);
    expect(source).toMatch(/options=\{qboClasses\} fallbackName=\{l\.qbo_class_name \|\| ''\}/);
    expect(source).toContain('ariaLabel={`Item for line ${idx + 1}`}');
    expect(source).toContain('ariaLabel={`Class for line ${idx + 1}`}');
  });

  it('announces a successful human retry and moves focus into the recovered catalog', () => {
    expect(source).toContain("setCatalogNotice('QuickBooks catalog loaded.')");
    expect(source).toContain('const target = catalog.items.length ? catalogFocusRef.current : null;');
    expect(source).toContain('if (target) target.focus();');
    expect(source).toContain('else catalogNoticeRef.current?.focus();');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('triggerRef={idx === 0 ? catalogFocusRef : undefined}');
  });

  it('keeps the provider write on the visible Save button', () => {
    expect(source).toMatch(/<PrimaryButton onClick=\{saveInvoice\}/);
    expect(source).toMatch(/const saveInvoice = async \(\) => \{[\s\S]*?flushAndPush\(\)/);
    expect(source).not.toMatch(/useEffect\([\s\S]{0,400}?saveInvoice/);
  });
});
