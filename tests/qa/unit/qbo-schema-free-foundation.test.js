/**
 * ════════════════════════════════════════════════
 * FILE: qbo-schema-free-foundation.test.js
 * ════════════════════════════════════════════════
 *
 * WHAT THIS DOES (plain language):
 *   Proves the first QuickBooks production release is only a maintenance and
 *   containment boundary. It must run against today's database without any of
 *   the later P4c command, reservation, allocation-fence, or company-binding
 *   migrations.
 *
 * DEPENDS ON:
 *   Packages:  vitest, node:fs, node:path, node:url
 *   Internal:  Pages QBO routes/helpers, UPR MCP QBO adapter, package.json
 *   Data:      reads  → repository source
 *              writes → none
 *
 * NOTES / GOTCHAS:
 *   - This proves source compatibility, not live deployment or database state.
 *   - Future identifiers appear only in this deny-list; none may occur in the
 *     D1 runtime sources inspected below.
 * ════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const runtimePaths = [
  'functions/lib/quickbooks.js',
  'functions/lib/qbo-payment-sync.js',
  'functions/api/quickbooks-callback.js',
  'functions/api/quickbooks-connect.js',
  'functions/api/qbo-provider-traffic-response.js',
  'functions/api/qbo-invoice.js',
  'functions/api/qbo-estimate.js',
  'functions/api/qbo-receive-payment.js',
  'functions/api/qbo-payments-sync.js',
  'functions/api/qbo-payment.js',
  'functions/api/qbo-query.js',
  'functions/api/qbo-sync-customer.js',
  'functions/api/qbo-invoice-drift.js',
  'functions/api/qbo-webhook.js',
  'functions/api/qbo-attach.js',
  'functions/api/qbo-charge.js',
  'functions/api/stripe-webhook.js',
  'functions/api/stripe-pay-link.js',
  'upr-mcp/src/qbo.js',
  'upr-mcp/src/tools.js',
];

const futureIdentifiers = [
  'reserve_qbo_invoice_command',
  'release_qbo_invoice_command_reservation',
  'qbo_invoice_command_reservations',
  'stage_qbo_invoice_line_update',
  'finalize_qbo_invoice_line_update',
  'stage_qbo_invoice_line_change',
  'finalize_qbo_invoice_line_change',
  'qbo_payment_allocation_fences',
  'reserve_qbo_payment_allocation_fence',
  'release_qbo_payment_allocation_fence',
  'qbo_estimate_commands',
  'qbo_estimate_command_reservations',
  'reserve_qbo_estimate_command',
  'prepare_qbo_estimate_command',
  'record_qbo_estimate_provider_started',
  'record_qbo_estimate_provider_succeeded',
  'finalize_qbo_estimate_command',
  'record_qbo_estimate_command_failure',
  'release_qbo_estimate_command_reservation',
  'qbo_company_binding',
  'qbo_binding_generation',
  'replace_qbo_connection',
  'refresh_qbo_connection_cas',
  'feature:qbo_document_command_v2',
];

describe('schema-free QuickBooks production foundation', () => {
  it('contains no consumer of a future P4c database or capability contract', () => {
    for (const path of runtimePaths) {
      const source = read(path);
      for (const identifier of futureIdentifiers) {
        expect(source, `${path} must not use ${identifier}`).not.toContain(identifier);
      }
    }
  });

  it('keeps legacy invoice commands on the already-deployed command ledger', () => {
    const source = read('functions/api/qbo-invoice.js');
    const validation = source.indexOf("if (!invoiceId)");
    const gate = source.indexOf('requireQboProviderTraffic(env)');
    const connection = source.indexOf('getConnection(env)');

    expect(validation).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(validation);
    expect(connection).toBeGreaterThan(gate);
    expect(source).toContain('prepareQboInvoiceCommand');
    expect(source).not.toContain('reserveQboInvoiceCommand');
    expect(source).not.toContain('line_change');
  });

  it('keeps legacy estimate and receipt behavior while placing the brake before provider work', () => {
    const estimate = read('functions/api/qbo-estimate.js');
    const receipt = read('functions/api/qbo-receive-payment.js');

    expect(estimate.indexOf('requireQboProviderTraffic(env)'))
      .toBeLessThan(estimate.indexOf('getConnection(env)'));
    expect(estimate).not.toContain('Idempotency-Key');
    expect(estimate).not.toContain('qbo-estimate-commands');
    expect(receipt.indexOf('requireQboProviderTraffic(env)'))
      .toBeLessThan(receipt.indexOf('getConnection(env)'));
    expect(receipt).toContain("db.rpc('reserve_qbo_payment_receipt'");
    expect(receipt).not.toContain('allocation_fence');
  });

  it('uses current-schema credential CAS and keeps MCP mutations source-disabled', () => {
    const pages = read('functions/lib/quickbooks.js');
    const mcp = read('upr-mcp/src/qbo.js');

    expect(pages).toContain('provider=eq.${PROVIDER}');
    expect(mcp).toContain('provider=eq.${PROVIDER}');
    for (const source of [pages, mcp]) {
      expect(source).toContain('realm_id=eq.');
      expect(source).toContain('updated_at=eq.');
    }
    expect(mcp).toContain('qbo_mcp_mutation_durable_boundary_required');
    expect(mcp).toMatch(/export async function qboCreate[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
    expect(mcp).toMatch(/export async function qboSparseUpdate[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
    expect(mcp).toMatch(/export async function qboDelete[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
    expect(mcp).toMatch(/export async function qboSend[\s\S]*?assertQboMcpMutationDurableBoundary\(\)/);
  });

  it('does not publish P4c database qualifier scripts in the foundation package', () => {
    const pkg = read('package.json');
    expect(pkg).not.toContain('test:db:invoice-line-edit-lock:local');
    expect(pkg).not.toContain('test:db:qbo-invoice-command-reservation');
    expect(pkg).not.toContain('test:db:qbo-payment-allocation-lock-fence');
    expect(pkg).not.toContain('test:db:qbo-estimate-command-boundary');
  });
});
