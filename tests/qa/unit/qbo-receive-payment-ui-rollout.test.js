/**
 * Static source contract for the deployment-level QBO receive-payment UI gate.
 * Runtime behavior of the pure gate lives beside the helper; Worker money and
 * authorization gates retain their own focused suites.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

describe('QBO receive-payment UI containment', () => {
  it('requires the deployment gate at every grouped-payment exposure point', () => {
    const app = read('src/App.jsx');
    const collections = read('src/pages/Collections.jsx');
    const invoice = read('src/pages/InvoiceEditor.jsx');

    expect(app).toMatch(
      /QBO_RECEIVE_PAYMENT_UI_ENABLED[\s\S]*collections\/receive-payment[\s\S]*Navigate to="\/collections\?tab=payments"/,
    );
    expect(collections).toMatch(
      /receivePaymentOn = QBO_RECEIVE_PAYMENT_UI_ENABLED[\s\S]*feature:qbo_receive_payment/,
    );
    expect(invoice).toMatch(
      /QBO_RECEIVE_PAYMENT_UI_ENABLED && employee\?\.role === 'admin'[\s\S]*feature:qbo_receive_payment/,
    );
  });

  it('keeps grouped payment code outside the native page registry', () => {
    const nativePages = read('src/routes/buildTargetPages.native.jsx');

    expect(nativePages).not.toContain('ReceivePayment');
    expect(nativePages).not.toContain('components/collections');
  });
});
