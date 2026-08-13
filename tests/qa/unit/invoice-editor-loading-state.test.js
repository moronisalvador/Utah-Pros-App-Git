/**
 * ════════════════════════════════════════════════
 * FILE: invoice-editor-loading-state.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Protects the legacy invoice editor from showing data for a
 *   document the user has already left. It also keeps mutation refreshes from
 *   blanking the page and requires a useful retry state after a failed load.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path
 *   Internal:  InvoiceEditor.jsx
 *   Data:      reads  → source files only
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - Loading either editor must never create a blank financial line; line creation
 *     remains an explicit user action so stale route work cannot persist a mutation.
 * ════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const invoiceSource = readFileSync(join(ROOT, 'src/pages/InvoiceEditor.jsx'), 'utf8');
describe('legacy financial editor loading and error states', () => {
  it('guards invoice route work and keeps its skeleton cold-start-only', () => {
    const loadStart = invoiceSource.indexOf('const load = useCallback');
    const loadEnd = invoiceSource.indexOf('}, [invoiceId, navigate]);', loadStart);
    const loadBody = invoiceSource.slice(loadStart, loadEnd);

    expect(loadBody).not.toContain('setLoading(true)');
    expect(loadBody).toContain("setLoadError('')");
    expect(loadBody).toContain('epoch === routeEpochRef.current');
    expect(loadBody).not.toContain("d.insert('invoice_line_items'");
    expect(invoiceSource).toContain('mountedRef.current = true;');
    expect(invoiceSource).toContain('const epoch = ++routeEpochRef.current;');
    expect(invoiceSource).toContain('}, [invoiceId, navigate]);');
  });

  it('renders a retryable shared ErrorState after a cold-load failure', () => {
    expect(invoiceSource).toContain("import ErrorState from '@/components/ui/ErrorState'");
    expect(invoiceSource).toContain('if (!inv && loadError)');
    expect(invoiceSource).toContain('message={loadError}');
    expect(invoiceSource).toMatch(/onRetry=\{(?:load|\(\) => load\(\))\}/);
  });
});
