/**
 * PaymentsLedger must distinguish a failed ledger RPC from an empty ledger.
 * This node-only contract test guards the Collections tab against an outage
 * being presented as "No payments recorded yet".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const source = readFileSync(join(ROOT, 'src/components/collections/PaymentsLedger.jsx'), 'utf8');

describe('PaymentsLedger loading and error states', () => {
  it('renders a retryable ErrorState instead of the successful empty state after a cold-load failure', () => {
    expect(source).toContain("import ErrorState from '@/components/ui/ErrorState'");
    expect(source).toContain("setLoadError('Couldn’t load payments. Check your connection and try again.')");
    expect(source).toContain('if (loadError && rows.length === 0) return <ErrorState message={loadError} onRetry={load} />;');
  });

  it('keeps loading as a cold-start-only gate and preserves rows on a failed refresh', () => {
    const loadStart = source.indexOf('const load = useCallback');
    const loadEnd = source.indexOf('useEffect(() => { load(); }', loadStart);
    const loadBody = source.slice(loadStart, loadEnd);

    expect(loadBody).not.toContain('setLoading(true)');
    expect(loadBody).toContain('if (hadRowsRef.current) err(\'Couldn’t refresh — showing last-loaded payments.\');');
    expect(loadBody).not.toContain('setRows([])');
  });
});
