/**
 * InvoiceEditor must preserve its rendered data during mutation refreshes and
 * distinguish a cold-load failure from a missing/empty invoice.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const source = readFileSync(join(ROOT, 'src/pages/InvoiceEditor.jsx'), 'utf8');

describe('InvoiceEditor loading and error states', () => {
  it('keeps the skeleton as a cold-start-only gate during mutation refreshes', () => {
    const loadStart = source.indexOf('const load = useCallback');
    const loadEnd = source.indexOf('useEffect(() => { load(); }', loadStart);
    const loadBody = source.slice(loadStart, loadEnd);

    expect(loadBody).not.toContain('setLoading(true)');
    expect(loadBody).toContain("setLoadError('')");
    expect(loadBody).toContain('canEditBilling(employeeRoleRef.current)');
    expect(source).toContain('}, [invoiceId, navigate]);');
    expect(source).not.toContain('}, [invoiceId, navigate, canEdit, employee]);');
  });

  it('renders a retryable shared ErrorState after a cold-load failure', () => {
    expect(source).toContain("import ErrorState from '@/components/ui/ErrorState'");
    expect(source).toContain('if (!inv && loadError)');
    expect(source).toContain('message={loadError}');
    expect(source).toContain('onRetry={load}');
  });
});
